"""JSON para o frontend Next.js — listagens dos módulos existentes."""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import case, cast, func, String
from werkzeug.security import generate_password_hash

from .. import db
from ..models import (
	Appointment,
	Budget,
	BudgetTheme,
	Client,
	ClientContract,
	ClientPlan,
	InventoryItem,
	KnowledgeArticle,
	KnowledgeCategory,
	PasswordVault,
	Plan,
	Service,
	ServiceOrder,
	System,
	SystemConfig,
	Ticket,
	TimeEntry,
	User,
	UserAvailability,
)
from ..external_pg import (
	create_external_client,
	fetch_contract_types,
	fetch_external_clients,
	get_contracts_with_services,
	update_contract_type,
	update_external_client,
)
from ..timezone_utils import brasilia_to_utc, get_brasilia_now, utc_to_brasilia
from ..query_filters import filter_dicts, filter_query

bp = Blueprint("web_api", __name__, url_prefix="/api/web")


def _fmt(dt):
	if not dt:
		return None
	try:
		return utc_to_brasilia(dt).strftime("%d/%m/%Y %H:%M")
	except Exception:
		try:
			return dt.strftime("%d/%m/%Y %H:%M")
		except Exception:
			return str(dt)


def _page_args(default=25, lo=6, hi=200):
	try:
		page = max(1, int(request.args.get("page", 1)))
	except (TypeError, ValueError):
		page = 1
	try:
		per_page = min(hi, max(lo, int(request.args.get("per_page", default))))
	except (TypeError, ValueError):
		per_page = default
	return page, per_page


def _slice_page(items, default=25, lo=6, hi=200):
	page, per_page = _page_args(default, lo, hi)
	rows = filter_dicts(items)
	total = len(rows)
	start = (page - 1) * per_page
	return {
		"items": rows[start:start + per_page],
		"total": total,
		"page": page,
		"per_page": per_page,
	}


def _json():
	return request.get_json(silent=True) or {}


def _require_admin():
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem realizar esta ação."}), 403
	return None


@bp.route("/dashboard")
@login_required
def dashboard():
	from .dashboard import get_dashboard_data

	data = get_dashboard_data()
	hours = []
	users_map = data.get("users") or {}
	for uid, total in data.get("hours_by_user") or []:
		u = users_map.get(uid) if isinstance(users_map, dict) else None
		name = u.get("name") if isinstance(u, dict) else (getattr(u, "name", None) or str(uid))
		hours.append({"user_id": uid, "name": name, "hours": float(total or 0)})
	hours.sort(key=lambda x: x["hours"], reverse=True)
	in_progress = []
	for tech in data.get("technicians_in_progress") or []:
		in_progress.append({
			"name": tech.get("name"),
			"tickets_count": tech.get("tickets_count") or 0,
			"total_hours": float(tech.get("total_hours") or 0),
			"tickets": [
				{
					"id": t.get("id"),
					"title": t.get("title"),
					"client_name": t.get("client_name"),
					"hours": float(t.get("hours") or 0),
					"card_color": t.get("card_color"),
				}
				for t in (tech.get("tickets") or [])
			],
		})
	return jsonify({
		"status_counts": data.get("status_counts") or {},
		"technician_ranking": data.get("technician_ranking") or [],
		"hours_by_user": hours,
		"technicians_in_progress": in_progress,
		"tickets_hoje_count": data.get("tickets_hoje_count") or 0,
		"faturamento_hoje": float(data.get("faturamento_hoje") or 0),
		"tickets_mes_count": data.get("tickets_mes_count") or 0,
		"os_mes_count": data.get("os_mes_count") or 0,
		"total_hours": float(data.get("total_hours") or 0),
		"tickets_por_dia": data.get("tickets_por_dia") or [],
	})


@bp.route("/dashboard/helpdesk")
@login_required
def dashboard_helpdesk():
	from .dashboard import get_helpdesk_dashboard_data

	data = get_helpdesk_dashboard_data()
	return jsonify({
		"ok": bool(data.get("ok")),
		"error": data.get("error"),
		"summary": data.get("summary") or {},
		"queues": data.get("queues") or [],
		"connections": data.get("connections") or [],
		"users": data.get("users") or [],
		"tickets_mes_count": data.get("tickets_mes_count") or 0,
		"conversas_mes_count": data.get("conversas_mes_count") or 0,
		"comparativo_por_dia": data.get("comparativo_por_dia") or [],
	})


OPEN_TICKET_STATUSES = ("aberto", "em_andamento")
CLOSED_TICKET_STATUSES = ("fechado", "cancelado")
STALE_TICKET_DAYS = 7


def _stale_ticket_cutoff():
	cutoff = brasilia_to_utc(get_brasilia_now()) - timedelta(days=STALE_TICKET_DAYS)
	if getattr(cutoff, "tzinfo", None):
		return cutoff.replace(tzinfo=None)
	return cutoff


def _stale_tickets_query(user_id: int):
	"""Tickets abertos do responsável, criados há mais de 7 dias."""
	return Ticket.query.filter(
		Ticket.assigned_to_id == user_id,
		Ticket.status.in_(OPEN_TICKET_STATUSES),
		Ticket.status.notin_(CLOSED_TICKET_STATUSES),
		Ticket.created_at.isnot(None),
		Ticket.created_at <= _stale_ticket_cutoff(),
	)


@bp.route("/tickets/stale-count")
@login_required
def tickets_stale_count():
	"""Conta só os tickets atrasados do usuário logado (admin inclusive)."""
	count = _stale_tickets_query(current_user.id).count()
	return jsonify({"count": int(count)})


@bp.route("/clients")
@login_required
def clients():
	from ..external_pg import ExternalPgError, fetch_external_clients_search

	q = (request.args.get("q") or "").strip()
	try:
		if q:
			items = fetch_external_clients_search(q)
		else:
			items = fetch_external_clients()
	except ExternalPgError as e:
		return jsonify({"error": str(e), "items": [], "total": 0, "page": 1, "per_page": 25}), 503
	except Exception as e:
		return jsonify({
			"error": f"Falha ao carregar clientes do Unico: {e}",
			"items": [],
			"total": 0,
			"page": 1,
			"per_page": 25,
		}), 503
	payload = _slice_page(items, default=25)
	return jsonify(payload)


def _user_json(u: User):
	return {
		"id": u.id,
		"name": u.name,
		"email": u.email,
		"role": u.role,
		"team": u.team,
		"status": u.status,
	}


