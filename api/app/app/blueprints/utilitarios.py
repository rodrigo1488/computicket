"""Arquivos públicos da rota /utilitarios."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_login import current_user, login_required
from sqlalchemy import func, or_
from werkzeug.utils import secure_filename

from .. import db
from ..models import UtilityCategory, UtilityFile
from ..timezone_utils import get_brasilia_now, utc_to_brasilia

bp = Blueprint("utilitarios", __name__, url_prefix="/utilitarios")

ALLOWED_EXTENSIONS = {
	"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "rtf",
	"txt", "csv", "xml", "json",
	"zip", "rar", "7z", "tar", "gz",
	"jpg", "jpeg", "png", "gif", "webp",
	"mp4", "mp3", "wav",
	"exe", "msi", "apk", "dmg", "iso",
}
MAX_FILE_SIZE = 1024 * 1024 * 1024  # 1 GB
DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024  # 8 MB — cabe no timeout de ~100s do Cloudflare
_UPLOAD_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_UPDATE_HASH_RE = re.compile(r"^[0-9a-f]{32}$")
_STALE_UPLOAD_SECONDS = 24 * 60 * 60


def _upload_folder() -> str:
	folder = os.path.join(current_app.instance_path, "utilitarios_uploads")
	os.makedirs(folder, exist_ok=True)
	return folder


def _chunk_size() -> int:
	try:
		value = int(current_app.config.get("UTILITARIOS_CHUNK_SIZE") or DEFAULT_CHUNK_SIZE)
	except (TypeError, ValueError):
		value = DEFAULT_CHUNK_SIZE
	return max(1, min(value, 32 * 1024 * 1024))


def _incoming_root() -> Path:
	folder = Path(_upload_folder()) / ".incoming"
	folder.mkdir(parents=True, exist_ok=True)
	return folder


def _incoming_dir(upload_id: str) -> Path:
	if not _UPLOAD_ID_RE.match(upload_id or ""):
		raise ValueError("Envio inválido.")
	path = (_incoming_root() / upload_id).resolve()
	root = _incoming_root().resolve()
	if root not in path.parents and path != root:
		raise ValueError("Envio inválido.")
	return path


def _cleanup_stale_uploads() -> None:
	root = _incoming_root()
	limit = time.time() - _STALE_UPLOAD_SECONDS
	for child in root.iterdir():
		if not child.is_dir():
			continue
		try:
			if child.stat().st_mtime < limit:
				shutil.rmtree(child, ignore_errors=True)
		except OSError:
			continue


def _read_meta(folder: Path) -> dict:
	meta_path = folder / "meta.json"
	if not meta_path.is_file():
		raise ValueError("Envio não encontrado.")
	try:
		return json.loads(meta_path.read_text(encoding="utf-8"))
	except (OSError, json.JSONDecodeError) as exc:
		raise ValueError("Envio inválido.") from exc


def _write_meta(folder: Path, meta: dict) -> None:
	(folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")


def _prepare_filename(filename: str) -> tuple[str, str, str]:
	original = _display_name(filename)
	ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
	if ext not in ALLOWED_EXTENSIONS:
		raise ValueError(f"Tipo de arquivo não permitido: .{ext or 'sem extensão'}")
	safe = secure_filename(original) or f"arquivo.{ext}"
	if "." not in safe:
		safe = f"{safe}.{ext}"
	return original, ext, safe


def _size_label(size: int) -> str:
	value = int(size or 0)
	if value < 1024:
		return f"{value} B"
	if value < 1024 * 1024:
		return f"{value / 1024:.1f} KB"
	if value < 1024 * 1024 * 1024:
		return f"{value / (1024 * 1024):.1f} MB"
	return f"{value / (1024 * 1024 * 1024):.1f} GB"


def _display_name(filename: str) -> str:
	name = Path(str(filename or "")).name.replace("\\", "").replace("/", "").strip()
	return name[:255] or "arquivo"


def _created_at_iso(dt) -> str | None:
	if not dt:
		return None
	try:
		local = utc_to_brasilia(dt)
		return (local or dt).isoformat()
	except Exception:
		try:
			return dt.isoformat()
		except Exception:
			return None


def _serialize(row: UtilityFile, *, include_author: bool = False) -> dict:
	update_hash = row.update_hash or ""
	payload = {
		"id": row.id,
		"title": row.title,
		"description": row.description or "",
		"original_filename": row.original_filename,
		"file_size": int(row.file_size or 0),
		"file_size_label": _size_label(row.file_size or 0),
		"file_type": row.file_type or "",
		"download_count": int(row.download_count or 0),
		"category_id": row.category_id,
		"category_name": row.category.name if row.category else "",
		"hash": update_hash,
		"version": int(row.version or 1),
		"sha256": row.sha256 or "",
		"created_at": _created_at_iso(row.created_at),
		"updated_at": _created_at_iso(row.updated_at),
		"download_url": f"/utilitarios/api/publico/{row.id}/download",
		"update_url": f"/utilitarios/api/publico/hash/{update_hash}" if update_hash else "",
	}
	if include_author:
		payload["created_by_name"] = row.created_by.name if row.created_by else ""
	return payload


def _parse_positive_int(raw) -> int | None:
	if raw is None or raw == "":
		return None
	try:
		value = int(raw)
	except (TypeError, ValueError):
		return None
	return value if value > 0 else None


def _parse_category_id(raw) -> int | None:
	if raw is None or raw == "":
		return None
	if isinstance(raw, str) and raw.strip().lower() in {"", "none", "null", "0"}:
		return None
	try:
		value = int(raw)
	except (TypeError, ValueError):
		return None
	return value if value > 0 else None


def _get_category(category_id: int | None) -> UtilityCategory | None:
	if not category_id:
		return None
	row = db.session.get(UtilityCategory, category_id)
	if not row:
		raise ValueError("Categoria não encontrada.")
	return row


def _normalize_category_name(name: str) -> str:
	return " ".join((name or "").split()).strip()[:100]


def _category_taken(name: str, *, exclude_id: int | None = None) -> bool:
	query = UtilityCategory.query.filter(func.lower(UtilityCategory.name) == name.lower())
	if exclude_id:
		query = query.filter(UtilityCategory.id != exclude_id)
	return query.first() is not None


def _serialize_category(row: UtilityCategory, files_count: int = 0) -> dict:
	return {
		"id": row.id,
		"name": row.name,
		"position": int(row.position or 0),
		"files_count": int(files_count or 0),
	}


def _category_counts() -> dict[int, int]:
	rows = (
		db.session.query(UtilityFile.category_id, func.count(UtilityFile.id))
		.filter(UtilityFile.category_id.isnot(None))
		.group_by(UtilityFile.category_id)
		.all()
	)
	return {int(cid): int(count) for cid, count in rows if cid}


def _list_categories() -> list[dict]:
	counts = _category_counts()
	rows = UtilityCategory.query.order_by(UtilityCategory.position.asc(), UtilityCategory.name.asc()).all()
	return [_serialize_category(row, counts.get(row.id, 0)) for row in rows]


def _list_payload(rows: list[UtilityFile], *, include_author: bool = False) -> dict:
	return {
		"items": [_serialize(row, include_author=include_author) for row in rows],
		"total": len(rows),
		"categories": _list_categories(),
	}


def _disk_path(row: UtilityFile) -> str | None:
	folder = Path(_upload_folder()).resolve()
	names = [
		Path(str(row.filename or "")).name,
		Path(str(row.file_path or "")).name,
	]
	seen: set[str] = set()
	for name in names:
		if not name or name in seen or "/" in name or "\\" in name:
			continue
		seen.add(name)
		path = (folder / name).resolve()
		if folder not in path.parents and path != folder:
			continue
		if path.is_file():
			return str(path)
	raw = str(row.file_path or "").strip()
	if raw:
		candidate = Path(raw).resolve()
		if candidate.is_file() and (folder in candidate.parents or candidate.parent == folder):
			return str(candidate)
	return None


def _replace_row_file(
	row: UtilityFile,
	*,
	unique_name: str,
	original: str,
	size: int,
	mime: str,
) -> str | None:
	old_path = _disk_path(row)
	row.filename = unique_name
	row.original_filename = original
	row.file_path = unique_name
	row.file_size = int(size or 0)
	row.file_type = mime or "application/octet-stream"
	return old_path


def _remove_old_file(old_path: str | None, new_path: str | None) -> None:
	if not old_path or not os.path.isfile(old_path):
		return
	if new_path and os.path.abspath(old_path) == os.path.abspath(new_path):
		return
	try:
		os.remove(old_path)
	except OSError:
		pass


def _new_update_hash() -> str:
	for _ in range(8):
		token = uuid.uuid4().hex
		if not UtilityFile.query.filter_by(update_hash=token).first():
			return token
	return uuid.uuid4().hex


def _file_sha256(path: str) -> str:
	digest = hashlib.sha256()
	with open(path, "rb") as fh:
		while True:
			chunk = fh.read(1024 * 1024)
			if not chunk:
				break
			digest.update(chunk)
	return digest.hexdigest()


def _after_file_written(row: UtilityFile, dest: str, *, is_replace: bool) -> None:
	if not row.update_hash:
		row.update_hash = _new_update_hash()
	if is_replace:
		row.version = int(row.version or 1) + 1
	else:
		row.version = int(row.version or 0) or 1
	row.sha256 = _file_sha256(dest)
	row.updated_at = get_brasilia_now()


def backfill_utility_versioning() -> None:
	rows = UtilityFile.query.filter(
		or_(UtilityFile.update_hash.is_(None), UtilityFile.update_hash == "")
	).all()
	changed = False
	for row in rows:
		row.update_hash = _new_update_hash()
		if not row.version:
			row.version = 1
		if not row.updated_at:
			row.updated_at = row.created_at
		changed = True
	if changed:
		db.session.commit()


def _ensure_sha256(row: UtilityFile) -> str:
	if row.sha256:
		return row.sha256
	path = _disk_path(row)
	if not path:
		return ""
	row.sha256 = _file_sha256(path)
	try:
		db.session.commit()
	except Exception:
		db.session.rollback()
	return row.sha256 or ""


def _public_origin() -> str:
	explicit = (os.environ.get("COMPUTICKET_PUBLIC_URL") or "").strip().rstrip("/")
	if explicit:
		return explicit
	return (request.url_root or "").rstrip("/")


def _cors_json(payload: dict, status: int = 200):
	resp = jsonify(payload)
	resp.status_code = status
	resp.headers["Access-Control-Allow-Origin"] = "*"
	resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
	resp.headers["Access-Control-Allow-Headers"] = "Accept"
	resp.headers["Cache-Control"] = "no-store"
	return resp


def _find_by_update_hash(hash_value: str) -> UtilityFile | None:
	token = (hash_value or "").strip().lower()
	if not _UPDATE_HASH_RE.match(token):
		return None
	return UtilityFile.query.filter_by(update_hash=token).first()


def _client_version() -> int | None:
	raw = request.args.get("version")
	if raw is None or raw == "":
		raw = request.args.get("v")
	if raw is None or str(raw).strip() == "":
		return None
	if str(raw).strip() == "0":
		return 0
	return _parse_positive_int(raw)


def _update_payload(row: UtilityFile) -> dict:
	origin = _public_origin()
	update_hash = row.update_hash or ""
	current = int(row.version or 1)
	client = _client_version()
	return {
		"hash": update_hash,
		"version": current,
		"sha256": _ensure_sha256(row),
		"title": row.title,
		"original_filename": row.original_filename,
		"file_size": int(row.file_size or 0),
		"file_type": row.file_type or "application/octet-stream",
		"updated_at": _created_at_iso(row.updated_at or row.created_at),
		"download_url": f"{origin}/utilitarios/arquivo/hash/{update_hash}" if update_hash else "",
		"update_url": f"{origin}/utilitarios/atualizacao/{update_hash}" if update_hash else "",
		"update_available": current > client if client is not None else None,
	}


def _list_query():
	query = UtilityFile.query
	term = (request.args.get("q") or "").strip()
	if term:
		like = f"%{term}%"
		query = query.filter(
			or_(
				UtilityFile.title.ilike(like),
				UtilityFile.description.ilike(like),
				UtilityFile.original_filename.ilike(like),
			)
		)
	raw_cat = (request.args.get("category_id") or "").strip()
	if raw_cat.lower() in {"none", "uncategorized", "sem"}:
		query = query.filter(UtilityFile.category_id.is_(None))
	elif raw_cat:
		category_id = _parse_category_id(raw_cat)
		if category_id:
			query = query.filter(UtilityFile.category_id == category_id)
	return query.order_by(UtilityFile.created_at.desc())


def _save_files() -> list[UtilityFile]:
	files = list(request.files.getlist("files")) + list(request.files.getlist("file"))
	title = (request.form.get("title") or "").strip()
	description = (request.form.get("description") or "").strip() or None
	try:
		category = _get_category(_parse_category_id(request.form.get("category_id")))
	except ValueError:
		raise
	category_id = category.id if category else None
	saved: list[UtilityFile] = []
	for file in files:
		if not file or not getattr(file, "filename", None):
			continue
		original, ext, safe = _prepare_filename(file.filename)
		file.seek(0, os.SEEK_END)
		size = file.tell()
		file.seek(0)
		if size <= 0:
			raise ValueError("Arquivo vazio.")
		if size > MAX_FILE_SIZE:
			raise ValueError("Cada arquivo pode ter no máximo 1 GB.")
		unique_name = f"{uuid.uuid4().hex}_{safe}"
		path = os.path.join(_upload_folder(), unique_name)
		file.save(path)
		row = UtilityFile(
			title=(title or Path(original).stem or original)[:200],
			description=description,
			filename=unique_name,
			original_filename=original,
			file_path=unique_name,
			file_size=size,
			file_type=file.mimetype or "application/octet-stream",
			category_id=category_id,
			created_by_id=current_user.id,
			update_hash=_new_update_hash(),
			version=1,
		)
		_after_file_written(row, path, is_replace=False)
		db.session.add(row)
		saved.append(row)
	if not saved:
		raise ValueError("Selecione ao menos um arquivo.")
	return saved


@bp.route("/api/uploads", methods=["POST"])
@login_required
def api_upload_init():
	data = request.get_json(silent=True) or {}
	try:
		size = int(data.get("size") or 0)
	except (TypeError, ValueError):
		size = 0
	try:
		original, _ext, safe = _prepare_filename(str(data.get("filename") or ""))
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 400
	if size <= 0:
		return jsonify({"error": "Arquivo vazio."}), 400
	if size > MAX_FILE_SIZE:
		return jsonify({"error": "Cada arquivo pode ter no máximo 1 GB."}), 400
	title = (data.get("title") or "").strip()
	description = (data.get("description") or "").strip() or None
	try:
		category = _get_category(_parse_category_id(data.get("category_id")))
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 400
	replace_file_id = _parse_positive_int(data.get("replace_file_id"))
	if replace_file_id:
		existing = db.session.get(UtilityFile, replace_file_id)
		if not existing:
			return jsonify({"error": "Arquivo não encontrado."}), 404
	chunk_size = _chunk_size()
	total_chunks = max(1, math.ceil(size / chunk_size))
	_cleanup_stale_uploads()
	upload_id = uuid.uuid4().hex
	folder = _incoming_dir(upload_id)
	folder.mkdir(parents=True, exist_ok=True)
	_write_meta(folder, {
		"user_id": current_user.id,
		"original_filename": original,
		"safe_name": safe,
		"size": size,
		"title": (title or Path(original).stem or original)[:200],
		"description": description,
		"category_id": category.id if category else None,
		"replace_file_id": replace_file_id,
		"mime": (data.get("mime") or "").strip() or "application/octet-stream",
		"chunk_size": chunk_size,
		"total_chunks": total_chunks,
	})
	return jsonify({
		"upload_id": upload_id,
		"chunk_size": chunk_size,
		"total_chunks": total_chunks,
	}), 201


@bp.route("/api/uploads/<upload_id>/chunks/<int:index>", methods=["PUT"])
@login_required
def api_upload_chunk(upload_id: str, index: int):
	try:
		folder = _incoming_dir(upload_id)
		meta = _read_meta(folder)
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 404
	if int(meta.get("user_id") or 0) != current_user.id:
		return jsonify({"error": "Envio não encontrado."}), 404
	total = int(meta.get("total_chunks") or 0)
	if index < 0 or index >= total:
		return jsonify({"error": "Parte inválida."}), 400
	blob = request.files.get("chunk")
	payload = blob.read() if blob else request.get_data(cache=False)
	if not payload:
		return jsonify({"error": "Parte vazia."}), 400
	chunk_size = int(meta.get("chunk_size") or _chunk_size())
	expected = int(meta.get("size") or 0) - index * chunk_size
	expected = min(chunk_size, max(expected, 0))
	if len(payload) > chunk_size or (expected and len(payload) != expected):
		return jsonify({"error": "Tamanho da parte não confere."}), 400
	part = folder / str(index)
	part.write_bytes(payload)
	return jsonify({"ok": True, "index": index})


@bp.route("/api/uploads/<upload_id>/complete", methods=["POST"])
@login_required
def api_upload_complete(upload_id: str):
	try:
		folder = _incoming_dir(upload_id)
		meta = _read_meta(folder)
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 404
	if int(meta.get("user_id") or 0) != current_user.id:
		return jsonify({"error": "Envio não encontrado."}), 404
	total = int(meta.get("total_chunks") or 0)
	expected = int(meta.get("size") or 0)
	missing = [i for i in range(total) if not (folder / str(i)).is_file()]
	if missing:
		return jsonify({"error": "Envio incompleto. Tente novamente."}), 400
	unique_name = f"{uuid.uuid4().hex}_{meta.get('safe_name') or 'arquivo'}"
	dest = os.path.join(_upload_folder(), unique_name)
	written = 0
	try:
		with open(dest, "wb") as out:
			for i in range(total):
				with open(folder / str(i), "rb") as part:
					while True:
						buf = part.read(1024 * 1024)
						if not buf:
							break
						out.write(buf)
						written += len(buf)
		if written != expected:
			raise ValueError("Tamanho final não confere.")
		replace_id = _parse_positive_int(meta.get("replace_file_id"))
		status = 201
		old_path = None
		if replace_id:
			row = db.session.get(UtilityFile, replace_id)
			if not row:
				raise FileNotFoundError("Arquivo não encontrado.")
			old_path = _replace_row_file(
				row,
				unique_name=unique_name,
				original=meta.get("original_filename") or "arquivo",
				size=written,
				mime=meta.get("mime") or "application/octet-stream",
			)
			title = (meta.get("title") or "").strip()
			if title:
				row.title = title[:200]
			row.description = (meta.get("description") or "").strip() or None
			row.category_id = _parse_category_id(meta.get("category_id"))
			_after_file_written(row, dest, is_replace=True)
			status = 200
		else:
			row = UtilityFile(
				title=(meta.get("title") or "arquivo")[:200],
				description=meta.get("description") or None,
				filename=unique_name,
				original_filename=meta.get("original_filename") or "arquivo",
				file_path=unique_name,
				file_size=written,
				file_type=meta.get("mime") or "application/octet-stream",
				category_id=_parse_category_id(meta.get("category_id")),
				created_by_id=current_user.id,
				update_hash=_new_update_hash(),
				version=1,
			)
			_after_file_written(row, dest, is_replace=False)
			db.session.add(row)
		db.session.commit()
		_remove_old_file(old_path, dest)
	except FileNotFoundError as exc:
		db.session.rollback()
		if os.path.isfile(dest):
			try:
				os.remove(dest)
			except OSError:
				pass
		return jsonify({"error": str(exc)}), 404
	except ValueError as exc:
		db.session.rollback()
		if os.path.isfile(dest):
			try:
				os.remove(dest)
			except OSError:
				pass
		return jsonify({"error": str(exc)}), 400
	except Exception:
		db.session.rollback()
		if os.path.isfile(dest):
			try:
				os.remove(dest)
			except OSError:
				pass
		current_app.logger.exception("Falha ao concluir envio de utilitários")
		return jsonify({"error": "Não foi possível concluir o envio."}), 500
	finally:
		shutil.rmtree(folder, ignore_errors=True)
	return jsonify(_serialize(row, include_author=True)), status


@bp.route("/api/publico")
def api_public_list():
	rows = _list_query().all()
	return jsonify(_list_payload(rows))


@bp.route("/api/publico/hash/<hash_value>", methods=["GET", "OPTIONS"])
@bp.route("/atualizacao/<hash_value>", methods=["GET", "OPTIONS"])
def api_public_update_check(hash_value: str):
	if request.method == "OPTIONS":
		return _cors_json({"ok": True})
	row = _find_by_update_hash(hash_value)
	if not row:
		return _cors_json({"error": "Utilitário não encontrado."}, 404)
	return _cors_json(_update_payload(row))


@bp.route("/api/publico/hash/<hash_value>/download")
@bp.route("/atualizacao/<hash_value>/download")
def api_public_hash_download(hash_value: str):
	row = _find_by_update_hash(hash_value)
	if not row:
		resp = jsonify({"error": "Arquivo não encontrado."})
		resp.status_code = 404
		resp.headers["Access-Control-Allow-Origin"] = "*"
		return resp
	path = _disk_path(row)
	if not path:
		resp = jsonify({"error": "Arquivo não encontrado no servidor."})
		resp.status_code = 404
		resp.headers["Access-Control-Allow-Origin"] = "*"
		return resp
	row.increment_downloads()
	resp = send_file(
		path,
		as_attachment=True,
		download_name=row.original_filename,
		mimetype=row.file_type or "application/octet-stream",
	)
	resp.headers["Access-Control-Allow-Origin"] = "*"
	resp.headers["Access-Control-Expose-Headers"] = "X-Utility-Hash, X-Utility-Version, X-Utility-SHA256"
	resp.headers["X-Utility-Hash"] = row.update_hash or ""
	resp.headers["X-Utility-Version"] = str(int(row.version or 1))
	if row.sha256:
		resp.headers["X-Utility-SHA256"] = row.sha256
	return resp


@bp.route("/api/publico/<int:file_id>/download")
def api_public_download(file_id: int):
	row = UtilityFile.query.get_or_404(file_id)
	path = _disk_path(row)
	if not path:
		return jsonify({"error": "Arquivo não encontrado no servidor."}), 404
	row.increment_downloads()
	return send_file(
		path,
		as_attachment=True,
		download_name=row.original_filename,
		mimetype=row.file_type or "application/octet-stream",
	)


@bp.route("/api")
@login_required
def api_list():
	rows = _list_query().all()
	return jsonify(_list_payload(rows, include_author=True))


@bp.route("/api/categorias")
@login_required
def api_categories():
	return jsonify({"items": _list_categories(), "total": UtilityCategory.query.count()})


@bp.route("/api/categorias", methods=["POST"])
@login_required
def api_create_category():
	data = request.get_json(silent=True) or {}
	name = _normalize_category_name(data.get("name") or "")
	if not name:
		return jsonify({"error": "Nome da categoria é obrigatório."}), 400
	if _category_taken(name):
		return jsonify({"error": "Já existe uma categoria com esse nome."}), 409
	max_pos = db.session.query(func.max(UtilityCategory.position)).scalar() or 0
	row = UtilityCategory(
		name=name,
		position=int(max_pos) + 1,
		created_by_id=current_user.id,
	)
	db.session.add(row)
	db.session.commit()
	return jsonify(_serialize_category(row, 0)), 201


@bp.route("/api/categorias/<int:category_id>", methods=["PATCH"])
@login_required
def api_update_category(category_id: int):
	row = UtilityCategory.query.get_or_404(category_id)
	data = request.get_json(silent=True) or {}
	if "name" in data:
		name = _normalize_category_name(data.get("name") or "")
		if not name:
			return jsonify({"error": "Nome da categoria é obrigatório."}), 400
		if _category_taken(name, exclude_id=row.id):
			return jsonify({"error": "Já existe uma categoria com esse nome."}), 409
		row.name = name
	if "position" in data:
		try:
			row.position = int(data.get("position") or 0)
		except (TypeError, ValueError):
			return jsonify({"error": "Posição inválida."}), 400
	db.session.commit()
	counts = _category_counts()
	return jsonify(_serialize_category(row, counts.get(row.id, 0)))


@bp.route("/api/categorias/<int:category_id>", methods=["DELETE"])
@login_required
def api_delete_category(category_id: int):
	row = UtilityCategory.query.get_or_404(category_id)
	UtilityFile.query.filter_by(category_id=row.id).update({"category_id": None})
	db.session.delete(row)
	db.session.commit()
	return jsonify({"ok": True})


@bp.route("/api", methods=["POST"])
@login_required
def api_upload():
	try:
		saved = _save_files()
		db.session.commit()
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400
	except Exception:
		db.session.rollback()
		current_app.logger.exception("Falha ao enviar arquivo de utilitários")
		return jsonify({"error": "Não foi possível enviar o arquivo."}), 500
	return jsonify({
		"items": [_serialize(row, include_author=True) for row in saved],
		"total": len(saved),
	}), 201


@bp.route("/api/<int:file_id>/arquivo", methods=["POST", "PUT"])
@login_required
def api_replace_file(file_id: int):
	row = UtilityFile.query.get_or_404(file_id)
	files = list(request.files.getlist("files")) + list(request.files.getlist("file"))
	file = next((item for item in files if item and getattr(item, "filename", None)), None)
	if not file:
		return jsonify({"error": "Selecione um arquivo."}), 400
	dest = None
	try:
		original, _ext, safe = _prepare_filename(file.filename)
		file.seek(0, os.SEEK_END)
		size = file.tell()
		file.seek(0)
		if size <= 0:
			raise ValueError("Arquivo vazio.")
		if size > MAX_FILE_SIZE:
			raise ValueError("Cada arquivo pode ter no máximo 1 GB.")
		unique_name = f"{uuid.uuid4().hex}_{safe}"
		dest = os.path.join(_upload_folder(), unique_name)
		file.save(dest)
		old_path = _replace_row_file(
			row,
			unique_name=unique_name,
			original=original,
			size=size,
			mime=file.mimetype or "application/octet-stream",
		)
		title = (request.form.get("title") or "").strip()
		if title:
			row.title = title[:200]
		if "description" in request.form:
			row.description = (request.form.get("description") or "").strip() or None
		if "category_id" in request.form:
			category = _get_category(_parse_category_id(request.form.get("category_id")))
			row.category_id = category.id if category else None
		_after_file_written(row, dest, is_replace=True)
		db.session.commit()
		_remove_old_file(old_path, dest)
	except ValueError as exc:
		db.session.rollback()
		if dest and os.path.isfile(dest):
			try:
				os.remove(dest)
			except OSError:
				pass
		return jsonify({"error": str(exc)}), 400
	except Exception:
		db.session.rollback()
		if dest and os.path.isfile(dest):
			try:
				os.remove(dest)
			except OSError:
				pass
		current_app.logger.exception("Falha ao substituir arquivo de utilitários")
		return jsonify({"error": "Não foi possível substituir o arquivo."}), 500
	return jsonify(_serialize(row, include_author=True))


@bp.route("/api/<int:file_id>", methods=["PATCH"])
@login_required
def api_update(file_id: int):
	row = UtilityFile.query.get_or_404(file_id)
	data = request.get_json(silent=True) or {}
	if "title" in data:
		title = (data.get("title") or "").strip()
		if not title:
			return jsonify({"error": "Título é obrigatório."}), 400
		row.title = title[:200]
	if "description" in data:
		description = (data.get("description") or "").strip()
		row.description = description or None
	if "category_id" in data:
		try:
			category = _get_category(_parse_category_id(data.get("category_id")))
		except ValueError as exc:
			return jsonify({"error": str(exc)}), 400
		row.category_id = category.id if category else None
	db.session.commit()
	return jsonify(_serialize(row, include_author=True))


@bp.route("/api/<int:file_id>", methods=["DELETE"])
@login_required
def api_delete(file_id: int):
	row = UtilityFile.query.get_or_404(file_id)
	path = _disk_path(row)
	db.session.delete(row)
	db.session.commit()
	if path and os.path.isfile(path):
		try:
			os.remove(path)
		except OSError:
			pass
	return jsonify({"ok": True})
