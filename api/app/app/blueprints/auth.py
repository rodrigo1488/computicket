from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, send_file, current_app
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from pathlib import Path
import os
import uuid
from .. import db
from ..models import User, UserAvailability

bp = Blueprint("auth", __name__, url_prefix="/auth")

ALLOWED_AVATAR = {"png", "jpg", "jpeg", "gif", "webp"}


def _json_payload():
	if request.is_json:
		return request.get_json(silent=True) or {}
	return request.form.to_dict()


def _user_payload(user: User) -> dict:
	slots = (
		UserAvailability.query.filter_by(user_id=user.id)
		.order_by(UserAvailability.hour.asc())
		.all()
	)
	return {
		"id": user.id,
		"name": user.name,
		"email": user.email,
		"role": user.role,
		"team": user.team,
		"status": user.status,
		"avatar_url": f"/flask/auth/api/me/avatar" if user.avatar_path else None,
		"availability": [s.hour for s in slots],
	}


@bp.route("/login", methods=["GET", "POST"])
def login():
	if request.method == "POST":
		email = request.form.get("email", "").strip().lower()
		password = request.form.get("password", "")
		user = User.query.filter_by(email=email).first()

		if user and check_password_hash(user.password_hash, password):
			# Verificar se o usuário está ativo
			if user.status == '0':  # Assumindo '0' para inativo
				flash("Sua conta está inativa. Entre em contato com o administrador.", "danger")
				return redirect(url_for("auth.login"))
			login_user(user)
			return redirect(url_for("dashboard.index"))
		flash("Credenciais inválidas.", "danger")
	return render_template("auth/login.html")


@bp.route("/logout")
@login_required
def logout():
	logout_user()
	return redirect(url_for("auth.login"))


@bp.route("/seed-admin")
def seed_admin():
	"""Cria um usuário admin padrão, útil em ambiente dev."""
	if not User.query.filter_by(email="admin@example.com").first():
		user = User(name="Admin", email="admin@example.com", password_hash=generate_password_hash("admin"), role="admin")
		db.session.add(user)
		db.session.commit()
		flash("Admin criado: admin@example.com / admin")
	else:
		flash("Admin já existe.")
	return redirect(url_for("auth.login"))


@bp.route("/api/login", methods=["POST", "OPTIONS"])
def api_login():
	if request.method == "OPTIONS":
		return "", 204
	data = _json_payload()
	email = (data.get("email") or "").strip().lower()
	password = data.get("password") or ""
	user = User.query.filter_by(email=email).first()
	if not user or not check_password_hash(user.password_hash, password):
		return jsonify({"error": "Credenciais inválidas."}), 401
	if user.status == "0":
		return jsonify({"error": "Sua conta está inativa. Entre em contato com o administrador."}), 403
	login_user(user)
	return jsonify(_user_payload(user))


@bp.route("/api/logout", methods=["POST", "OPTIONS"])
@login_required
def api_logout():
	if request.method == "OPTIONS":
		return "", 204
	logout_user()
	return jsonify({"ok": True})


@bp.route("/api/me", methods=["GET", "PATCH", "OPTIONS"])
@login_required
def api_me():
	if request.method == "OPTIONS":
		return "", 204
	if request.method == "GET":
		return jsonify(_user_payload(current_user))

	data = _json_payload()
	name = (data.get("name") or "").strip()
	email = (data.get("email") or "").strip().lower()
	if name:
		current_user.name = name
	if email:
		existing = User.query.filter(User.email == email, User.id != current_user.id).first()
		if existing:
			return jsonify({"error": "E-mail já em uso."}), 400
		current_user.email = email
	db.session.commit()
	return jsonify(_user_payload(current_user))


@bp.route("/api/change-password", methods=["POST", "OPTIONS"])
@login_required
def api_change_password():
	if request.method == "OPTIONS":
		return "", 204
	data = _json_payload()
	current_password = data.get("current_password") or data.get("senha_atual") or ""
	new_password = data.get("new_password") or data.get("nova_senha") or ""
	if not check_password_hash(current_user.password_hash, current_password):
		return jsonify({"error": "Senha atual incorreta."}), 400
	if len(new_password) < 6:
		return jsonify({"error": "A nova senha deve ter no mínimo 6 dígitos."}), 400
	current_user.password_hash = generate_password_hash(new_password)
	db.session.commit()
	return jsonify({"ok": True})


def _avatar_dir() -> Path:
	folder = Path(current_app.root_path) / "uploads" / "avatars"
	folder.mkdir(parents=True, exist_ok=True)
	return folder


@bp.route("/api/me/avatar", methods=["GET", "POST", "DELETE", "OPTIONS"])
@login_required
def api_me_avatar():
	if request.method == "OPTIONS":
		return "", 204
	if request.method == "GET":
		if not current_user.avatar_path:
			return jsonify({"error": "Sem avatar"}), 404
		path = Path(current_app.root_path) / current_user.avatar_path
		if not path.is_file():
			return jsonify({"error": "Arquivo não encontrado"}), 404
		return send_file(path)

	if request.method == "DELETE":
		if current_user.avatar_path:
			old = Path(current_app.root_path) / current_user.avatar_path
			if old.is_file():
				old.unlink(missing_ok=True)
			current_user.avatar_path = None
			db.session.commit()
		return jsonify(_user_payload(current_user))

	file = request.files.get("file") or request.files.get("avatar")
	if not file or not file.filename:
		return jsonify({"error": "Envie uma imagem."}), 400
	ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
	if ext not in ALLOWED_AVATAR:
		return jsonify({"error": "Tipo de arquivo não permitido."}), 400
	filename = f"{current_user.id}_{uuid.uuid4().hex}.{ext}"
	dest = _avatar_dir() / secure_filename(filename)
	file.save(dest)
	if current_user.avatar_path:
		old = Path(current_app.root_path) / current_user.avatar_path
		if old.is_file() and old != dest:
			old.unlink(missing_ok=True)
	current_user.avatar_path = os.path.join("uploads", "avatars", dest.name).replace("\\", "/")
	db.session.commit()
	return jsonify(_user_payload(current_user))
