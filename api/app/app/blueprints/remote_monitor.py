"""API HTTP do módulo de monitoramento remoto."""
from __future__ import annotations

from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from flask_login import current_user, login_required
from sqlalchemy import func

from .. import db
from ..models import RemoteAgent, RemoteAgentAlert, RemoteAgentSample
from ..remote_monitor_service import (
	MAX_TELEMETRY_BYTES,
	activate,
	apply_socket_presence,
	authenticate_agent,
	create_enrollment,
	heartbeat,
	ingest_telemetry,
	revoke_agent,
	sanitize_thresholds,
)

bp = Blueprint("remote_monitor", __name__, url_prefix="/api/remote-monitor")


def _web_roles(view):
	@wraps(view)
	@login_required
	def wrapped(*args, **kwargs):
		if not (current_user.has_role("admin") or current_user.has_role("tecnico")):
			return jsonify({"error": "Acesso restrito a administradores e técnicos."}), 403
		return view(*args, **kwargs)
	return wrapped


def _admin_required():
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem realizar esta ação."}), 403
	return None


def _json_payload():
	if request.content_length and request.content_length > MAX_TELEMETRY_BYTES:
		return None, (jsonify({"error": "Payload excede o tamanho permitido."}), 413)
	data = request.get_json(silent=True)
	if not isinstance(data, dict):
		return None, (jsonify({"error": "Corpo JSON inválido."}), 400)
	return data, None


def _bearer_token() -> str | None:
	header = (request.headers.get("Authorization") or "").strip()
	scheme, separator, token = header.partition(" ")
	if not separator or scheme.lower() != "bearer":
		return None
	return token.strip() or None


def _request_agent():
	return authenticate_agent(request.headers.get("X-Device-Id"), _bearer_token())


@bp.get("/stats")
@_web_roles
def stats():
	from ..remote_monitor_service import connected_agent_ids
	live_ids = connected_agent_ids()
	agents = RemoteAgent.query.filter_by(is_revoked=False).all()
	online = sum(1 for a in agents if a.id in live_ids)
	pending = sum(1 for a in agents if a.status == "pending" and a.id not in live_ids)
	offline = sum(1 for a in agents if a.id not in live_ids and a.status != "pending")
	statuses = dict(db.session.query(RemoteAgent.status, func.count(RemoteAgent.id)).group_by(RemoteAgent.status).all())
	return jsonify({
		"total": RemoteAgent.query.count(),
		"online": online,
		"offline": offline,
		"pending": pending,
		"revoked": RemoteAgent.query.filter_by(is_revoked=True).count(),
		"open_alerts": RemoteAgentAlert.query.filter_by(resolved_at=None).count(),
		"by_status": statuses,
		"socket_online": online,
	})


@bp.route("/agents", methods=["GET", "POST"])
@_web_roles
def agents():
	if request.method == "POST":
		denied = _admin_required()
		if denied:
			return denied
		data, error = _json_payload()
		if error:
			return error
		name = str(data.get("name") or "").strip()
		client_name = str(data.get("external_client_name") or data.get("client_name") or "").strip()
		try:
			client_id = int(data.get("external_client_id", data.get("client_id")))
			thresholds = sanitize_thresholds(data.get("thresholds"))
		except (TypeError, ValueError) as exc:
			return jsonify({"error": str(exc) or "Cliente inválido."}), 400
		if client_id <= 0 or not name or not client_name:
			return jsonify({"error": "Cliente externo e nome do agente são obrigatórios."}), 400
		agent = RemoteAgent(
			external_client_id=client_id,
			external_client_name=client_name[:200],
			name=name[:200],
			status="pending",
			thresholds=thresholds,
		)
		db.session.add(agent)
		db.session.commit()
		code = create_enrollment(agent, data.get("expires_minutes", 30))
		return jsonify({"agent": agent.to_dict(), "activation_code": code}), 201

	query = RemoteAgent.query
	status = str(request.args.get("status") or "").strip()
	client_id = request.args.get("client_id", type=int)
	q = str(request.args.get("q") or "").strip()
	if status:
		query = query.filter(RemoteAgent.status == status)
	if client_id:
		query = query.filter(RemoteAgent.external_client_id == client_id)
	if q:
		like = f"%{q}%"
		query = query.filter(
			RemoteAgent.name.ilike(like)
			| RemoteAgent.external_client_name.ilike(like)
			| RemoteAgent.device_uuid.ilike(like)
		)
	try:
		page = max(1, int(request.args.get("page", 1)))
		per_page = min(200, max(1, int(request.args.get("per_page", 25))))
	except (TypeError, ValueError):
		page, per_page = 1, 25
	result = query.order_by(RemoteAgent.name.asc()).paginate(page=page, per_page=per_page, error_out=False)
	return jsonify({
		"items": [
			apply_socket_presence(agent.to_dict(include_snapshot=True), agent)
			for agent in result.items
		],
		"total": result.total,
		"page": page,
		"per_page": per_page,
	})


