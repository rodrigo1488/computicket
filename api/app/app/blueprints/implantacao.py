"""API JSON do módulo Implantação (modelos, passos, Kanban e prazos)."""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .. import db
from ..external_pg import ExternalPgError, get_external_client_by_id
from ..models import (
	Appointment,
	Implantation,
	ImplantationModel,
	ImplantationStep,
	ImplantationStepLog,
	System,
	Ticket,
	User,
)
from ..timezone_utils import get_brasilia_now, utc_to_brasilia

bp = Blueprint("implantacao", __name__, url_prefix="/api/implantacao")

DURATION_UNITS = {"hours", "days"}
COMPLETED_COLUMN = "completed"
PAUSED_ALERT_DAYS = 2


def _now():
	now = get_brasilia_now()
	return now.replace(tzinfo=None) if getattr(now, "tzinfo", None) else now


def _naive(dt):
	if dt is None:
		return None
	return dt.replace(tzinfo=None) if getattr(dt, "tzinfo", None) else dt


def _json():
	return request.get_json(silent=True) or {}


def _fmt(dt):
	if not dt:
		return None
	value = _naive(dt)
	try:
		return value.strftime("%d/%m/%Y %H:%M")
	except Exception:
		return str(dt)


def _iso(dt):
	if not dt:
		return None
	value = _naive(dt)
	return value.isoformat(timespec="seconds") if value else None


def _due_info(due_at, now=None):
	due = _naive(due_at)
	if not due:
		return {"overdue": False, "due_at": None, "due_label": None, "due_at_label": None}
	current = _naive(now) or _now()
	delta = due - current
	overdue = delta.total_seconds() < 0
	seconds = abs(int(delta.total_seconds()))
	days, rem = divmod(seconds, 86400)
	hours, rem = divmod(rem, 3600)
	minutes = rem // 60
	if days:
		chunk = f"{days} dia{'s' if days != 1 else ''}"
	elif hours:
		chunk = f"{hours}h"
	else:
		chunk = f"{max(minutes, 1)} min"
	if overdue:
		label = "prazo estourado" if seconds < 60 else f"prazo estourado há {chunk}"
	else:
		label = f"vence em {chunk}"
	return {
		"overdue": overdue,
		"due_at": _iso(due),
		"due_label": label,
		"due_at_label": _fmt(due),
	}


def _compute_due_at(entered_at, step: ImplantationStep):
	start = _naive(entered_at) or _now()
	value = max(1, int(step.duration_value or 1))
	if step.duration_unit == "hours":
		return start + timedelta(hours=value)
	return start + timedelta(days=value)


def _int_arg(name, default=None):
	raw = request.args.get(name)
	if raw in (None, ""):
		return default
	try:
		return int(raw)
	except (TypeError, ValueError):
		return default


def _system_json(system: System):
	return {
		"id": system.id,
		"name": system.name,
		"description": system.description or "",
		"version": system.version or "",
		"company": system.company or "",
		"is_active": bool(system.is_active),
	}


def _step_json(step: ImplantationStep):
	return {
		"id": step.id,
		"model_id": step.model_id,
		"name": step.name,
		"description": step.description or "",
		"position": step.position,
		"duration_value": int(step.duration_value or 0),
		"duration_unit": step.duration_unit,
		"duration_label": step.duration_label(),
		"is_active": bool(step.is_active),
	}


def _model_json(model: ImplantationModel, *, include_steps=True):
	active = [s for s in (model.steps or []) if s.is_active]
	payload = {
		"id": model.id,
		"name": model.name,
		"description": model.description or "",
		"system_id": model.system_id,
		"system_name": model.system.name if model.system else "",
		"system": _system_json(model.system) if model.system else None,
		"is_active": bool(model.is_active),
		"steps_count": len(active),
		"active_count": Implantation.query.filter(
			Implantation.model_id == model.id,
			Implantation.status.in_(["in_progress", "paused"]),
		).count(),
	}
	if include_steps:
		payload["steps"] = [_step_json(s) for s in sorted(active, key=lambda s: s.position)]
	return payload


def _user_brief(user: User | None):
	if not user:
		return None, None
	return user.id, user.name


def _resolve_user_id(raw):
	if raw in (None, "", "inherit"):
		return None
	try:
		uid = int(raw)
	except (TypeError, ValueError):
		return None
	user = User.query.get(uid)
	return user.id if user else None


def _current_open_log(item: Implantation) -> ImplantationStepLog | None:
	return (
		ImplantationStepLog.query.filter_by(implantation_id=item.id, completed_at=None)
		.order_by(ImplantationStepLog.entered_at.desc())
		.first()
	)


