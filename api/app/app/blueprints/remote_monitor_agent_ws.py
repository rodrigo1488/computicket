"""Namespaces Socket.IO do agente e dos visualizadores web."""
from __future__ import annotations

from flask import request
from flask_login import current_user
from flask_socketio import emit, join_room, leave_room

from .. import db, socketio
from ..models import RemoteAgent
from ..remote_monitor_service import (
	agent_id_for_sid,
	authenticate_agent,
	broadcast_live_telemetry,
	heartbeat,
	ingest_telemetry,
	mark_command_result,
	mark_command_running,
	push_pending_commands,
	register_agent_connection,
	unregister_agent_connection,
)

AGENT_NAMESPACE = "/remote-monitor"
VIEW_NAMESPACE = "/remote-monitor-view"
VIEW_ROOM = "remote-monitor"


def _auth_payload(auth) -> dict[str, str | None]:
	"""Extrai credenciais somente do auth dict do handshake."""
	auth = auth if isinstance(auth, dict) else {}
	event = getattr(request, "event", None)
	if isinstance(event, dict):
		extra = event.get("auth")
		if isinstance(extra, dict):
			auth = {**extra, **auth}

	device_id = auth.get("device_id")
	token = auth.get("token")
	return {
		"device_id": (str(device_id).strip() if device_id else "") or None,
		"token": (str(token).strip() if token else "") or None,
	}


def _agent_for_sid() -> RemoteAgent | None:
	agent_id = agent_id_for_sid(request.sid)
	if not agent_id:
		return None
	agent = db.session.get(RemoteAgent, agent_id)
	if not agent or agent.is_revoked:
		return None
	return agent


@socketio.on("connect", namespace=AGENT_NAMESPACE)
def remote_agent_connect(auth=None):
	creds = _auth_payload(auth)
	device_id = creds["device_id"]
	token = creds["token"]
	agent = authenticate_agent(device_id, token, touch=True)
	if not agent:
		return False
	register_agent_connection(request.sid, agent.id)
	join_room(f"agent:{agent.id}")
	emit("ready", {"ok": True, "agent_id": agent.id, "device_id": agent.device_uuid})
	push_pending_commands(agent.id, request.sid)


@socketio.on("disconnect", namespace=AGENT_NAMESPACE)
def remote_agent_disconnect():
	unregister_agent_connection(request.sid)


@socketio.on("telemetry", namespace=AGENT_NAMESPACE)
def remote_agent_telemetry(data):
	agent = _agent_for_sid()
	if not agent:
		return {"ok": False, "error": "Não autenticado"}
	try:
		result = ingest_telemetry(agent, data if isinstance(data, dict) else {})
		buffer_id = (data or {}).get("buffer_id") if isinstance(data, dict) else None
		# ACK explícito — o callback do python-socketio com Flask-SocketIO é instável.
		if buffer_id is not None:
			emit("telemetry_ack", {"ok": True, "buffer_id": buffer_id})
		return {"ok": True, "agent": result, "buffer_id": buffer_id}
	except ValueError as exc:
		db.session.rollback()
		return {"ok": False, "error": str(exc)}


@socketio.on("live_telemetry", namespace=AGENT_NAMESPACE)
def remote_agent_live_telemetry(data):
	agent = _agent_for_sid()
	if not agent:
		return {"ok": False, "error": "Não autenticado"}
	try:
		return {"ok": True, "broadcast": broadcast_live_telemetry(agent, data)}
	except ValueError as exc:
		return {"ok": False, "error": str(exc)}


@socketio.on("heartbeat", namespace=AGENT_NAMESPACE)
def remote_agent_heartbeat(data=None):
	agent = _agent_for_sid()
	if not agent:
		return {"ok": False, "error": "Não autenticado"}
	return {"ok": True, "agent": heartbeat(agent, data if isinstance(data, dict) else {})}


@socketio.on("command_started", namespace=AGENT_NAMESPACE)
def remote_agent_command_started(data):
	agent = _agent_for_sid()
	if not agent:
		return {"ok": False, "error": "Não autenticado"}
	try:
		command = mark_command_running(int((data or {}).get("command_id")), agent.id)
		return {"ok": True, "command": command.to_dict()}
	except (TypeError, ValueError) as exc:
		db.session.rollback()
		return {"ok": False, "error": str(exc)}


@socketio.on("command_result", namespace=AGENT_NAMESPACE)
def remote_agent_command_result(data):
	agent = _agent_for_sid()
	if not agent:
		return {"ok": False, "error": "Não autenticado"}
	data = data if isinstance(data, dict) else {}
	try:
		command = mark_command_result(
			int(data.get("command_id")),
			agent.id,
			status=data.get("status"),
			result=data.get("result"),
			error=data.get("error"),
		)
		return {"ok": True, "command": command.to_dict()}
	except (TypeError, ValueError) as exc:
		db.session.rollback()
		return {"ok": False, "error": str(exc)}


@socketio.on("connect", namespace=VIEW_NAMESPACE)
def remote_view_connect(_auth=None):
	if not current_user.is_authenticated:
		return False
	if not (current_user.has_role("admin") or current_user.has_role("tecnico")):
		return False
	join_room(VIEW_ROOM)
	emit("ready", {"ok": True})


@socketio.on("disconnect", namespace=VIEW_NAMESPACE)
def remote_view_disconnect():
	try:
		leave_room(VIEW_ROOM)
	except Exception:
		pass


@socketio.on("join_agent", namespace=VIEW_NAMESPACE)
def remote_view_join_agent(data):
	if not current_user.is_authenticated:
		return {"ok": False, "error": "Não autenticado"}
	try:
		agent_id = int((data or {}).get("agent_id"))
	except (TypeError, ValueError):
		return {"ok": False, "error": "agent_id inválido"}
	if db.session.get(RemoteAgent, agent_id) is None:
		return {"ok": False, "error": "Agente não encontrado"}
	leave_room(VIEW_ROOM)
	join_room(f"agent:{agent_id}")
	return {"ok": True, "agent_id": agent_id}