@bp.route("/agents/<int:agent_id>", methods=["GET", "DELETE"])
@_web_roles
def agent_detail(agent_id: int):
	agent = RemoteAgent.query.get(agent_id)
	if not agent:
		return jsonify({"error": "Agente não encontrado."}), 404
	if request.method == "DELETE":
		denied = _admin_required()
		if denied:
			return denied
		name = agent.name
		db.session.delete(agent)
		db.session.commit()
		return jsonify({"ok": True, "deleted_id": agent_id, "name": name})
	payload = apply_socket_presence(agent.to_dict(include_snapshot=True), agent)
	payload["open_alerts"] = [
		alert.to_dict()
		for alert in agent.alerts.filter_by(resolved_at=None).order_by(RemoteAgentAlert.opened_at.desc()).all()
	]
	return jsonify(payload)


@bp.get("/agents/<int:agent_id>/history")
@_web_roles
def agent_history(agent_id: int):
	RemoteAgent.query.get_or_404(agent_id)
	try:
		limit = min(43200, max(1, int(request.args.get("limit", 1440))))
	except (TypeError, ValueError):
		limit = 1440
	rows = (
		RemoteAgentSample.query.filter_by(agent_id=agent_id)
		.order_by(RemoteAgentSample.minute_at.desc()).limit(limit).all()
	)
	return jsonify({"items": [row.to_dict() for row in reversed(rows)]})


@bp.get("/alerts")
@_web_roles
def alerts():
	query = RemoteAgentAlert.query
	if request.args.get("agent_id", type=int):
		query = query.filter(RemoteAgentAlert.agent_id == request.args.get("agent_id", type=int))
	if str(request.args.get("open") or "true").lower() in {"1", "true", "yes"}:
		query = query.filter(RemoteAgentAlert.resolved_at.is_(None))
	try:
		limit = min(1000, max(1, int(request.args.get("limit", 200))))
	except (TypeError, ValueError):
		limit = 200
	rows = query.order_by(RemoteAgentAlert.opened_at.desc()).limit(limit).all()
	return jsonify({"items": [row.to_dict() for row in rows]})


@bp.post("/agents/<int:agent_id>/enrollment")
@_web_roles
def reissue_enrollment(agent_id: int):
	denied = _admin_required()
	if denied:
		return denied
	agent = RemoteAgent.query.get_or_404(agent_id)
	data = request.get_json(silent=True) or {}
	try:
		code = create_enrollment(agent, data.get("expires_minutes", 30))
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 400
	return jsonify({"activation_code": code, "agent_id": agent.id}), 201


@bp.post("/agents/<int:agent_id>/revoke")
@_web_roles
def revoke(agent_id: int):
	denied = _admin_required()
	if denied:
		return denied
	agent = RemoteAgent.query.get_or_404(agent_id)
	revoke_agent(agent)
	return jsonify(apply_socket_presence(agent.to_dict(), agent))


@bp.post("/agents/<int:agent_id>/delete")
@_web_roles
def delete_agent(agent_id: int):
	denied = _admin_required()
	if denied:
		return denied
	agent = RemoteAgent.query.get(agent_id)
	if not agent:
		return jsonify({"error": "Agente não encontrado."}), 404
	name = agent.name
	db.session.delete(agent)
	db.session.commit()
	return jsonify({"ok": True, "deleted_id": agent_id, "name": name})


@bp.get("/download")
@_web_roles
def download():
	executable = Path(__file__).resolve().parents[4] / "agents" / "remote_monitor_agent" / "dist" / "ComputicketMonitorAgent.exe"
	if not executable.is_file():
		return jsonify({"error": "Instalador do agente ainda não está disponível no servidor."}), 404
	return send_file(executable, as_attachment=True, download_name="ComputicketMonitorAgent.exe")


@bp.post("/enroll")
def enroll():
	data, error = _json_payload()
	if error:
		return error
	try:
		agent, token = activate(
			data.get("activation_code") or data.get("code"),
			data.get("device_id"),
			data.get("version"),
		)
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400
	return jsonify({"device_id": agent.device_uuid, "token": token, "agent": agent.to_dict()}), 201


@bp.post("/telemetry")
def telemetry():
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	data, error = _json_payload()
	if error:
		return error
	try:
		return jsonify(ingest_telemetry(agent, data))
	except ValueError as exc:
		db.session.rollback()
		return jsonify({"error": str(exc)}), 400


@bp.post("/heartbeat")
def agent_heartbeat():
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	data = request.get_json(silent=True)
	if data is not None and not isinstance(data, dict):
		return jsonify({"error": "Corpo JSON inválido."}), 400
	return jsonify(heartbeat(agent, data or {}))