def _effective_assignee(item: Implantation) -> User | None:
	log = _current_open_log(item)
	if log and log.assignee_id:
		return log.assignee
	return item.assigned_to


def _human_delta(seconds: int, *, overdue=False, prefix_ok="há", prefix_overdue="há"):
	seconds = abs(int(seconds))
	days, rem = divmod(seconds, 86400)
	hours, rem = divmod(rem, 3600)
	minutes = rem // 60
	if days:
		chunk = f"{days} dia{'s' if days != 1 else ''}"
	elif hours:
		chunk = f"{hours}h"
	else:
		chunk = f"{max(minutes, 1)} min"
	if overdue:
		return f"{prefix_overdue} {chunk}".strip()
	return f"{prefix_ok} {chunk}".strip()


def _paused_info(item: Implantation):
	paused = _naive(item.paused_at) if item.status == "paused" else None
	if not paused:
		return {
			"paused_days": 0,
			"paused_seconds": 0,
			"paused_long": False,
			"paused_for_label": None,
		}
	seconds = int((_now() - paused).total_seconds())
	days = seconds / 86400
	return {
		"paused_days": round(days, 2),
		"paused_seconds": max(seconds, 0),
		"paused_long": seconds > PAUSED_ALERT_DAYS * 86400,
		"paused_for_label": f"pausada há {_human_delta(seconds, prefix_ok='').strip()}",
	}


def _alert_kind(item: Implantation, due: dict, paused: dict) -> str:
	if item.status == "completed":
		return "completed"
	if item.status == "cancelled":
		return "cancelled"
	if item.status == "paused":
		return "paused_long" if paused.get("paused_long") else "paused"
	if item.status == "in_progress" and due.get("overdue"):
		return "overdue"
	return "ok"


def _log_json(log: ImplantationStepLog):
	due = _due_info(log.due_at)
	assignee_id, assignee_name = _user_brief(log.assignee)
	return {
		"id": log.id,
		"step_id": log.step_id,
		"step_name": log.step.name if log.step else "",
		"entered_at": _iso(log.entered_at),
		"entered_at_label": _fmt(log.entered_at),
		"due_at": due["due_at"],
		"due_at_label": due["due_at_label"],
		"completed_at": _iso(log.completed_at),
		"completed_at_label": _fmt(log.completed_at),
		"overdue": bool(due["overdue"] and not log.completed_at),
		"assignee_id": assignee_id,
		"assignee_name": assignee_name,
		"ticket_id": log.ticket_id,
	}


def _status_due_info(item: Implantation):
	if item.status == "in_progress":
		return _due_info(item.due_at)
	if item.status == "paused":
		frozen = _due_info(item.due_at, now=_naive(item.paused_at) or _now())
		remaining = frozen.get("due_label") or ""
		if remaining.startswith("vence em "):
			label = f"pausada · restavam {remaining[9:]}"
		elif remaining.startswith("prazo estourado"):
			label = f"pausada · {remaining}"
		else:
			label = "pausada"
		return {
			"overdue": False,
			"due_at": frozen.get("due_at"),
			"due_label": label,
			"due_at_label": frozen.get("due_at_label"),
		}
	return {
		"overdue": False,
		"due_at": _iso(item.due_at),
		"due_label": "concluída" if item.status == "completed" else "cancelada",
		"due_at_label": _fmt(item.due_at),
	}


def _next_step(item: Implantation) -> ImplantationStep | None:
	model = item.model
	if not model:
		return None
	steps = sorted(model.active_steps(), key=lambda s: s.position)
	if not steps:
		return None
	if not item.current_step_id:
		return steps[0]
	seen = False
	for step in steps:
		if seen:
			return step
		if step.id == item.current_step_id:
			seen = True
	return None


def _scheduled_appointment(item: Implantation) -> Appointment | None:
	if not item.scheduled_appointment_id:
		return None
	return Appointment.query.get(item.scheduled_appointment_id)


def _clear_schedule(item: Implantation, *, delete_appointment=False):
	if delete_appointment:
		appt = _scheduled_appointment(item)
		if appt:
			db.session.delete(appt)
	item.scheduled_appointment_id = None
	item.scheduled_step_id = None


def _current_user_id():
	try:
		if current_user and getattr(current_user, "is_authenticated", False):
			return int(current_user.id)
	except Exception:
		return None
	return None


