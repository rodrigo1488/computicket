"""WebSocket (Socket.IO namespace /uniplus) para o agente local Uniplus."""
from __future__ import annotations

from flask import request
from flask_socketio import emit, join_room, leave_room

from .. import socketio
from ..uniplus_jobs import (
	AGENTS_ROOM,
	UNIPLUS_NS,
	apply_ack,
	mark_running,
	push_pending_jobs,
	register_sid,
	unregister_sid,
	validate_agent_auth,
)


def _auth_payload(auth) -> dict:
	"""Extrai device_id/token do handshake (auth dict, query, headers)."""
	auth = auth if isinstance(auth, dict) else {}
	# Alguns clientes/proxy só repassam auth em request.event['auth']
	event = getattr(request, "event", None)
	if isinstance(event, dict):
		extra = event.get("auth")
		if isinstance(extra, dict):
			auth = {**extra, **auth}

	device_id = (
		(auth.get("device_id") if auth else None)
		or request.args.get("device_id")
		or request.headers.get("X-Device-Id")
	)
	token = (
		(auth.get("token") if auth else None)
		or request.args.get("token")
		or (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
	)
	return {
		"device_id": (device_id or "").strip() or None,
		"token": (token or "").strip() or None,
	}


@socketio.on("connect", namespace=UNIPLUS_NS)
def uniplus_connect(auth=None):
	creds = _auth_payload(auth)
	device_id = creds["device_id"]
	token = creds["token"]
	ok, msg = validate_agent_auth(device_id, token)
	if not ok:
		print(
			f"[uniplus] connect rejeitado: {msg} "
			f"(device={device_id!r}, auth_keys={list((auth or {}).keys()) if isinstance(auth, dict) else type(auth)})"
		)
		return False

	sid = request.sid
	register_sid(sid, device_id=device_id)
	join_room(AGENTS_ROOM)
	print(f"[uniplus] agente conectado sid={sid} device={device_id}")
	emit("ready", {"event": "ready", "message": "conectado", "device_id": device_id})
	# Drena fila pendente
	n = push_pending_jobs(sid=sid)
	if n:
		print(f"[uniplus] reenviados {n} jobs pendentes para sid={sid}")


@socketio.on("disconnect", namespace=UNIPLUS_NS)
def uniplus_disconnect():
	sid = request.sid
	try:
		leave_room(AGENTS_ROOM)
	except Exception:
		pass
	unregister_sid(sid)
	print(f"[uniplus] agente desconectado sid={sid}")


@socketio.on("ack", namespace=UNIPLUS_NS)
def uniplus_ack(data):
	"""ACK do agente: { event, job_id, status, message?, permanent?, result? }."""
	data = data or {}
	job_id = data.get("job_id")
	status = data.get("status") or "error"
	message = data.get("message")
	permanent = bool(data.get("permanent"))
	result = data.get("result")
	try:
		job_id = int(job_id)
	except (TypeError, ValueError):
		emit("error", {"message": "job_id inválido"})
		return
	job = apply_ack(job_id, status, message, permanent=permanent, result=result)
	if not job:
		emit("error", {"message": f"job {job_id} não encontrado"})
		return
	print(f"[uniplus] ACK job={job_id} status={status} msg={message}")


@socketio.on("job_started", namespace=UNIPLUS_NS)
def uniplus_job_started(data):
	data = data or {}
	try:
		job_id = int(data.get("job_id"))
	except (TypeError, ValueError):
		return
	mark_running(job_id)


@socketio.on("ping_agent", namespace=UNIPLUS_NS)
def uniplus_ping(_data=None):
	emit("pong_agent", {"ok": True})
