from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash
from .. import db
from ..models import User

bp = Blueprint("users", __name__)


@bp.route("/")
@login_required
def list_users():
	users = User.query.order_by(User.name.asc()).all()  # Buscar todos os usuários
	return render_template("users/list.html", users=users)


@bp.route("/novo", methods=["GET", "POST"])
@login_required
def create_user():
	if request.method == "POST":
		name = request.form.get("name")
		email = request.form.get("email").strip().lower()
		password = request.form.get("password")
		role = request.form.get("role")
		team = request.form.get("team")
		u = User(name=name, email=email, password_hash=generate_password_hash(password), role=role, team=team, phone=(request.form.get("phone") or "").strip() or None)
		db.session.add(u)
		db.session.commit()
		flash("Usuário criado.")
		return redirect(url_for("users.list_users"))
	return render_template("users/new.html")


@bp.route("/editar/<int:user_id>", methods=["GET", "POST"])
@login_required
def edit_user(user_id):
	user = User.query.get_or_404(user_id)
	
	if request.method == "POST":
		user.name = request.form.get("name")
		user.email = request.form.get("email").strip().lower()
		user.role = request.form.get("role")
		user.team = request.form.get("team")
		user.phone = (request.form.get("phone") or "").strip() or None

		# Adicionar a lógica para atualizar o status aqui, se houver um campo no formulário
		status_form = request.form.get("status")
		if status_form is not None:
			user.status = status_form

		# Atualizar senha apenas se fornecida
		password = request.form.get("password")
		if password:
			user.password_hash = generate_password_hash(password)
		
		db.session.commit()
		flash("Usuário atualizado com sucesso.")
		return redirect(url_for("users.list_users"))
	
	return render_template("users/new.html", user=user)


@bp.route("/toggle-status/<int:user_id>", methods=["POST"])
@login_required
def toggle_user_status(user_id):
    # Verificar se o usuário logado é admin
    if not current_user.has_role("admin"):
        flash("Você não tem permissão para realizar esta ação.", "danger")
        return redirect(url_for("users.list_users"))

    user = User.query.get_or_404(user_id)

    # Impedir que um administrador altere o próprio status
    if user.id == current_user.id:
        flash("Você não pode alterar seu próprio status.", "danger")
        return redirect(url_for("users.list_users"))

    # Alternar status: '1' para '0', '0' para '1'
    if user.status == '1':
        user.status = '0'
        flash_message = f"Usuário {user.name} inativado com sucesso."
    else:
        user.status = '1'
        flash_message = f"Usuário {user.name} ativado com sucesso."

    db.session.commit()
    flash(flash_message, "success")
    return redirect(url_for("users.list_users"))