def _ensure_step_ticket(item: Implantation, step: ImplantationStep) -> Ticket | None:
	existing = Ticket.query.filter_by(
		implantation_id=item.id,
		implantation_step_id=step.id,
	).first()
	if existing:
		return existing
	assignee = _effective_assignee(item)
	opened_by = _current_user_id() or item.created_by_id or (assignee.id if assignee else None)
	if not opened_by:
		fallback = User.query.filter(User.status == "1").order_by(User.id.asc()).first()
		opened_by = fallback.id if fallback else None
	if not opened_by:
		return None
	model_name = item.model.name if item.model else "Implantação"
	ticket = Ticket(
		title=f"[Implantação] {item.external_client_name} · {step.name}"[:200],
		description=(
			f"Ticket gerado pela etapa da implantação.\n"
			f"Cliente: {item.external_client_name}\n"
			f"Modelo: {model_name}\n"
			f"Etapa: {step.name}\n"
			f"Implantação #{item.id}\n"
			f"Kanban: /implantacao?model={item.model_id}"
		),
		external_client_id=item.external_client_id,
		external_client_name=item.external_client_name,
		solicitante=item.external_client_name,
		assigned_to_id=assignee.id if assignee else item.assigned_to_id,
		opened_by_id=opened_by,
		implantation_id=item.id,
		implantation_step_id=step.id,
		status="aberto",
	)
	db.session.add(ticket)
	db.session.flush()
	try:
		from ..notification_service import create_notifications, ticket_recipient_ids

		create_notifications(
			ticket_recipient_ids(ticket.assigned_to_id),
			notification_type="ticket",
			title=f"Novo ticket #{ticket.id}",
			message=f"{ticket.title} · {ticket.display_client_name() or 'Cliente não informado'}",
			url=f"/tickets/{ticket.id}",
			entity_type="ticket",
			entity_id=ticket.id,
		)
	except Exception:
		pass
	return ticket


def _implantation_json(item: Implantation, *, include_logs=False):
	due = _status_due_info(item)
	paused = _paused_info(item)
	model = item.model
	step = item.current_step
	assigned_id, assigned_name = _user_brief(item.assigned_to)
	open_log = _current_open_log(item)
	step_assignee_id, step_assignee_name = _user_brief(open_log.assignee if open_log else None)
	current_id, current_name = _user_brief(_effective_assignee(item))
	nxt = _next_step(item)
	appt = _scheduled_appointment(item)
	scheduled_step = item.scheduled_step
	payload = {
		"id": item.id,
		"external_client_id": item.external_client_id,
		"external_client_name": item.external_client_name,
		"model_id": item.model_id,
		"model_name": model.name if model else "",
		"system_id": model.system_id if model else None,
		"system_name": model.system.name if model and model.system else "",
		"current_step_id": item.current_step_id,
		"current_step_name": step.name if step else ("Concluído" if item.status == "completed" else ""),
		"status": item.status,
		"notes": item.notes or "",
		"entered_at": _iso(item.entered_at),
		"entered_at_label": _fmt(item.entered_at),
		"created_at": _iso(item.created_at),
		"created_at_label": _fmt(item.created_at),
		"paused_at": _iso(item.paused_at),
		"paused_at_label": _fmt(item.paused_at),
		"completed_at": _iso(item.completed_at),
		"created_by_name": item.created_by.name if item.created_by else None,
		"assigned_to_id": assigned_id,
		"assigned_to_name": assigned_name,
		"step_assignee_id": step_assignee_id,
		"step_assignee_name": step_assignee_name,
		"current_assignee_id": current_id,
		"current_assignee_name": current_name,
		"ticket_id": open_log.ticket_id if open_log else None,
		"next_step_id": nxt.id if nxt else None,
		"next_step_name": nxt.name if nxt else None,
		"scheduled_appointment_id": item.scheduled_appointment_id,
		"scheduled_step_id": item.scheduled_step_id,
		"scheduled_step_name": scheduled_step.name if scheduled_step else None,
		"scheduled_at": _iso(appt.appointment_date) if appt else None,
		"scheduled_at_label": _fmt(appt.appointment_date) if appt else None,
		"alert": _alert_kind(item, due, paused),
		**paused,
		**due,
	}
	if include_logs:
		logs = sorted(item.step_logs or [], key=lambda row: row.entered_at or _now())
		payload["logs"] = [_log_json(row) for row in logs]
	return payload


def _open_step(item: Implantation, step: ImplantationStep, now=None, assignee_id=None):
	now = now or _now()
	due_at = _compute_due_at(now, step)
	item.current_step_id = step.id
	item.entered_at = now
	item.due_at = due_at
	item.status = "in_progress"
	item.completed_at = None
	item.cancelled_at = None
	item.paused_at = None
	log = ImplantationStepLog(
		implantation=item,
		step_id=step.id,
		entered_at=now,
		due_at=due_at,
		assignee_id=assignee_id,
	)
	db.session.add(log)
	db.session.flush()
	ticket = _ensure_step_ticket(item, step)
	if ticket:
		log.ticket_id = ticket.id
	if item.scheduled_step_id == step.id:
		_clear_schedule(item, delete_appointment=True)


