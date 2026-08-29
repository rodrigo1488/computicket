from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required
from .. import db
from ..models import Service

bp = Blueprint("services", __name__)


@bp.route("/")
@login_required
def list_services():
	services = Service.query.order_by(Service.name.asc()).all()
	return render_template("services/list.html", services=services)


@bp.route("/novo", methods=["GET", "POST"])
@login_required
def create_service():
	if request.method == "POST":
		name = request.form.get("name")
		description = request.form.get("description")
		hourly_rate = request.form.get("hourly_rate", type=float) or 0.0
		s = Service(name=name, description=description, hourly_rate=hourly_rate)
		db.session.add(s)
		db.session.commit()
		flash("Serviço criado.")
		return redirect(url_for("services.list_services"))
	return render_template("services/new.html")


@bp.route("/<int:service_id>/editar", methods=["GET", "POST"])
@login_required
def edit_service(service_id: int):
	s = Service.query.get_or_404(service_id)
	if request.method == "POST":
		s.name = request.form.get("name")
		s.description = request.form.get("description")
		s.hourly_rate = request.form.get("hourly_rate", type=float) or 0.0
		db.session.commit()
		flash("Serviço atualizado.")
		return redirect(url_for("services.list_services"))
	return render_template("services/edit.html", service=s)