@bp.route("/users")
@login_required
def users():
	q = (request.args.get("q") or "").strip().lower()
	status = (request.args.get("status") or "1").strip()
	query = User.query
	if q:
		like = f"%{q}%"
		query = query.filter((User.name.ilike(like)) | (User.email.ilike(like)) | (User.role.ilike(like)))
	if status not in ("all", "*", "todos"):
		if status in ("0", "1"):
			query = query.filter(User.status == status)
		else:
			query = query.filter(User.status == "1")
	status_label = case((User.status == "1", "Ativo"), else_="Inativo")
	query = filter_query(query, {
		"name": User.name,
		"email": User.email,
		"role": User.role,
		"team": User.team,
		"status": status_label,
	})
	query = query.order_by(User.name.asc())
	page, per_page = _page_args(25)
	pagination = query.paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"items": [_user_json(u) for u in pagination.items],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/users", methods=["POST"])
@login_required
def create_user_json():
	denied = _require_admin()
	if denied:
		return denied
	data = _json()
	name = (data.get("name") or "").strip()
	email = (data.get("email") or "").strip().lower()
	password = data.get("password") or ""
	role = (data.get("role") or "tecnico").strip()
	team = data.get("team") or "Equipe 1"
	if not name or not email or not password:
		return jsonify({"error": "Nome, e-mail e senha são obrigatórios."}), 400
	if User.query.filter_by(email=email).first():
		return jsonify({"error": "E-mail já cadastrado."}), 400
	u = User(name=name, email=email, password_hash=generate_password_hash(password), role=role, team=team, status="1")
	db.session.add(u)
	db.session.commit()
	return jsonify(_user_json(u)), 201


@bp.route("/users/<int:user_id>", methods=["GET", "PATCH", "DELETE"])
@login_required
def user_item(user_id: int):
	user = User.query.get_or_404(user_id)
	if request.method == "GET":
		return jsonify(_user_json(user))
	denied = _require_admin()
	if denied:
		return denied
	if request.method == "DELETE":
		if user.id == current_user.id:
			return jsonify({"error": "Você não pode excluir o próprio usuário."}), 400
		try:
			db.session.delete(user)
			db.session.commit()
		except Exception:
			db.session.rollback()
			return jsonify({"error": "Não é possível excluir: há registros vinculados. Inative o usuário."}), 409
		return jsonify({"ok": True})
	data = _json()
	if data.get("name") is not None:
		user.name = (data.get("name") or "").strip() or user.name
	if data.get("email") is not None:
		email = (data.get("email") or "").strip().lower()
		if email and email != user.email:
			if User.query.filter(User.email == email, User.id != user.id).first():
				return jsonify({"error": "E-mail já cadastrado."}), 400
			user.email = email
	if data.get("role") is not None:
		user.role = data.get("role") or user.role
	if "team" in data:
		user.team = data.get("team")
	if data.get("status") is not None:
		if user.id == current_user.id:
			return jsonify({"error": "Você não pode alterar o próprio status."}), 400
		user.status = str(data.get("status"))
	# Senha não é alterada por este endpoint (evita reset acidental).
	db.session.commit()
	return jsonify(_user_json(user))


@bp.route("/users/<int:user_id>/toggle-status", methods=["POST"])
@login_required
def toggle_user_status_json(user_id: int):
	denied = _require_admin()
	if denied:
		return denied
	user = User.query.get_or_404(user_id)
	if user.id == current_user.id:
		return jsonify({"error": "Você não pode alterar o próprio status."}), 400
	user.status = "0" if user.status == "1" else "1"
	db.session.commit()
	return jsonify(_user_json(user))


@bp.route("/users/<int:user_id>/availability", methods=["GET", "PUT"])
@login_required
def user_availability(user_id: int):
	user = User.query.get_or_404(user_id)
	if request.method == "GET":
		slots = UserAvailability.query.filter_by(user_id=user.id).order_by(UserAvailability.hour.asc()).all()
		return jsonify({"hours": [s.hour for s in slots]})
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem definir horários."}), 403
	data = request.get_json(silent=True) or {}
	hours = data.get("hours") or []
	UserAvailability.query.filter_by(user_id=user.id).delete()
	for h in hours:
		h = str(h).strip()
		if h:
			db.session.add(UserAvailability(user_id=user.id, hour=h[:5]))
	db.session.commit()
	slots = UserAvailability.query.filter_by(user_id=user.id).order_by(UserAvailability.hour.asc()).all()
	return jsonify({"hours": [s.hour for s in slots]})


def _service_json(s: Service):
	return {"id": s.id, "name": s.name, "description": s.description or "", "hourly_rate": float(s.hourly_rate or 0)}


@bp.route("/services")
@login_required
def services():
	q = (request.args.get("q") or "").strip().lower()
	query = Service.query
	if q:
		like = f"%{q}%"
		query = query.filter((Service.name.ilike(like)) | (Service.description.ilike(like)))
	query = filter_query(query, {
		"name": Service.name,
		"description": Service.description,
		"hourly_rate": Service.hourly_rate,
		"valor": Service.hourly_rate,
	})
	query = query.order_by(Service.name.asc())
	page, per_page = _page_args(25)
	pagination = query.paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"items": [_service_json(s) for s in pagination.items],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/services", methods=["POST"])
@login_required
def create_service_json():
	data = _json()
	name = (data.get("name") or "").strip()
	if not name:
		return jsonify({"error": "Nome é obrigatório."}), 400
	if Service.query.filter_by(name=name).first():
		return jsonify({"error": "Já existe um serviço com esse nome."}), 400
	s = Service(
		name=name,
		description=(data.get("description") or "").strip(),
		hourly_rate=float(data.get("hourly_rate") or 0),
	)
	db.session.add(s)
	db.session.commit()
	return jsonify(_service_json(s)), 201


@bp.route("/services/<int:service_id>", methods=["GET", "PATCH"])
@login_required
def service_item(service_id: int):
	s = Service.query.get_or_404(service_id)
	if request.method == "GET":
		return jsonify(_service_json(s))
	data = _json()
	if data.get("name") is not None:
		name = (data.get("name") or "").strip()
		if not name:
			return jsonify({"error": "Nome é obrigatório."}), 400
		dup = Service.query.filter(Service.name == name, Service.id != s.id).first()
		if dup:
			return jsonify({"error": "Já existe um serviço com esse nome."}), 400
		s.name = name
	if "description" in data:
		s.description = data.get("description") or ""
	if data.get("hourly_rate") is not None:
		try:
			s.hourly_rate = float(data.get("hourly_rate") or 0)
		except (TypeError, ValueError):
			return jsonify({"error": "Valor hora inválido."}), 400
	db.session.commit()
	return jsonify(_service_json(s))