def _close_current_log(item: Implantation, now=None):
	now = now or _now()
	open_log = (
		ImplantationStepLog.query.filter_by(implantation_id=item.id, completed_at=None)
		.order_by(ImplantationStepLog.entered_at.desc())
		.first()
	)
	if open_log:
		open_log.completed_at = now


def _sync_steps(model: ImplantationModel, steps_payload: list):
	if not isinstance(steps_payload, list) or not steps_payload:
		raise ValueError("Informe ao menos um passo da implantação.")
	existing = {step.id: step for step in (model.steps or []) if step.id}
	kept: list[ImplantationStep] = []
	for index, raw in enumerate(steps_payload):
		if not isinstance(raw, dict):
			raise ValueError("Passo inválido.")
		name = (raw.get("name") or "").strip()
		if not name:
			raise ValueError("Cada passo precisa de um nome.")
		try:
			duration_value = int(raw.get("duration_value") or 0)
		except (TypeError, ValueError) as exc:
			raise ValueError("Prazo do passo inválido.") from exc
		if duration_value < 1:
			raise ValueError("O prazo de cada passo deve ser maior que zero.")
		unit = (raw.get("duration_unit") or "days").strip().lower()
		if unit not in DURATION_UNITS:
			raise ValueError("Unidade do prazo deve ser horas ou dias.")
		step = None
		raw_id = raw.get("id")
		if raw_id:
			try:
				step = existing.get(int(raw_id))
			except (TypeError, ValueError):
				step = None
		if step is None:
			step = ImplantationStep(model=model)
			db.session.add(step)
		step.name = name[:120]
		step.description = (raw.get("description") or "").strip() or None
		step.position = index
		step.duration_value = duration_value
		step.duration_unit = unit
		step.is_active = True
		kept.append(step)
	db.session.flush()
	keep_ids = {step.id for step in kept if step.id}
	for step in list(model.steps or []):
		if step.id in keep_ids:
			continue
		busy = Implantation.query.filter(
			Implantation.current_step_id == step.id,
			Implantation.status.in_(["in_progress", "paused"]),
		).count()
		if busy:
			raise ValueError(
				f"Não é possível remover a etapa '{step.name}' com implantações em andamento."
			)
		step.is_active = False


def _team_recipient_ids() -> list[int]:
	return [
		user.id
		for user in User.query.filter(
			User.status == "1",
			User.role.in_(["admin", "administrador", "tecnico"]),
		).all()
	]


@bp.route("/systems")
@login_required
def list_systems():
	q = (request.args.get("q") or "").strip().lower()
	query = System.query.order_by(System.name.asc())
	if (request.args.get("active") or "1") != "0":
		query = query.filter_by(is_active=True)
	items = [_system_json(s) for s in query.all()]
	if q:
		items = [s for s in items if q in (s["name"] or "").lower()]
	return jsonify({"items": items})


@bp.route("/systems", methods=["POST"])
@login_required
def create_system():
	data = _json()
	name = (data.get("name") or "").strip()
	if not name:
		return jsonify({"error": "Informe o nome do sistema."}), 400
	existing = System.query.filter(db.func.lower(System.name) == name.lower()).first()
	if existing:
		return jsonify({"error": "Já existe um sistema com este nome.", "item": _system_json(existing)}), 409
	system = System(
		name=name[:100],
		description=(data.get("description") or "").strip() or None,
		version=(data.get("version") or "").strip() or None,
		company=(data.get("company") or "").strip() or None,
		is_active=True,
	)
	db.session.add(system)
	db.session.commit()
	return jsonify(_system_json(system)), 201


