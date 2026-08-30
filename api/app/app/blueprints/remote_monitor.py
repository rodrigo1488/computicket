"""API HTTP do módulo de monitoramento remoto."""
from __future__ import annotations

from functools import wraps
import ntpath
import os
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from flask_login import current_user, login_required

from .. import db
from ..models import (
	RemoteAgent,
	RemoteAgentAlert,
	RemoteAgentCommand,
	RemoteAgentSample,
	RemoteFileTransfer,
)
from ..remote_monitor_service import (
	MAX_FILE_BYTES,
	MAX_TELEMETRY_BYTES,
	activate,
	agent_is_live,
	apply_socket_presence,
	authenticate_agent,
	command_for_agent,
	create_file_transfer,
	create_enrollment,
	enqueue_command,
	heartbeat,
	ingest_telemetry,
	mark_command_result,
	mark_command_running,
	push_command,
	revoke_agent,
	save_transfer_stream,
	sanitize_thresholds,
	transfer_file_path,
	transfer_for_agent,
	utc_now,
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


def _active_agent(agent_id: int):
	agent = db.session.get(RemoteAgent, agent_id)
	if not agent:
		return None, (jsonify({"error": "Agente não encontrado."}), 404)
	if agent.is_revoked:
		return None, (jsonify({"error": "Agente revogado não pode receber comandos."}), 409)
	return agent, None


def _audit_fields() -> dict:
	return {
		"audit_ip": request.remote_addr,
		"audit_user_agent": request.headers.get("User-Agent"),
	}


def _enqueue_web(agent: RemoteAgent, command_type: str, payload: dict, *, push_immediately: bool = True):
	try:
		audit = _audit_fields()
		command = enqueue_command(
			agent,
			command_type,
			payload,
			current_user.id,
			audit_ip=audit["audit_ip"],
			audit_user_agent=audit["audit_user_agent"],
			push_immediately=push_immediately,
		)
	except ValueError as exc:
		db.session.rollback()
		return None, (jsonify({"error": str(exc)}), 400)
	return command, None


def _confirmation_required(data: dict):
	if data.get("confirm") is not True:
		return jsonify({"error": "Esta ação crítica exige confirm=true."}), 400
	return None


def _agent_command_error(exc):
	db.session.rollback()
	message = str(exc)
	status = 404 if "não encontrado para este agente" in message else 400
	return jsonify({"error": message}), status


@bp.get("/stats")
@_web_roles
def stats():
	agents = RemoteAgent.query.filter_by(is_revoked=False).all()
	liveness = {agent.id: agent_is_live(agent) for agent in agents}
	online = sum(1 for agent in agents if liveness[agent.id])
	pending = sum(1 for agent in agents if agent.status == "pending" and not liveness[agent.id])
	offline = sum(1 for agent in agents if agent.status != "pending" and not liveness[agent.id])
	revoked = RemoteAgent.query.filter_by(is_revoked=True).count()
	statuses = {
		"online": online,
		"offline": offline,
		"pending": pending,
		"revoked": revoked,
	}
	return jsonify({
		"total": RemoteAgent.query.count(),
		"online": online,
		"offline": offline,
		"pending": pending,
		"revoked": revoked,
		"open_alerts": RemoteAgentAlert.query.filter_by(resolved_at=None).count(),
		"by_status": statuses,
		# Mantido por compatibilidade; representa presença efetiva compartilhada.
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


@bp.post("/agents/<int:agent_id>/actions")
@_web_roles
def agent_action(agent_id: int):
	agent, error = _active_agent(agent_id)
	if error:
		return error
	data, error = _json_payload()
	if error:
		return error
	action = str(data.get("action") or data.get("command_type") or "").strip().lower()
	if action not in {"reboot", "shutdown"}:
		return jsonify({"error": "Ação remota inválida."}), 400
	confirmation_error = _confirmation_required(data)
	if confirmation_error:
		return confirmation_error
	command, error = _enqueue_web(agent, action, {})
	if error:
		return error
	return jsonify(command.to_dict()), 201


@bp.post("/agents/<int:agent_id>/files/list")
@_web_roles
def list_agent_files(agent_id: int):
	agent, error = _active_agent(agent_id)
	if error:
		return error
	data = request.get_json(silent=True)
	if data is None:
		data = {}
	if not isinstance(data, dict):
		return jsonify({"error": "Corpo JSON inválido."}), 400
	command, error = _enqueue_web(agent, "list_directory", {"path": data.get("path", "")})
	if error:
		return error
	return jsonify(command.to_dict()), 201


@bp.post("/agents/<int:agent_id>/files/operation")
@_web_roles
def agent_file_operation(agent_id: int):
	agent, error = _active_agent(agent_id)
	if error:
		return error
	data, error = _json_payload()
	if error:
		return error
	operation = str(data.get("operation") or data.get("command_type") or "").strip().lower()
	if operation not in {"mkdir", "rename", "move", "copy", "delete"}:
		return jsonify({"error": "Operação de arquivo inválida."}), 400
	if operation == "delete":
		confirmation_error = _confirmation_required(data)
		if confirmation_error:
			return confirmation_error
	payload = {key: value for key, value in data.items() if key not in {"operation", "command_type", "confirm"}}
	command, error = _enqueue_web(agent, operation, payload)
	if error:
		return error
	return jsonify(command.to_dict()), 201


@bp.post("/agents/<int:agent_id>/files/upload")
@_web_roles
def upload_file_to_agent(agent_id: int):
	agent, error = _active_agent(agent_id)
	if error:
		return error
	if request.content_length and request.content_length > MAX_FILE_BYTES + 2 * 1024 * 1024:
		return jsonify({"error": "Arquivo excede o limite de 50 MiB."}), 413
	uploaded = request.files.get("file")
	if not uploaded or not uploaded.filename:
		return jsonify({"error": "Arquivo multipart é obrigatório no campo file."}), 400
	remote_path = request.form.get("remote_path")
	transfer = None
	try:
		transfer = create_file_transfer(agent, "upload", remote_path, uploaded.filename, status="staging")
		save_transfer_stream(transfer, uploaded.stream, expected_direction="upload")
		command, error = _enqueue_web(agent, "upload_file", {
			"remote_path": transfer.remote_path,
			"transfer_uuid": transfer.public_uuid,
		}, push_immediately=False)
		if error:
			raise ValueError(error[0].get_json().get("error", "Falha ao enfileirar upload"))
		transfer.command_id = command.id
		db.session.commit()
		push_command(command)
		return jsonify({"command": command.to_dict(), "transfer": transfer.to_dict()}), 201
	except ValueError as exc:
		db.session.rollback()
		if transfer:
			try:
				transfer_file_path(transfer).unlink(missing_ok=True)
			except (OSError, ValueError):
				pass
			persisted = db.session.get(RemoteFileTransfer, transfer.id)
			if persisted:
				db.session.delete(persisted)
				db.session.commit()
		status = 413 if "50 MiB" in str(exc) else 400
		return jsonify({"error": str(exc)}), status


@bp.post("/agents/<int:agent_id>/files/download")
@_web_roles
def request_file_from_agent(agent_id: int):
	agent, error = _active_agent(agent_id)
	if error:
		return error
	data, error = _json_payload()
	if error:
		return error
	remote_path = data.get("remote_path")
	filename = ntpath.basename(str(remote_path or "").replace("/", "\\")) or "download.bin"
	transfer = None
	try:
		transfer = create_file_transfer(agent, "download", remote_path, filename)
		command, error = _enqueue_web(agent, "download_file", {
			"remote_path": transfer.remote_path,
			"transfer_uuid": transfer.public_uuid,
		}, push_immediately=False)
		if error:
			raise ValueError(error[0].get_json().get("error", "Falha ao enfileirar download"))
		transfer.command_id = command.id
		db.session.commit()
		push_command(command)
		return jsonify({"command": command.to_dict(), "transfer": transfer.to_dict()}), 201
	except ValueError as exc:
		db.session.rollback()
		if transfer:
			persisted = db.session.get(RemoteFileTransfer, transfer.id)
			if persisted:
				db.session.delete(persisted)
				db.session.commit()
		return jsonify({"error": str(exc)}), 400


@bp.get("/commands/<int:command_id>")
@_web_roles
def command_detail(command_id: int):
	command = db.session.get(RemoteAgentCommand, command_id)
	if not command:
		return jsonify({"error": "Comando não encontrado."}), 404
	return jsonify(command.to_dict())


@bp.get("/agents/<int:agent_id>/commands")
@_web_roles
def agent_commands(agent_id: int):
	if db.session.get(RemoteAgent, agent_id) is None:
		return jsonify({"error": "Agente não encontrado."}), 404
	try:
		limit = min(500, max(1, int(request.args.get("limit", 100))))
	except (TypeError, ValueError):
		limit = 100
	rows = (
		RemoteAgentCommand.query.filter_by(agent_id=agent_id)
		.order_by(RemoteAgentCommand.id.desc())
		.limit(limit)
		.all()
	)
	return jsonify({"items": [row.to_dict() for row in rows]})


@bp.get("/transfers/<public_uuid>/download")
@_web_roles
def web_download_transfer(public_uuid: str):
	transfer = RemoteFileTransfer.query.filter_by(public_uuid=public_uuid).first()
	if not transfer or transfer.direction != "download":
		return jsonify({"error": "Transferência não encontrada."}), 404
	if transfer.expires_at <= utc_now():
		return jsonify({"error": "Transferência expirada."}), 410
	if transfer.status != "ready":
		return jsonify({"error": "Arquivo ainda não está disponível."}), 409
	try:
		path = transfer_file_path(transfer)
	except ValueError:
		return jsonify({"error": "Transferência inválida."}), 404
	if not path.is_file():
		return jsonify({"error": "Conteúdo da transferência não encontrado."}), 404
	return send_file(path, as_attachment=True, download_name=transfer.original_filename)


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
	configured = (os.environ.get("REMOTE_MONITOR_AGENT_PATH") or "").strip()
	candidates = [Path(configured)] if configured else []
	candidates.append(Path("/app/artifacts/ComputicketMonitorAgent.exe"))
	for parent in Path(__file__).resolve().parents:
		candidates.append(
			parent / "agents" / "remote_monitor_agent" / "dist" / "ComputicketMonitorAgent.exe"
		)
	executable = next((candidate for candidate in candidates if candidate.is_file()), None)
	if executable is None:
		return jsonify({
			"error": "Executável do agente não encontrado na imagem da API. Reconstrua os containers com --build."
		}), 404
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


@bp.get("/agent/commands")
def pending_agent_commands():
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	rows = (
		RemoteAgentCommand.query
		.filter_by(agent_id=agent.id, status="pending")
		.order_by(RemoteAgentCommand.id.asc())
		.limit(100)
		.all()
	)
	return jsonify({"items": [row.to_agent_event() for row in rows]})


@bp.post("/agent/commands/<int:command_id>/started")
def agent_command_started(command_id: int):
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	try:
		command = mark_command_running(command_id, agent.id)
	except ValueError as exc:
		return _agent_command_error(exc)
	return jsonify(command.to_dict())


@bp.post("/agent/commands/<int:command_id>/result")
def agent_command_result(command_id: int):
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	data, error = _json_payload()
	if error:
		return error
	try:
		command = mark_command_result(
			command_id,
			agent.id,
			status=data.get("status"),
			result=data.get("result"),
			error=data.get("error"),
		)
	except ValueError as exc:
		return _agent_command_error(exc)
	return jsonify(command.to_dict())


@bp.get("/agent/transfers/<public_uuid>/content")
def agent_download_staging(public_uuid: str):
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	transfer = transfer_for_agent(public_uuid, agent.id)
	if not transfer or transfer.direction != "upload":
		return jsonify({"error": "Transferência não encontrada para este agente."}), 404
	if transfer.expires_at <= utc_now():
		return jsonify({"error": "Transferência expirada."}), 410
	if transfer.status != "ready" or not transfer.command_id:
		return jsonify({"error": "Conteúdo não disponível."}), 409
	try:
		path = transfer_file_path(transfer)
	except ValueError:
		return jsonify({"error": "Transferência inválida."}), 404
	if not path.is_file():
		return jsonify({"error": "Conteúdo não encontrado."}), 404
	return send_file(path, as_attachment=True, download_name=transfer.original_filename)


@bp.route("/agent/transfers/<public_uuid>/content", methods=["PUT", "POST"])
def agent_upload_downloaded_file(public_uuid: str):
	agent = _request_agent()
	if not agent:
		return jsonify({"error": "Credenciais do agente inválidas."}), 401
	if request.content_length and request.content_length > MAX_FILE_BYTES + 2 * 1024 * 1024:
		return jsonify({"error": "Arquivo excede o limite de 50 MiB."}), 413
	transfer = transfer_for_agent(public_uuid, agent.id)
	if not transfer or transfer.direction != "download":
		return jsonify({"error": "Transferência não encontrada para este agente."}), 404
	if not transfer.command_id or not command_for_agent(transfer.command_id, agent.id):
		return jsonify({"error": "Comando da transferência não pertence a este agente."}), 403
	uploaded = request.files.get("file")
	stream = uploaded.stream if uploaded else request.stream
	try:
		save_transfer_stream(transfer, stream, expected_direction="download")
	except ValueError as exc:
		db.session.rollback()
		transfer = transfer_for_agent(public_uuid, agent.id)
		if transfer:
			transfer.status = "error"
			transfer.updated_at = utc_now()
			db.session.commit()
		status = 413 if "50 MiB" in str(exc) else 400
		return jsonify({"error": str(exc)}), status
	return jsonify(transfer.to_dict())
