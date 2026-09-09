"""API JSON do módulo Implantação (modelos, passos, Kanban e prazos)."""
from datetime import timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .. import db
from ..external_pg import ExternalPgError, get_external_client_by_id
from ..models import (
	Implantation,
	ImplantationModel,
	ImplantationStep,
	ImplantationStepLog,
	System,
	User,
)
from ..timezone_utils import get_brasilia_now

bp = Blueprint("implantacao", __name__, url_prefix="/api/implantacao")

DURATION_UNITS = {"hours", "days"}
COMPLETED_COLUMN = "completed"


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
		"active_count": Implantation.query.filter_by(model_id=model.id, status="in_progress").count(),
	}
	if include_steps:
		payload["steps"] = [_step_json(s) for s in sorted(active, key=lambda s: s.position)]
	return payload


def _log_json(log: ImplantationStepLog):
	due = _due_info(log.due_at)
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
	}


def _implantation_json(item: Implantation, *, include_logs=False):
	due = _due_info(item.due_at) if item.status == "in_progress" else {
		"overdue": False,
		"due_at": _iso(item.due_at),
		"due_label": "concluída" if item.status == "completed" else "cancelada",
		"due_at_label": _fmt(item.due_at),
	}
	model = item.model
	step = item.current_step
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
		"completed_at": _iso(item.completed_at),
		"created_by_name": item.created_by.name if item.created_by else None,
		**due,
	}
	if include_logs:
		logs = sorted(item.step_logs or [], key=lambda row: row.entered_at or _now())
		payload["logs"] = [_log_json(row) for row in logs]
	return payload


def _open_step(item: Implantation, step: ImplantationStep, now=None):
	now = now or _now()
	due_at = _compute_due_at(now, step)
	item.current_step_id = step.id
	item.entered_at = now
	item.due_at = due_at
	item.status = "in_progress"
	item.completed_at = None
	item.cancelled_at = None
	db.session.add(
		ImplantationStepLog(
			implantation=item,
			step_id=step.id,
			entered_at=now,
			due_at=due_at,
		)
	)


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
		busy = Implantation.query.filter_by(
			current_step_id=step.id,
			status="in_progress",
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
		Implantation.status.in_(["in_progress", "completed"]),
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
			"duration_label": step.duration_label(),
			"cards": by_step.get(step.id, []),
		}
		for step in steps
	]
	columns.append({
		"id": None,
		"key": COMPLETED_COLUMN,
		"name": "Concluído",
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
	duplicate = Implantation.query.filter_by(
		model_id=model.id,
		external_client_id=client_id,
		status="in_progress",
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
	)
	db.session.add(item)
	_open_step(item, step)
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
	db.session.commit()
	return jsonify(_implantation_json(item, include_logs=True))


def _move_implantation(item: Implantation, *, step_id=None, complete=False):
	now = _now()
	if complete or step_id in (None, "", COMPLETED_COLUMN, "done"):
		if item.status == "cancelled":
			raise ValueError("Implantação cancelada não pode ser movida.")
		_close_current_log(item, now)
		item.status = "completed"
		item.completed_at = now
		item.due_at = None
		return
	try:
		target_id = int(step_id)
	except (TypeError, ValueError) as exc:
		raise ValueError("Etapa inválida.") from exc
	step = ImplantationStep.query.filter_by(id=target_id, model_id=item.model_id, is_active=True).first()
	if not step:
		raise ValueError("Etapa inválida.")
	if item.status == "cancelled":
		raise ValueError("Implantação cancelada não pode ser movida.")
	if item.status == "in_progress" and item.current_step_id == step.id:
		return
	_close_current_log(item, now)
	_open_step(item, step, now)


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
		_move_implantation(item, step_id=step_id, complete=complete)
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
	item.due_at = None
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