@bp.route("/models")
@login_required
def list_models():
	q = (request.args.get("q") or "").strip().lower()
	system_id = _int_arg("system_id")
	query = ImplantationModel.query.order_by(ImplantationModel.name.asc())
	if (request.args.get("active") or "") == "1":
		query = query.filter_by(is_active=True)
	if system_id:
		query = query.filter_by(system_id=system_id)
	items = [_model_json(m) for m in query.all()]
	if q:
		items = [
			m for m in items
			if q in (m["name"] or "").lower()
			or q in (m["description"] or "").lower()
			or q in (m["system_name"] or "").lower()
		]
	try:
		page = max(1, int(request.args.get("page", 1)))
	except (TypeError, ValueError):
		page = 1
	try:
		per_page = min(100, max(6, int(request.args.get("per_page", 25))))
	except (TypeError, ValueError):
		per_page = 25
	total = len(items)
	start = (page - 1) * per_page
	return jsonify({
		"items": items[start:start + per_page],
		"total": total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/models", methods=["POST"])
@login_required
def create_model():
	data = _json()
	name = (data.get("name") or "").strip()
	system_id = data.get("system_id")
	if not name:
		return jsonify({"error": "Informe o nome do modelo."}), 400
	system = System.query.get(system_id)
	if not system:
		return jsonify({"error": "Selecione um sistema."}), 400
	model = ImplantationModel(
		name=name[:120],
		description=(data.get("description") or "").strip() or None,
		system_id=system.id,
		is_active=bool(data.get("is_active", True)),
	)
	db.session.add(model)
	try:
		_sync_steps(model, data.get("steps") or [])
		db.session.commit()
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400
	return jsonify(_model_json(model)), 201


@bp.route("/models/<int:model_id>")
@login_required
def get_model(model_id: int):
	model = ImplantationModel.query.get_or_404(model_id)
	return jsonify(_model_json(model))


@bp.route("/models/<int:model_id>", methods=["PATCH"])
@login_required
def update_model(model_id: int):
	model = ImplantationModel.query.get_or_404(model_id)
	data = _json()
	if "name" in data:
		name = (data.get("name") or "").strip()
		if not name:
			return jsonify({"error": "Informe o nome do modelo."}), 400
		model.name = name[:120]
	if "description" in data:
		model.description = (data.get("description") or "").strip() or None
	if "is_active" in data:
		model.is_active = bool(data.get("is_active"))
	if "system_id" in data:
		system = System.query.get(data.get("system_id"))
		if not system:
			return jsonify({"error": "Sistema inválido."}), 400
		model.system_id = system.id
	try:
		if "steps" in data:
			_sync_steps(model, data.get("steps") or [])
		db.session.commit()
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400
	return jsonify(_model_json(model))


@bp.route("/models/<int:model_id>", methods=["DELETE"])
@login_required
def delete_model(model_id: int):
	model = ImplantationModel.query.get_or_404(model_id)
	if Implantation.query.filter_by(model_id=model.id).count():
		return jsonify({"error": "Não é possível excluir um modelo com implantações. Desative-o."}), 409
	db.session.delete(model)
	db.session.commit()
	return jsonify({"ok": True})


@bp.route("/board")
@login_required
def board():
	model_id = _int_arg("model_id")
	if not model_id:
		return jsonify({"error": "Selecione um modelo de implantação."}), 400
	model = ImplantationModel.query.get_or_404(model_id)
	q = (request.args.get("q") or "").strip().lower()
	steps = sorted(model.active_steps(), key=lambda s: s.position)
	query = Implantation.query.filter(
		Implantation.model_id == model.id,
		Implantation.status.in_(["in_progress", "paused", "completed"]),
	)
	items = query.order_by(Implantation.updated_at.desc()).all()
	if q:
		items = [i for i in items if q in (i.external_client_name or "").lower()]
	by_step: dict[int | str, list] = {step.id: [] for step in steps}
	by_step[COMPLETED_COLUMN] = []
	for item in items:
		card = _implantation_json(item)
		if item.status == "completed":
			by_step[COMPLETED_COLUMN].append(card)
		elif item.current_step_id in by_step:
			by_step[item.current_step_id].append(card)
		elif steps:
			by_step[steps[0].id].append(card)
	columns = [
		{
			"id": step.id,
			"key": str(step.id),
			"name": step.name,
			"description": step.description or "",
			"duration_label": step.duration_label(),
			"cards": by_step.get(step.id, []),
		}
		for step in steps
	]
	columns.append({
		"id": None,
		"key": COMPLETED_COLUMN,
		"name": "Concluído",
		"description": "",
		"duration_label": None,
		"cards": by_step[COMPLETED_COLUMN],
	})
	overdue_count = sum(
		1
		for item in items
		if item.status == "in_progress" and _due_info(item.due_at)["overdue"]
	)
	return jsonify({
		"model": _model_json(model),
		"columns": columns,
		"overdue_count": overdue_count,
		"total": len(items),
	})


@bp.route("/dashboard")
@login_required
def implantation_dashboard():
	now = _now()
	horizon = now - timedelta(days=21)
	query = Implantation.query.filter(
		db.or_(
			Implantation.status.in_(["in_progress", "paused"]),
			db.and_(
				Implantation.status == "completed",
				Implantation.completed_at.isnot(None),
				Implantation.completed_at >= horizon,
			),
		)
	).order_by(Implantation.updated_at.desc())
	records = query.limit(200).all()
	cards = [_implantation_json(item) for item in records]
	in_progress = sum(1 for item in records if item.status == "in_progress")
	paused = sum(1 for item in records if item.status == "paused")
	overdue = sum(1 for c in cards if c.get("alert") == "overdue")
	paused_long = sum(1 for c in cards if c.get("alert") == "paused_long")
	return jsonify({
		"kpis": {
			"in_progress": in_progress,
			"paused": paused,
			"overdue": overdue,
			"paused_long": paused_long,
			"completed_recent": sum(1 for item in records if item.status == "completed"),
		},
		"items": cards,
	})


@bp.route("/", methods=["POST"], strict_slashes=False)
@login_required
def create_implantation():
	data = _json()
	model = ImplantationModel.query.get(data.get("model_id"))
	if not model or not model.is_active:
		return jsonify({"error": "Selecione um modelo de implantação."}), 400
	steps = model.active_steps()
	if not steps:
		return jsonify({"error": "Este modelo não tem etapas ativas."}), 400
	try:
		client_id = int(data.get("external_client_id") or 0)
	except (TypeError, ValueError):
		client_id = 0
	if client_id <= 0:
		return jsonify({"error": "Selecione um cliente."}), 400
	client_name = (data.get("external_client_name") or "").strip()
	if not client_name:
		try:
			ext = get_external_client_by_id(client_id)
			client_name = (ext or {}).get("name") or f"Cliente #{client_id}"
		except ExternalPgError:
			client_name = f"Cliente #{client_id}"
	duplicate = Implantation.query.filter(
		Implantation.model_id == model.id,
		Implantation.external_client_id == client_id,
		Implantation.status.in_(["in_progress", "paused"]),
	).first()
	if duplicate:
		return jsonify({"error": "Este cliente já está neste modelo de implantação."}), 409
	step_id = data.get("step_id") or data.get("current_step_id")
	step = steps[0]
	if step_id not in (None, ""):
		try:
			wanted = int(step_id)
		except (TypeError, ValueError):
			return jsonify({"error": "Etapa inicial inválida."}), 400
		step = next((s for s in steps if s.id == wanted), None)
		if step is None:
			return jsonify({"error": "Etapa inicial inválida."}), 400
	item = Implantation(
		external_client_id=client_id,
		external_client_name=client_name[:200],
		model_id=model.id,
		notes=(data.get("notes") or "").strip() or None,
		created_by_id=getattr(current_user, "id", None),
		assigned_to_id=_resolve_user_id(data.get("assigned_to_id")),
	)
	db.session.add(item)
	step_assignee = _resolve_user_id(data.get("assignee_id") or data.get("step_assignee_id"))
	_open_step(item, step, assignee_id=step_assignee)
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True)), 201