@bp.route("/contracts")
@login_required
def contracts():
	try:
		items = get_contracts_with_services()
	except Exception as e:
		return jsonify({"items": [], "error": str(e)}), 503
	q = (request.args.get("q") or "").strip().lower()
	if q:
		items = [c for c in items if q in str(c.get("name") or c.get("contract_name") or "").lower()]
	stats_by_name = {}
	for record in ClientContract.query.all():
		stats = stats_by_name.setdefault(record.contract_name, {
			"total": 0, "vencidos": 0, "vencendo": 0, "cancelados": 0,
		})
		stats["total"] += 1
		display = record.display_status
		if display == "vencido":
			stats["vencidos"] += 1
		elif display == "vencendo":
			stats["vencendo"] += 1
		elif display == "cancelado":
			stats["cancelados"] += 1
	mapped = []
	for c in items:
		name = c.get("name") or c.get("contract_name") or ""
		services = c.get("services") or []
		stats = stats_by_name.get(name) or {"total": 0, "vencidos": 0, "vencendo": 0, "cancelados": 0}
		if stats["vencidos"]:
			status = f"{stats['vencidos']} vencido(s)"
		elif stats["vencendo"]:
			status = f"{stats['vencendo']} vencendo"
		else:
			status = "Ativo"
		mapped.append({
			"name": name,
			"services": services,
			"services_count": len(services),
			"clients_count": stats["total"],
			"status": status,
		})
	return jsonify(_slice_page(mapped, default=25))


@bp.route("/contract-types")
@login_required
def contract_types():
	try:
		return jsonify(fetch_contract_types())
	except Exception as e:
		return jsonify({"error": str(e), "items": []}), 503


