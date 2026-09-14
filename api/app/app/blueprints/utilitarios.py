"""Arquivos públicos da rota /utilitarios."""
from __future__ import annotations

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
from sqlalchemy import or_
from werkzeug.utils import secure_filename

from .. import db
from ..models import UtilityFile
from ..timezone_utils import utc_to_brasilia

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
	payload = {
		"id": row.id,
		"title": row.title,
		"description": row.description or "",
		"original_filename": row.original_filename,
		"file_size": int(row.file_size or 0),
		"file_size_label": _size_label(row.file_size or 0),
		"file_type": row.file_type or "",
		"download_count": int(row.download_count or 0),
		"created_at": _created_at_iso(row.created_at),
		"download_url": f"/utilitarios/api/publico/{row.id}/download",
	}
	if include_author:
		payload["created_by_name"] = row.created_by.name if row.created_by else ""
	return payload


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
	return query.order_by(UtilityFile.created_at.desc())


def _save_files() -> list[UtilityFile]:
	files = list(request.files.getlist("files")) + list(request.files.getlist("file"))
	title = (request.form.get("title") or "").strip()
	description = (request.form.get("description") or "").strip() or None
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
			created_by_id=current_user.id,
		)
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
	chunk_size = _chunk_size()
	total_chunks = max(1, math.ceil(size / chunk_size))
	_cleanup_stale_uploads()
	upload_id = uuid.uuid4().hex
	folder = _incoming_dir(upload_id)
	folder.mkdir(parents=True, exist_ok=True)
	title = (data.get("title") or "").strip()
	description = (data.get("description") or "").strip() or None
	_write_meta(folder, {
		"user_id": current_user.id,
		"original_filename": original,
		"safe_name": safe,
		"size": size,
		"title": (title or Path(original).stem or original)[:200],
		"description": description,
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
		row = UtilityFile(
			title=(meta.get("title") or "arquivo")[:200],
			description=meta.get("description") or None,
			filename=unique_name,
			original_filename=meta.get("original_filename") or "arquivo",
			file_path=unique_name,
			file_size=written,
			file_type=meta.get("mime") or "application/octet-stream",
			created_by_id=current_user.id,
		)
		db.session.add(row)
		db.session.commit()
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
	return jsonify(_serialize(row, include_author=True)), 201


@bp.route("/api/publico")
def api_public_list():
	rows = _list_query().all()
	return jsonify({"items": [_serialize(row) for row in rows], "total": len(rows)})


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
	return jsonify({
		"items": [_serialize(row, include_author=True) for row in rows],
		"total": len(rows),
	})


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