bp.add_url_rule(
	"/items",
	endpoint="create_implantation_items",
	view_func=create_implantation,
	methods=["POST"],
)


@bp.route("/<int:implantation_id>")
@login_required
def get_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	return jsonify(_implantation_json(item, include_logs=True))


@bp.route("/<int:implantation_id>", methods=["PATCH"])
@login_required
def update_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	data = _json()
	if "notes" in data:
		item.notes = (data.get("notes") or "").strip() or None
	if "assigned_to_id" in data:
		item.assigned_to_id = _resolve_user_id(data.get("assigned_to_id"))
	if "assignee_id" in data or "step_assignee_id" in data:
		raw = data.get("assignee_id") if "assignee_id" in data else data.get("step_assignee_id")
		open_log = _current_open_log(item)
		if open_log:
			open_log.assignee_id = _resolve_user_id(raw)
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True))


def _move_implantation(item: Implantation, *, step_id=None, complete=False, assignee_id=None):
	now = _now()
	if item.status == "cancelled":
		raise ValueError("Implantação cancelada não pode ser movida.")
	if item.status == "paused" and not complete:
		raise ValueError("Retome a implantação antes de mover de etapa.")
	if complete or step_id in (None, "", COMPLETED_COLUMN, "done"):
		_close_current_log(item, now)
		item.status = "completed"
		item.completed_at = now
		item.paused_at = None
		item.due_at = None
		_clear_schedule(item, delete_appointment=True)
		return
	try:
		target_id = int(step_id)
	except (TypeError, ValueError) as exc:
		raise ValueError("Etapa inválida.") from exc
	step = ImplantationStep.query.filter_by(id=target_id, model_id=item.model_id, is_active=True).first()
	if not step:
		raise ValueError("Etapa inválida.")
	if item.status == "in_progress" and item.current_step_id == step.id:
		return
	_close_current_log(item, now)
	_open_step(item, step, now, assignee_id=assignee_id)


@bp.route("/<int:implantation_id>/move", methods=["POST"])
@login_required
def move_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	data = _json()
	complete = bool(data.get("completed") or data.get("complete"))
	step_id = data.get("step_id")
	if data.get("column") == COMPLETED_COLUMN:
		complete = True
		step_id = None
	try:
		_move_implantation(
			item,
			step_id=step_id,
			complete=complete,
			assignee_id=_resolve_user_id(data.get("assignee_id") or data.get("step_assignee_id")),
		)
		db.session.commit()
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400
	return jsonify(_implantation_json(item, include_logs=True))


