"""Arquivos públicos da rota /utilitarios."""
from __future__ import annotations

import os
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


def _upload_folder() -> str:
	folder = os.path.join(current_app.instance_path, "utilitarios_uploads")
	os.makedirs(folder, exist_ok=True)
	return folder


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
		original = _display_name(file.filename)
		ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
		if ext not in ALLOWED_EXTENSIONS:
			raise ValueError(f"Tipo de arquivo não permitido: .{ext or 'sem extensão'}")
		safe = secure_filename(original) or f"arquivo.{ext}"
		if "." not in safe:
			safe = f"{safe}.{ext}"
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