@bp.route("/agenda")
@login_required
def agenda():
	start = request.args.get("start")
	end = request.args.get("end")
	query = Appointment.query
	if start:
		try:
			query = query.filter(Appointment.appointment_date >= datetime.fromisoformat(start.replace("Z", "+00:00")))
		except ValueError:
			pass
	if end:
		try:
			query = query.filter(Appointment.appointment_date <= datetime.fromisoformat(end.replace("Z", "+00:00")))
		except ValueError:
			pass
	if not start and not end:
		now = get_brasilia_now()
		query = query.filter(Appointment.appointment_date >= now - timedelta(days=7))
	query = query.order_by(Appointment.appointment_date.asc())
	page, per_page = _page_args(25)
	pagination = query.paginate(page=page, per_page=per_page, error_out=False)
	ext = {}
	try:
		ext = {c.get("id"): c.get("name") for c in fetch_external_clients()}
	except Exception:
		pass
	return jsonify({
		"items": [
			{
				"id": a.id,
				"title": a.title,
				"description": a.description or "",
				"date": _fmt(a.appointment_date),
				"iso": a.appointment_date.isoformat() if a.appointment_date else None,
				"client_id": a.client_id,
				"client_name": ext.get(a.client_id) or a.get_client_name(),
				"user_id": a.user_id,
				"user_name": a.get_user_name(),
				"service_id": a.service_id,
				"service_name": a.get_service_name(),
			}
			for a in pagination.items
		],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/service-orders")
@login_required
def service_orders():
	page, per_page = _page_args(20)
	q = (request.args.get("q") or "").strip()
	query = ServiceOrder.query
	if q:
		like = f"%{q}%"
		query = query.filter(
			(ServiceOrder.codigo.ilike(like))
			| (ServiceOrder.client_name.ilike(like))
			| (ServiceOrder.technician_name.ilike(like))
			| (ServiceOrder.equipment.ilike(like))
		)
	status_label = case(
		(ServiceOrder.status == 3, "Finalizada sem cobrança"),
		(ServiceOrder.status == 5, "Finalizada com cobrança"),
		else_=cast(ServiceOrder.status, String),
	)
	query = filter_query(query, {
		"codigo": ServiceOrder.codigo,
		"client_name": ServiceOrder.client_name,
		"technician_name": ServiceOrder.technician_name,
		"value": ServiceOrder.value,
		"status": status_label,
		"completion_date": ServiceOrder.completion_date,
	})
	query = query.order_by(ServiceOrder.completion_date.desc())
	pagination = query.paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"items": [
			{
				"id": o.id,
				"codigo": o.codigo,
				"client_name": o.client_name,
				"technician_name": o.technician_name,
				"value": float(o.value or 0),
				"status": o.status,
				"status_text": o.status_text(),
				"completion_date": o.formatted_completion_date(),
				"equipment": o.equipment or "",
				"service_executed": o.service_executed or "",
				"ps_number": o.ps_number,
				"ps_file": o.ps_file,
				"delivery_file": o.delivery_file,
				"has_contract": bool(o.has_contract),
				"no_charge": bool(o.no_charge),
			}
			for o in pagination.items
		],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


def _os_json(o: ServiceOrder):
	return {
		"id": o.id,
		"codigo": o.codigo,
		"client_name": o.client_name,
		"client_document": o.client_document,
		"client_phone": o.client_phone,
		"technician_name": o.technician_name,
		"value": float(o.value or 0),
		"status": o.status,
		"status_text": o.status_text(),
		"completion_date": o.formatted_completion_date(),
		"opening_date": o.formatted_opening_date() if hasattr(o, "formatted_opening_date") else None,
		"equipment": o.equipment or "",
		"problem_description": o.problem_description or "",
		"service_executed": o.service_executed or "",
		"observations": o.observations or "",
		"ps_number": o.ps_number,
		"ps_file": o.ps_file,
		"delivery_file": o.delivery_file,
		"has_contract": bool(o.has_contract),
		"no_charge": bool(o.no_charge),
	}


@bp.route("/service-orders/<int:order_id>")
@login_required
def service_order_item(order_id: int):
	return jsonify(_os_json(ServiceOrder.query.get_or_404(order_id)))


@bp.route("/plans")
@login_required
def plans():
	q = (request.args.get("q") or "").strip().lower()
	systems = System.query.order_by(System.name.asc()).all()
	mapped = [
		{
			"id": s.id,
			"name": s.name,
			"description": s.description or "",
			"version": s.version or "",
			"company": s.company or "",
			"is_active": bool(s.is_active),
			"plans_count": len(s.plans or []),
		}
		for s in systems
	]
	if q:
		mapped = [
			s for s in mapped
			if q in (s["name"] or "").lower() or q in (s["description"] or "").lower()
		]
	total_plans = db.session.query(func.count(Plan.id)).filter(Plan.is_active == True).scalar() or 0
	active_client_plans = db.session.query(func.count(ClientPlan.id)).filter(ClientPlan.is_active == True).scalar() or 0
	return jsonify({
		"total_plans": total_plans,
		"active_client_plans": active_client_plans,
		**_slice_page(mapped, default=25),
	})


@bp.route("/reports")
@login_required
def reports():
	from datetime import date
	from .reports import (
		api_billing_by_technician,
		api_hours_by_client,
		api_hours_by_technician,
		api_productivity_metrics,
		api_service_performance,
		api_tickets_by_technician,
		api_tickets_by_client,
	)

	from urllib.parse import urlencode

	today = date.today()
	start = (request.args.get("start") or "").strip() or today.replace(day=1).isoformat()
	end = (request.args.get("end") or "").strip() or today.isoformat()
	# Garante que as APIs originais (/relatorios/api/*) vejam o mesmo período,
	# inclusive quando o cliente omite start/end e usamos o padrão do mês.
	if request.args.get("start") != start or request.args.get("end") != end:
		qs = request.args.to_dict()
		qs["start"] = start
		qs["end"] = end
		request.environ["QUERY_STRING"] = urlencode(qs)
		request.__dict__.pop("args", None)

	ticket_q = Ticket.query.filter(Ticket.status != "cancelado")
	os_q = ServiceOrder.query
	hours_q = (
		db.session.query(func.sum(TimeEntry.hours))
		.select_from(TimeEntry)
		.join(Ticket, TimeEntry.ticket_id == Ticket.id)
		.filter(Ticket.status != "cancelado")
	)
	try:
		start_dt = datetime.fromisoformat(start)
		ticket_q = ticket_q.filter(Ticket.created_at >= start_dt)
		os_q = os_q.filter(ServiceOrder.completion_date >= start_dt)
		hours_q = hours_q.filter(TimeEntry.created_at >= start_dt)
	except ValueError:
		pass
	try:
		end_dt = datetime.fromisoformat(end) + timedelta(hours=23, minutes=59, seconds=59)
		ticket_q = ticket_q.filter(Ticket.created_at <= end_dt)
		os_q = os_q.filter(ServiceOrder.completion_date <= end_dt)
		hours_q = hours_q.filter(TimeEntry.created_at <= end_dt)
	except ValueError:
		pass

	status_counts = dict(
		ticket_q.with_entities(Ticket.status, func.count(Ticket.id)).group_by(Ticket.status).all()
	)

	def _payload(view_fn, fallback):
		resp = view_fn()
		data = resp.get_json(silent=True) if hasattr(resp, "get_json") else None
		return data if data is not None else fallback

	# Reutiliza as queries da página original (/relatorios) no mesmo request
	# (os handlers leem start/end de request.args; o frontend sempre envia o período).
	return jsonify({
		"start": start,
		"end": end,
		"status_counts": status_counts,
		"total_hours": float(hours_q.scalar() or 0),
		"total_tickets": ticket_q.count(),
		"total_os": os_q.count(),
		"hours_by_client": _payload(api_hours_by_client, []),
		"hours_by_technician": _payload(api_hours_by_technician, []),
		"billing_by_technician": _payload(api_billing_by_technician, []),
		"tickets_by_technician": _payload(api_tickets_by_technician, []),
		"tickets_by_client": _payload(api_tickets_by_client, []),
		"productivity": _payload(api_productivity_metrics, {}),
		"service_performance": _payload(api_service_performance, []),
	})


def _vault_password_counts():
	internal_counts = dict(
		db.session.query(PasswordVault.client_id, func.count(PasswordVault.id))
		.filter(PasswordVault.client_id.isnot(None), PasswordVault.client_id != -1)
		.group_by(PasswordVault.client_id)
		.all()
	)
	external_counts = dict(
		db.session.query(PasswordVault.external_client_id, func.count(PasswordVault.id))
		.filter(PasswordVault.external_client_id.isnot(None))
		.group_by(PasswordVault.external_client_id)
		.all()
	)
	return internal_counts, external_counts


def _vault_client_payload(client_id: int, is_external: bool):
	if not is_external:
		client = Client.query.get(client_id)
		if client:
			return {
				"id": client.id,
				"name": client.name,
				"phone": client.phone or "",
				"document": client.document or "",
				"contract_type": client.contract_type or "",
				"is_external": False,
				"origin": "Interno",
			}
	try:
		for ext in fetch_external_clients() or []:
			if int(ext.get("id") or 0) == int(client_id):
				return {
					"id": ext["id"],
					"name": ext.get("name") or "",
					"phone": ext.get("phone") or "",
					"document": ext.get("document") or "",
					"contract_type": ext.get("contract_type") or "",
					"is_external": True,
					"origin": "Externo",
				}
	except Exception:
		pass
	row = PasswordVault.query.filter_by(external_client_id=client_id).first()
	if row:
		return {
			"id": client_id,
			"name": row.external_client_name or f"Cliente {client_id}",
			"phone": "",
			"document": "",
			"contract_type": "",
			"is_external": True,
			"origin": "Externo",
		}
	return None


def _vault_entry_json(row: PasswordVault):
	return {
		"id": row.id,
		"client_name": row.get_client_name(),
		"machine_name": row.machine_name,
		"anydesk_code": row.anydesk_code or "",
		"description": row.description or "",
		"created_at": _fmt(row.created_at),
		"updated_at": _fmt(row.updated_at),
		"created_by": row.created_by.name if row.created_by else "",
	}


@bp.route("/vault", methods=["GET", "POST"])
@login_required
def vault():
	if request.method == "POST":
		data = _json()
		client_id = data.get("client_id")
		try:
			client_id = int(client_id)
		except (TypeError, ValueError):
			return jsonify({"error": "Cliente é obrigatório."}), 400
		is_external = bool(data.get("is_external"))
		client = _vault_client_payload(client_id, is_external)
		if not client:
			return jsonify({"error": "Cliente não encontrado."}), 404
		is_external = bool(client["is_external"])
		machine_name = (data.get("machine_name") or "").strip()
		password = (data.get("password") or "").strip()
		if not machine_name or not password:
			return jsonify({"error": "Nome da máquina e senha são obrigatórios."}), 400
		if is_external:
			existing = PasswordVault.query.filter_by(external_client_id=client_id, machine_name=machine_name).first()
		else:
			existing = PasswordVault.query.filter_by(client_id=client_id, machine_name=machine_name).first()
		if existing:
			return jsonify({"error": f'Já existe uma entrada para a máquina "{machine_name}".'}), 400
		from .password_vault import encrypt_password
		if is_external:
			row = PasswordVault(
				client_id=-1,
				external_client_id=client_id,
				external_client_name=client["name"],
				machine_name=machine_name,
				anydesk_code=(data.get("anydesk_code") or "").strip() or None,
				password=encrypt_password(password),
				description=(data.get("description") or "").strip() or None,
				created_by_id=current_user.id,
			)
		else:
			row = PasswordVault(
				client_id=client_id,
				machine_name=machine_name,
				anydesk_code=(data.get("anydesk_code") or "").strip() or None,
				password=encrypt_password(password),
				description=(data.get("description") or "").strip() or None,
				created_by_id=current_user.id,
			)
		db.session.add(row)
		db.session.commit()
		return jsonify(_vault_entry_json(row)), 201

	q = (request.args.get("q") or "").strip().lower()
	with_passwords = (request.args.get("with_passwords") or "").lower() in ("1", "true", "yes")
	internal_clients = Client.query.order_by(Client.name.asc()).all()
	try:
		external_clients = fetch_external_clients() or []
	except Exception:
		external_clients = []
	items = []
	for c in internal_clients:
		items.append({
			"id": c.id,
			"name": c.name,
			"phone": c.phone or "",
			"document": c.document or "",
			"contract_type": c.contract_type or "",
			"is_external": False,
			"origin": "Interno",
		})
	seen_ext = set()
	for c in external_clients:
		cid = c.get("id")
		seen_ext.add(cid)
		items.append({
			"id": cid,
			"name": c.get("name") or "",
			"phone": c.get("phone") or "",
			"document": c.get("document") or "",
			"contract_type": c.get("contract_type") or "",
			"is_external": True,
			"origin": "Externo",
		})
	orphan_ext = (
		db.session.query(PasswordVault.external_client_id, PasswordVault.external_client_name)
		.filter(PasswordVault.external_client_id.isnot(None))
		.distinct()
		.all()
	)
	for cid, name in orphan_ext:
		if not cid or cid in seen_ext:
			continue
		seen_ext.add(cid)
		items.append({
			"id": cid,
			"name": name or f"Cliente {cid}",
			"phone": "",
			"document": "",
			"contract_type": "",
			"is_external": True,
			"origin": "Externo",
		})
	if q:
		items = [
			c for c in items
			if q in (c.get("name") or "").lower()
			or q in (c.get("phone") or "").lower()
			or q in (c.get("document") or "").lower()
		]
	internal_counts, external_counts = _vault_password_counts()
	for c in items:
		cid = c.get("id")
		if c.get("is_external"):
			c["passwords_count"] = int(external_counts.get(cid) or 0)
		else:
			c["passwords_count"] = int(internal_counts.get(cid) or 0)
	total_passwords = PasswordVault.query.count()
	clients_with_passwords = sum(1 for c in items if (c.get("passwords_count") or 0) > 0)
	total_clients = len(items)
	if with_passwords:
		items = [c for c in items if (c.get("passwords_count") or 0) > 0]
	items.sort(key=lambda x: (x.get("name") or "").lower())
	payload = _slice_page(items, default=25)
	payload["stats"] = {
		"total_clients": total_clients,
		"total_passwords": total_passwords,
		"clients_with_passwords": clients_with_passwords,
	}
	return jsonify(payload)


@bp.route("/vault/clients/<int:client_id>")
@login_required
def vault_client(client_id: int):
	is_external = (request.args.get("external") or "").lower() in ("1", "true", "yes")
	client = _vault_client_payload(client_id, is_external)
	if not client:
		return jsonify({"error": "Cliente não encontrado."}), 404
	if client["is_external"]:
		query = PasswordVault.query.filter_by(external_client_id=client_id)
	else:
		query = PasswordVault.query.filter_by(client_id=client_id)
	query = query.order_by(PasswordVault.machine_name.asc())
	q = (request.args.get("q") or "").strip()
	if q:
		like = f"%{q}%"
		query = query.filter(
			(PasswordVault.machine_name.ilike(like))
			| (PasswordVault.anydesk_code.ilike(like))
			| (PasswordVault.description.ilike(like))
		)
	query = filter_query(query, {
		"machine_name": PasswordVault.machine_name,
		"anydesk_code": PasswordVault.anydesk_code,
		"description": PasswordVault.description,
	})
	page, per_page = _page_args(10, lo=5, hi=50)
	pagination = query.paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"client": client,
		"items": [_vault_entry_json(r) for r in pagination.items],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


def _knowledge_category_json(c: KnowledgeCategory):
	try:
		articles_count = c.articles.count()
	except Exception:
		articles_count = KnowledgeArticle.query.filter_by(category_id=c.id).count()
	return {
		"id": c.id,
		"name": c.name,
		"description": c.description or "",
		"color": c.color or "#3B82F6",
		"icon": c.icon or "fas fa-folder",
		"articles_count": articles_count,
	}


def _knowledge_article_json(a: KnowledgeArticle, include_content=True):
	payload = {
		"id": a.id,
		"title": a.title,
		"summary": a.summary or "",
		"tags": a.tags or "",
		"status": a.status or "published",
		"is_featured": bool(a.is_featured),
		"category_id": a.category_id,
		"category": a.category.name if a.category else "",
		"category_color": (a.category.color if a.category else "") or "#3B82F6",
		"category_icon": (a.category.icon if a.category else "") or "fas fa-folder",
		"views_count": a.views_count or 0,
		"created_at": _fmt(a.created_at),
		"updated_at": _fmt(a.updated_at),
		"created_by": a.created_by.name if a.created_by else "",
	}
	if include_content:
		payload["content"] = a.content or ""
	return payload


@bp.route("/knowledge")
@login_required
def knowledge():
	page, per_page = _page_args(40, lo=6, hi=100)
	q = (request.args.get("q") or "").strip()
	cat_q = KnowledgeCategory.query.order_by(KnowledgeCategory.name.asc())
	art_q = KnowledgeArticle.query.order_by(KnowledgeArticle.created_at.desc())
	if q:
		like = f"%{q}%"
		cat_q = cat_q.filter(
			(KnowledgeCategory.name.ilike(like)) | (KnowledgeCategory.description.ilike(like))
		)
		art_q = art_q.filter(
			(KnowledgeArticle.title.ilike(like))
			| (KnowledgeArticle.summary.ilike(like))
			| (KnowledgeArticle.tags.ilike(like))
			| (KnowledgeArticle.content.ilike(like))
		)
	kind = (request.args.get("kind") or "articles").strip()
	stats = {
		"total_categories": KnowledgeCategory.query.count(),
		"total_articles": KnowledgeArticle.query.count(),
		"total_views": int(db.session.query(func.coalesce(func.sum(KnowledgeArticle.views_count), 0)).scalar() or 0),
	}
	if kind == "categories":
		cat_q = filter_query(cat_q, {
			"name": KnowledgeCategory.name,
			"description": KnowledgeCategory.description,
		})
		pagination = cat_q.paginate(page=page, per_page=per_page, error_out=False)
		return jsonify({
			"categories": [_knowledge_category_json(c) for c in pagination.items],
			"articles": [],
			"stats": stats,
			"total": pagination.total,
			"page": page,
			"per_page": per_page,
		})
	category_id = request.args.get("category_id", type=int)
	if category_id:
		art_q = art_q.filter(KnowledgeArticle.category_id == category_id)
	# A listagem comum nunca expõe rascunhos/arquivados sem pedido explícito.
	status = (request.args.get("status") or "published").strip()
	if status != "published" and not current_user.has_role("admin"):
		status = "published"
	if status and status != "all":
		art_q = art_q.filter(KnowledgeArticle.status == status)
	art_q = art_q.outerjoin(KnowledgeCategory, KnowledgeArticle.category_id == KnowledgeCategory.id)
	art_q = filter_query(art_q, {
		"title": KnowledgeArticle.title,
		"category": KnowledgeCategory.name,
		"views_count": KnowledgeArticle.views_count,
		"summary": KnowledgeArticle.summary,
		"tags": KnowledgeArticle.tags,
		"status": KnowledgeArticle.status,
	})
	pagination = art_q.paginate(page=page, per_page=per_page, error_out=False)
	category = KnowledgeCategory.query.get(category_id) if category_id else None
	return jsonify({
		"categories": [_knowledge_category_json(c) for c in cat_q.all()] if not category_id else [],
		"category": _knowledge_category_json(category) if category else None,
		"articles": [_knowledge_article_json(a) for a in pagination.items],
		"stats": stats,
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/knowledge/categories", methods=["POST"])
@login_required
def knowledge_category_create():
	data = _json()
	name = (data.get("name") or "").strip()
	if not name:
		return jsonify({"error": "Nome é obrigatório."}), 400
	if KnowledgeCategory.query.filter_by(name=name).first():
		return jsonify({"error": "Já existe uma categoria com esse nome."}), 400
	c = KnowledgeCategory(
		name=name,
		description=(data.get("description") or "").strip() or None,
		icon=(data.get("icon") or "fas fa-folder").strip() or "fas fa-folder",
		color=(data.get("color") or "#3B82F6").strip() or "#3B82F6",
		created_by_id=current_user.id,
	)
	db.session.add(c)
	db.session.commit()
	return jsonify(_knowledge_category_json(c)), 201


@bp.route("/knowledge/articles", methods=["POST"])
@login_required
def knowledge_article_create():
	data = _json()
	title = (data.get("title") or "").strip()
	content = (data.get("content") or "").strip()
	try:
		category_id = int(data.get("category_id"))
	except (TypeError, ValueError):
		return jsonify({"error": "Categoria é obrigatória."}), 400
	if not title or not content:
		return jsonify({"error": "Título e conteúdo são obrigatórios."}), 400
	if not KnowledgeCategory.query.get(category_id):
		return jsonify({"error": "Categoria não encontrada."}), 404
	status = (data.get("status") or "published").strip()
	if status not in ("draft", "published", "archived"):
		status = "published"
	a = KnowledgeArticle(
		title=title,
		content=content,
		summary=(data.get("summary") or "").strip() or None,
		tags=(data.get("tags") or "").strip() or None,
		category_id=category_id,
		status=status,
		is_featured=bool(data.get("is_featured")),
		created_by_id=current_user.id,
	)
	db.session.add(a)
	db.session.commit()
	return jsonify(_knowledge_article_json(a)), 201


@bp.route("/inventory")
@login_required
def inventory():
	page, per_page = _page_args(20)
	q = (request.args.get("q") or "").strip()
	status = (request.args.get("status") or "").strip()
	query = InventoryItem.query
	if q:
		like = f"%{q}%"
		query = query.filter(
			(InventoryItem.title.ilike(like))
			| (InventoryItem.description.ilike(like))
			| (InventoryItem.serial_number.ilike(like))
		)
	if status:
		query = query.filter(InventoryItem.status == status)
	status_label = case(
		(InventoryItem.status == InventoryItem.STATUS_DISPONIVEL, "Disponível"),
		(InventoryItem.status == InventoryItem.STATUS_EMPRESTADO, "Emprestado"),
		(InventoryItem.status == InventoryItem.STATUS_VENDIDO, "Vendido"),
		(InventoryItem.status == InventoryItem.STATUS_DESCARTADO, "Descartado"),
		else_=InventoryItem.status,
	)
	query = filter_query(query, {
		"title": InventoryItem.title,
		"serial_number": InventoryItem.serial_number,
		"status": status_label,
		"public_uuid": InventoryItem.public_uuid,
		"description": InventoryItem.description,
	})
	pagination = query.order_by(InventoryItem.updated_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"items": [
			{
				"id": i.id,
				"title": i.title or (i.description or "")[:80],
				"description": i.description or "",
				"serial_number": i.serial_number,
				"status": i.status,
				"status_label": i.status_label(),
				"public_uuid": i.public_uuid,
			}
			for i in pagination.items
		],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


def _budget_list_json(b: Budget):
	has_client = bool(b.external_client_id) or (b.client_id and b.client_id != -1)
	return {
		"id": b.id,
		"title": b.title,
		"status": b.status,
		"description": b.description or "",
		"client_name": b.get_client_name() if has_client else "",
		"client_id": b.client_id if b.client_id and b.client_id != -1 else None,
		"external_client_id": b.external_client_id,
		"updated_at": _fmt(b.updated_at),
		"total": float(b.total or 0),
		"has_file": bool(b.has_file()) if hasattr(b, "has_file") else False,
		"public_token": b.public_token or "",
		"items_count": len(b.items or []),
	}


def _budget_detail_json(b: Budget):
	has_client = bool(b.external_client_id) or (b.client_id and b.client_id != -1)
	updated_iso = None
	if b.updated_at:
		try:
			updated_iso = b.updated_at.replace(microsecond=0).isoformat()
		except Exception:
			updated_iso = str(b.updated_at)
	return {
		"id": b.id,
		"title": b.title,
		"status": b.status,
		"description": b.description or "",
		"client_id": b.client_id if b.client_id and b.client_id != -1 else None,
		"external_client_id": b.external_client_id,
		"client_name": b.get_client_name() if has_client else "",
		"valid_until": b.valid_until.isoformat() if b.valid_until else "",
		"theme_id": b.theme_id,
		"show_logo": bool(b.show_logo),
		"discount": float(b.discount or 0),
		"payment_terms": b.payment_terms or "",
		"internal_notes": b.internal_notes or "",
		"public_token": b.public_token or "",
		"updated_at": _fmt(b.updated_at),
		"updated_at_iso": updated_iso,
		"subtotal": float(b.subtotal or 0),
		"total": float(b.total or 0),
		"has_file": bool(b.has_file()) if hasattr(b, "has_file") else False,
		"original_filename": b.original_filename or "",
		"items": [item.to_dict() for item in (b.items or [])],
	}


@bp.route("/budgets", methods=["GET", "POST"])
@login_required
def budgets():
	if request.method == "POST":
		from .budget import save_builder
		return save_builder()
	page, per_page = _page_args(12, lo=6, hi=48)
	q = (request.args.get("q") or "").strip()
	status = (request.args.get("status") or "").strip()
	query = Budget.query
	if q:
		like = f"%{q}%"
		query = query.filter(
			(Budget.title.ilike(like))
			| (Budget.description.ilike(like))
			| (Budget.status.ilike(like))
		)
	if status:
		query = query.filter(Budget.status == status)
	status_label = case(
		(Budget.status == "draft", "Rascunho"),
		(Budget.status == "sent", "Enviado"),
		(Budget.status == "approved", "Aprovado"),
		(Budget.status == "rejected", "Rejeitado"),
		else_=Budget.status,
	)
	query = filter_query(query, {
		"title": Budget.title,
		"status": status_label,
		"description": Budget.description,
		"client_name": Budget.external_client_name,
		"updated_at": Budget.updated_at,
	})
	query = query.order_by(Budget.updated_at.desc())
	pagination = query.paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"items": [_budget_list_json(b) for b in pagination.items],
		"total": pagination.total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/budgets/meta")
@login_required
def budgets_meta():
	themes = BudgetTheme.query.order_by(BudgetTheme.name.asc()).all()
	return jsonify({
		"themes": [t.to_dict() for t in themes],
	})


@bp.route("/budgets/clients")
@login_required
def budgets_clients():
	clients = [
		{"id": client.id, "name": client.name, "type": "internal"}
		for client in Client.query.order_by(Client.name).all()
	]
	try:
		external_clients = fetch_external_clients() or []
	except Exception:
		external_clients = []
	for client in external_clients:
		clients.append({
			"id": client["id"],
			"name": client["name"],
			"type": "external",
		})
	return jsonify({"success": True, "clients": clients})


@bp.route("/config")
@login_required
def config():
	if not current_user.has_role("admin"):
		return jsonify({"error": "Acesso negado"}), 403
	return jsonify({
		"email": SystemConfig.get_all_by_category("email"),
		"general": SystemConfig.get_all_by_category("general"),
		"system": SystemConfig.get_all_by_category("system"),
	})


@bp.route("/catalog")
def catalog():
	systems = System.query.filter_by(is_active=True).order_by(System.name.asc()).all()
	return jsonify([
		{
			"id": s.id,
			"name": s.name,
			"description": s.description or "",
			"logo_url": s.logo_url,
			"active_plans": len([p for p in (s.plans or []) if p.is_active]),
		}
		for s in systems
	])


@bp.route("/clients", methods=["POST"])
@login_required
def clients_create():
	data = _json()
	name = (data.get("name") or "").strip()
	if not name:
		return jsonify({"error": "Nome é obrigatório."}), 400
	try:
		client = create_external_client(
			name,
			document=(data.get("document") or "").strip(),
			phone=(data.get("phone") or "").strip(),
			email=(data.get("email") or "").strip(),
			address=(data.get("address") or "").strip(),
			address_number=(data.get("address_number") or "").strip(),
			notes=(data.get("notes") or "").strip() or None,
		)
	except ValueError as e:
		return jsonify({"error": str(e)}), 400
	except Exception as e:
		return jsonify({"error": str(e)}), 500
	return jsonify(client), 201


@bp.route("/clients/<int:client_id>")
@login_required
def client_item_get(client_id: int):
	try:
		items = fetch_external_clients()
	except Exception as e:
		return jsonify({"error": str(e)}), 503
	client = next((c for c in items if c.get("id") == client_id), None)
	if not client:
		return jsonify({"error": "Cliente não encontrado."}), 404
	return jsonify(client)


@bp.route("/clients/<int:client_id>", methods=["PATCH"])
@login_required
def client_item_patch(client_id: int):
	data = _json()
	try:
		items = fetch_external_clients()
	except Exception as e:
		return jsonify({"error": str(e)}), 503
	client = next((c for c in items if c.get("id") == client_id), None)
	if not client:
		return jsonify({"error": "Cliente não encontrado."}), 404
	name = (data.get("name") if data.get("name") is not None else client.get("name")) or ""
	document = data.get("document") if "document" in data else client.get("document")
	phone = data.get("phone") if "phone" in data else client.get("phone")
	email = data.get("email") if "email" in data else client.get("email")
	address = data.get("address") if "address" in data else client.get("address")
	address_number = data.get("address_number") if "address_number" in data else client.get("address_number")
	notes = data.get("notes") if "notes" in data else client.get("notes")
	try:
		update_external_client(
			client_id,
			name,
			document or "",
			phone or "",
			email or "",
			address or "",
			address_number or "",
			notes=notes,
		)
	except Exception as e:
		return jsonify({"error": str(e)}), 500
	return jsonify({
		**client,
		"name": name,
		"document": document,
		"phone": phone,
		"email": email,
		"address": address,
		"address_number": address_number,
		"notes": notes,
	})


@bp.route("/contracts/<path:contract_name>", methods=["PATCH"])
@login_required
def contract_item_patch(contract_name: str):
	denied = _require_admin()
	if denied:
		return denied
	data = _json()
	new_name = (data.get("name") or contract_name).strip()
	no_charge = data.get("no_charge")
	if not new_name:
		return jsonify({"error": "Nome do contrato é obrigatório."}), 400
	try:
		affected = update_contract_type(contract_name, new_name, no_charge if no_charge is not None else None)
		if new_name != contract_name:
			ClientContract.query.filter_by(contract_name=contract_name).update({"contract_name": new_name})
			db.session.commit()
	except Exception as e:
		db.session.rollback()
		return jsonify({"error": str(e)}), 500
	return jsonify({"ok": True, "name": new_name, "affected": affected})


@bp.route("/vault/<int:item_id>/reveal")
@login_required
def vault_reveal(item_id: int):
	row = PasswordVault.query.get_or_404(item_id)
	from .password_vault import decrypt_password
	try:
		return jsonify({"success": True, "password": decrypt_password(row.password), "is_encrypted": False})
	except Exception:
		return jsonify({
			"success": True,
			"password": row.password,
			"is_encrypted": True,
			"warning": "Não foi possível descriptografar a senha. Exibindo versão criptografada.",
		})


@bp.route("/vault/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
@login_required
def vault_item(item_id: int):
	row = PasswordVault.query.get_or_404(item_id)
	if request.method == "GET":
		return jsonify(_vault_entry_json(row))
	if request.method == "DELETE":
		db.session.delete(row)
		db.session.commit()
		return jsonify({"ok": True})
	data = _json()
	if data.get("machine_name") is not None:
		name = (data.get("machine_name") or "").strip()
		if not name:
			return jsonify({"error": "Nome da máquina é obrigatório."}), 400
		row.machine_name = name
	if "anydesk_code" in data:
		row.anydesk_code = (data.get("anydesk_code") or "").strip() or None
	if "description" in data:
		row.description = data.get("description") or ""
	password = (data.get("password") or "").strip()
	if password:
		from .password_vault import encrypt_password
		row.password = encrypt_password(password)
	db.session.commit()
	return jsonify(_vault_entry_json(row))


@bp.route("/knowledge/categories/<int:category_id>", methods=["GET", "PATCH", "DELETE"])
@login_required
def knowledge_category_item(category_id: int):
	c = KnowledgeCategory.query.get_or_404(category_id)
	if request.method == "GET":
		return jsonify(_knowledge_category_json(c))
	if request.method == "DELETE":
		db.session.delete(c)
		db.session.commit()
		return jsonify({"ok": True})
	data = _json()
	if data.get("name") is not None:
		name = (data.get("name") or "").strip()
		if not name:
			return jsonify({"error": "Nome é obrigatório."}), 400
		dup = KnowledgeCategory.query.filter(KnowledgeCategory.name == name, KnowledgeCategory.id != c.id).first()
		if dup:
			return jsonify({"error": "Já existe uma categoria com esse nome."}), 400
		c.name = name
	if "description" in data:
		c.description = data.get("description") or ""
	if data.get("color"):
		c.color = data.get("color")
	if data.get("icon"):
		c.icon = data.get("icon")
	db.session.commit()
	return jsonify(_knowledge_category_json(c))


@bp.route("/knowledge/articles/<int:article_id>", methods=["GET", "PATCH", "DELETE"])
@login_required
def knowledge_article_item(article_id: int):
	a = KnowledgeArticle.query.get_or_404(article_id)
	if request.method == "GET":
		if request.args.get("view") in ("1", "true", "yes"):
			a.views_count = (a.views_count or 0) + 1
			db.session.commit()
		return jsonify(_knowledge_article_json(a))
	if request.method == "DELETE":
		db.session.delete(a)
		db.session.commit()
		return jsonify({"ok": True})
	data = _json()
	if data.get("title") is not None:
		title = (data.get("title") or "").strip()
		if not title:
			return jsonify({"error": "Título é obrigatório."}), 400
		a.title = title
	if "summary" in data:
		a.summary = data.get("summary") or ""
	if data.get("content") is not None:
		content = (data.get("content") or "").strip()
		if not content:
			return jsonify({"error": "Conteúdo é obrigatório."}), 400
		a.content = content
	if "tags" in data:
		a.tags = data.get("tags") or ""
	if data.get("status"):
		a.status = data.get("status")
	if "is_featured" in data:
		a.is_featured = bool(data.get("is_featured"))
	if data.get("category_id") is not None:
		a.category_id = int(data.get("category_id"))
	a.updated_by_id = current_user.id
	db.session.commit()
	return jsonify(_knowledge_article_json(a))


@bp.route("/inventory/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
@login_required
def inventory_item(item_id: int):
	item = InventoryItem.query.get_or_404(item_id)
	if request.method == "GET":
		return jsonify({
			"id": item.id,
			"title": item.title or "",
			"description": item.description or "",
			"serial_number": item.serial_number,
			"status": item.status,
			"status_label": item.status_label(),
			"public_uuid": item.public_uuid,
		})
	if request.method == "DELETE":
		db.session.delete(item)
		db.session.commit()
		return jsonify({"ok": True})
	data = _json()
	if "title" in data:
		item.title = (data.get("title") or "").strip() or None
	if data.get("description") is not None:
		desc = (data.get("description") or "").strip()
		if not desc:
			return jsonify({"error": "A descrição é obrigatória."}), 400
		item.description = desc
	if "serial_number" in data:
		item.serial_number = (data.get("serial_number") or "").strip() or None
	db.session.commit()
	return jsonify({
		"id": item.id,
		"title": item.title or "",
		"description": item.description or "",
		"serial_number": item.serial_number,
		"status": item.status,
		"status_label": item.status_label(),
		"public_uuid": item.public_uuid,
	})


@bp.route("/budgets/<int:budget_id>", methods=["GET", "PATCH", "DELETE", "POST"])
@login_required
def budget_item(budget_id: int):
	if request.method == "POST":
		from .budget import save_builder
		return save_builder(budget_id)
	b = Budget.query.get_or_404(budget_id)
	if request.method == "GET":
		return jsonify(_budget_detail_json(b))
	if request.method == "DELETE":
		db.session.delete(b)
		db.session.commit()
		return jsonify({"ok": True})
	data = _json()
	if data.get("title") is not None:
		title = (data.get("title") or "").strip()
		if not title:
			return jsonify({"error": "Título é obrigatório."}), 400
		b.title = title
	if data.get("status"):
		b.status = data.get("status")
	if "description" in data:
		b.description = data.get("description") or ""
	db.session.commit()
	return jsonify(_budget_detail_json(b))


@bp.route("/plans/systems/<int:system_id>", methods=["GET", "PATCH"])
@login_required
def plan_system_item(system_id: int):
	s = System.query.get_or_404(system_id)
	if request.method == "GET":
		return jsonify({
			"id": s.id,
			"name": s.name,
			"description": s.description or "",
			"version": s.version or "",
			"company": s.company or "",
			"is_active": bool(s.is_active),
			"plans_count": len(s.plans or []),
		})
	data = _json()
	if data.get("name") is not None:
		name = (data.get("name") or "").strip()
		if not name:
			return jsonify({"error": "Nome do sistema é obrigatório."}), 400
		s.name = name
	if "description" in data:
		s.description = data.get("description") or ""
	if "version" in data:
		s.version = data.get("version") or ""
	if "company" in data:
		s.company = data.get("company") or ""
	if "is_active" in data:
		s.is_active = bool(data.get("is_active"))
	db.session.commit()
	return jsonify({
		"id": s.id,
		"name": s.name,
		"description": s.description or "",
		"version": s.version or "",
		"company": s.company or "",
		"is_active": bool(s.is_active),
		"plans_count": len(s.plans or []),
	})