@bp.route("/<int:implantation_id>/complete", methods=["POST"])
@login_required
def complete_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	try:
		_move_implantation(item, complete=True)
		db.session.commit()
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400
	return jsonify(_implantation_json(item, include_logs=True))


@bp.route("/<int:implantation_id>/cancel", methods=["POST"])
@login_required
def cancel_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	if item.status == "cancelled":
		return jsonify(_implantation_json(item, include_logs=True))
	now = _now()
	_close_current_log(item, now)
	item.status = "cancelled"
	item.cancelled_at = now
	item.paused_at = None
	item.due_at = None
	_clear_schedule(item, delete_appointment=True)
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True))


@bp.route("/<int:implantation_id>/pause", methods=["POST"])
@login_required
def pause_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	if item.status == "paused":
		return jsonify(_implantation_json(item, include_logs=True))
	if item.status != "in_progress":
		return jsonify({"error": "Só é possível pausar uma implantação em andamento."}), 400
	item.status = "paused"
	item.paused_at = _now()
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True))


@bp.route("/<int:implantation_id>/resume", methods=["POST"])
@login_required
def resume_implantation(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	if item.status == "in_progress":
		return jsonify(_implantation_json(item, include_logs=True))
	if item.status != "paused":
		return jsonify({"error": "Esta implantação não está pausada."}), 400
	now = _now()
	paused_at = _naive(item.paused_at) or now
	due = _naive(item.due_at)
	if due:
		item.due_at = now + (due - paused_at)
		open_log = (
			ImplantationStepLog.query.filter_by(implantation_id=item.id, completed_at=None)
			.order_by(ImplantationStepLog.entered_at.desc())
			.first()
		)
		if open_log:
			open_log.due_at = item.due_at
	item.status = "in_progress"
	item.paused_at = None
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True))


def notify_overdue_implantations() -> int:
	"""Cria notificações para etapas com prazo estourado. Usado pelo scheduler."""
	from ..notification_service import create_notifications

	now = _now()
	records = (
		Implantation.query.filter(
			Implantation.status == "in_progress",
			Implantation.due_at.isnot(None),
		)
		.order_by(Implantation.due_at.asc())
		.all()
	)
	records = [
		item for item in records
		if _naive(item.due_at) is not None and _naive(item.due_at) < now
	]
	if not records:
		return 0
	recipients = _team_recipient_ids()
	if not recipients:
		return 0
	created_total = 0
	for item in records:
		due = _naive(item.due_at)
		due_key = due.isoformat(timespec="seconds") if due else "none"
		client = (item.external_client_name or f"Cliente #{item.external_client_id}").strip()
		model_name = item.model.name if item.model else "Implantação"
		step_name = item.current_step.name if item.current_step else "etapa"
		due_br = _fmt(due) or ""
		items = create_notifications(
			recipients,
			notification_type="implantation_overdue",
			title=f"Prazo estourado · {client}"[:200],
			message=f"{model_name} · etapa {step_name} venceu em {due_br}."[:1000],
			url=f"/implantacao?model={item.model_id}",
			entity_type="implantation",
			entity_id=f"imp:{item.id}:step:{item.current_step_id}:{due_key}",
			send_push=True,
		)
		created_total += len(items)
	return created_total


def notify_paused_implantations() -> int:
	"""Notifica implantações pausadas há mais de 2 dias. Usado pelo scheduler."""
	from ..notification_service import create_notifications

	threshold = timedelta(days=PAUSED_ALERT_DAYS)
	now = _now()
	records = Implantation.query.filter(
		Implantation.status == "paused",
		Implantation.paused_at.isnot(None),
	).all()
	records = [
		item for item in records
		if _naive(item.paused_at) and (now - _naive(item.paused_at)) > threshold
	]
	if not records:
		return 0
	recipients = _team_recipient_ids()
	if not recipients:
		return 0
	created_total = 0
	for item in records:
		paused = _naive(item.paused_at)
		paused_key = paused.date().isoformat() if paused else "none"
		client = (item.external_client_name or f"Cliente #{item.external_client_id}").strip()
		model_name = item.model.name if item.model else "Implantação"
		info = _paused_info(item)
		items = create_notifications(
			recipients,
			notification_type="implantation_paused",
			title=f"Implantação pausada · {client}"[:200],
			message=(
				f"{model_name} está pausada {info.get('paused_for_label') or 'há mais de 2 dias'}."
			)[:1000],
			url=f"/implantacao?model={item.model_id}",
			entity_type="implantation",
			entity_id=f"imp:{item.id}:paused:{paused_key}",
			send_push=True,
		)
		created_total += len(items)
	return created_total


