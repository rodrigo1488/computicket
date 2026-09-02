"""Armazenamento local da foto de perfil dos usuários."""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from flask import Response, current_app, jsonify, send_file
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from . import db
from .models import User

ALLOWED_AVATAR = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_AVATAR_BYTES = 5 * 1024 * 1024


def avatar_dir() -> Path:
	folder = Path(current_app.root_path) / "uploads" / "avatars"
	folder.mkdir(parents=True, exist_ok=True)
	return folder


def avatar_abs_path(user: User) -> Path | None:
	if not user.avatar_path:
		return None
	root = Path(current_app.root_path).resolve()
	allowed = (root / "uploads" / "avatars").resolve()
	path = (root / user.avatar_path).resolve()
	try:
		path.relative_to(allowed)
	except ValueError:
		return None
	return path if path.is_file() else None


def avatar_public_url(user: User, *, me: bool = False) -> str | None:
	path = avatar_abs_path(user)
	if not path:
		return None
	try:
		version = int(path.stat().st_mtime)
	except OSError:
		version = user.id
	if me:
		return f"/flask/auth/api/me/avatar?v={version}"
	return f"/flask/api/web/users/{user.id}/avatar?v={version}"


def send_user_avatar(user: User):
	path = avatar_abs_path(user)
	if not path:
		return jsonify({"error": "Sem avatar"}), 404
	return send_file(path)


def delete_user_avatar(user: User, *, commit: bool = True) -> None:
	path = avatar_abs_path(user)
	if path and path.is_file():
		path.unlink(missing_ok=True)
	if user.avatar_path:
		user.avatar_path = None
		if commit:
			db.session.commit()


def save_user_avatar(user: User, file: FileStorage | None) -> Response | tuple | None:
	if not file or not file.filename:
		return jsonify({"error": "Envie uma imagem."}), 400
	ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
	if ext not in ALLOWED_AVATAR:
		return jsonify({"error": "Use PNG, JPG, GIF ou WebP."}), 400
	file.stream.seek(0, os.SEEK_END)
	size = file.stream.tell()
	file.stream.seek(0)
	if size > MAX_AVATAR_BYTES:
		return jsonify({"error": "A imagem deve ter no máximo 5 MB."}), 400
	filename = f"{user.id}_{uuid.uuid4().hex}.{ext}"
	dest = avatar_dir() / secure_filename(filename)
	old = avatar_abs_path(user)
	file.save(dest)
	if old and old.is_file() and old != dest:
		old.unlink(missing_ok=True)
	user.avatar_path = os.path.join("uploads", "avatars", dest.name).replace("\\", "/")
	db.session.commit()
	return None