def start_scheduled_implantations() -> int:
	"""No dia do agendamento, avança a implantação para a etapa marcada."""
	today = _now().date()
	records = Implantation.query.filter(
		Implantation.status.in_(["in_progress", "paused"]),
		Implantation.scheduled_appointment_id.isnot(None),
		Implantation.scheduled_step_id.isnot(None),
	).all()
	started = 0
	for item in records:
		appt = _scheduled_appointment(item)
		if not appt:
			_clear_schedule(item)
			continue
		when = appt.appointment_date
		if when is not None and getattr(when, "tzinfo", None):
			when = utc_to_brasilia(when)
		when = _naive(when)
		if not when or when.date() > today:
			continue
		try:
			if item.status == "paused":
				item.status = "in_progress"
				item.paused_at = None
			_move_implantation(item, step_id=item.scheduled_step_id)
			started += 1
		except ValueError:
			continue
	if records:
		db.session.commit()
	return started


def _parse_when(raw):
	"""Interpreta o horário digitado como Brasília.

	datetime-local chega sem fuso (naive) e é gravado como está.
	ISO com Z/+00:00 é convertido de UTC para America/Sao_Paulo, para não
	persistir 16:50 local como 19:50.
	"""
	if not raw:
		raise ValueError("Informe data e horário do agendamento.")
	text = str(raw).strip()
	if text.endswith("Z"):
		text = text[:-1] + "+00:00"
	try:
		value = datetime.fromisoformat(text)
	except ValueError as exc:
		raise ValueError("Data do agendamento inválida.") from exc
	if getattr(value, "tzinfo", None) is not None:
		value = utc_to_brasilia(value)
	return _naive(value)


@bp.route("/<int:implantation_id>/schedule-next", methods=["POST"])
@login_required
def schedule_next_step(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	if item.status in ("completed", "cancelled"):
		return jsonify({"error": "Não é possível agendar etapa de uma implantação encerrada."}), 400
	data = _json()
	nxt = _next_step(item)
	step_id = data.get("step_id") or data.get("scheduled_step_id")
	if step_id not in (None, ""):
		try:
			wanted = int(step_id)
		except (TypeError, ValueError):
			return jsonify({"error": "Etapa inválida."}), 400
		step = ImplantationStep.query.filter_by(id=wanted, model_id=item.model_id, is_active=True).first()
	else:
		step = nxt
	if not step:
		return jsonify({"error": "Não há próxima etapa para agendar."}), 400
	if item.current_step_id == step.id:
		return jsonify({"error": "A etapa escolhida já está em andamento."}), 400
	try:
		when = _parse_when(data.get("appointment_date") or data.get("scheduled_at"))
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 400
	assignee = _effective_assignee(item)
	user_id = _resolve_user_id(data.get("user_id")) or (assignee.id if assignee else None) or _current_user_id()
	if not user_id:
		return jsonify({"error": "Selecione um técnico para o agendamento."}), 400
	title = f"Implantação · {item.external_client_name} · {step.name}"[:200]
	description = (
		f"Início automático da etapa \"{step.name}\" da implantação #{item.id} "
		f"({item.model.name if item.model else 'modelo'})."
	)
	appt = _scheduled_appointment(item)
	if appt:
		appt.title = title
		appt.description = description
		appt.appointment_date = when
		appt.client_id = item.external_client_id
		appt.user_id = user_id
		appt.implantation_id = item.id
		appt.implantation_step_id = step.id
	else:
		appt = Appointment(
			title=title,
			description=description,
			appointment_date=when,
			client_id=item.external_client_id,
			user_id=user_id,
			created_by=_current_user_id() or user_id,
			implantation_id=item.id,
			implantation_step_id=step.id,
		)
		db.session.add(appt)
		db.session.flush()
	item.scheduled_appointment_id = appt.id
	item.scheduled_step_id = step.id
	db.session.commit()
	try:
		from ..notification_service import create_notifications

		create_notifications(
			[user_id],
			notification_type="appointment",
			title="Etapa de implantação agendada",
			message=f"{title} · {appt.get_formatted_date()}",
			url="/agenda",
			entity_type="appointment",
			entity_id=appt.id,
		)
	except Exception:
		pass
	return jsonify(_implantation_json(item, include_logs=True))


@bp.route("/<int:implantation_id>/schedule-next", methods=["DELETE"])
@login_required
def cancel_scheduled_next_step(implantation_id: int):
	item = Implantation.query.get_or_404(implantation_id)
	_clear_schedule(item, delete_appointment=True)
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True))
