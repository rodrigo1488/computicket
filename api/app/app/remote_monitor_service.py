"""Regras de segurança, telemetria e manutenção do monitoramento remoto."""
from __future__ import annotations

import hashlib
import hmac
import json
import ntpath
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from flask import current_app
from sqlalchemy.exc import IntegrityError

from . import db
from .models import (
	RemoteAgent,
	RemoteAgentAlert,
	RemoteAgentEnrollment,
	RemoteAgentCommand,
	RemoteFileTransfer,
	RemoteAgentSample,
	RemoteAgentSnapshot,
)

DEFAULT_THRESHOLDS = {"cpu": 90.0, "ram": 90.0, "disk": 90.0, "temperature": 85.0}
MAX_TELEMETRY_BYTES = 512 * 1024
# Heartbeat do agente a cada ~15s; margem para falha pontual de emit/ACK.
OFFLINE_AFTER_SECONDS = 90
LIVE_TOUCH_SECONDS = 10.0
RETENTION_DAYS = 30
MAX_PENDING_COMMANDS = 100
MAX_FILE_BYTES = 50 * 1024 * 1024
TRANSFER_TTL_HOURS = 24
ALLOWED_COMMAND_TYPES = frozenset({
	"reboot",
	"shutdown",
	"list_directory",
	"mkdir",
	"rename",
	"move",
	"copy",
	"delete",
	"upload_file",
	"download_file",
})

_connections_lock = threading.Lock()
# sid -> agent_id (presença Socket.IO em memória)
_connections: dict[str, int] = {}
_live_lock = threading.Lock()
_last_live_by_agent: dict[int, float] = {}
_last_touch_by_agent: dict[int, float] = {}


def utc_now():
	"""UTC sem tzinfo, compatível com as colunas DateTime existentes.

	Usa relógio UTC direto (não round-trip Brasília), evitando desvios de
	timezone/config que fazem last_seen parecer antigo e o agente Offline.
	"""
	return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_iso(dt: datetime | None) -> str | None:
	"""Serializa datetime naive-UTC (ou aware) como ISO-8601 com sufixo Z."""
	if dt is None:
		return None
	if dt.tzinfo is not None:
		dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
	return dt.isoformat(timespec="seconds") + "Z"


def register_agent_connection(sid: str, agent_id: int) -> None:
	with _connections_lock:
		_connections[str(sid)] = int(agent_id)


def unregister_agent_connection(sid: str) -> int | None:
	with _connections_lock:
		agent_id = _connections.pop(str(sid), None)
	# Uma queda de transporte não significa que o computador ficou offline:
	# o agente também envia heartbeat/telemetria por HTTP e pode reconectar logo
	# em seguida. A manutenção aplica OFFLINE_AFTER_SECONDS sobre last_seen.
	return agent_id


def connected_agent_ids() -> set[int]:
	with _connections_lock:
		return set(_connections.values())


def agent_is_live(agent: RemoteAgent, now: datetime | None = None) -> bool:
	"""Presença compartilhável entre processos, baseada no último heartbeat."""
	if agent.is_revoked or agent.last_seen is None:
		return False
	now = now or utc_now()
	last_seen = agent.last_seen
	if last_seen.tzinfo is not None:
		last_seen = last_seen.astimezone(timezone.utc).replace(tzinfo=None)
	if now.tzinfo is not None:
		now = now.astimezone(timezone.utc).replace(tzinfo=None)
	return last_seen >= now - timedelta(seconds=OFFLINE_AFTER_SECONDS)


def apply_socket_presence(payload: dict, agent: RemoteAgent, now: datetime | None = None) -> dict:
	"""Combina heartbeat persistido com o socket local apenas para diagnóstico."""
	if agent.is_revoked:
		payload["status"] = "revoked"
		payload["socket_connected"] = False
		return payload
	payload["socket_connected"] = agent.id in connected_agent_ids()
	if agent_is_live(agent, now):
		payload["status"] = "online"
	elif payload.get("status") != "pending":
		payload["status"] = "offline"
	return payload


def agent_id_for_sid(sid: str) -> int | None:
	with _connections_lock:
		return _connections.get(str(sid))


def sids_for_agent(agent_id: int) -> list[str]:
	with _connections_lock:
		return [sid for sid, current_agent_id in _connections.items() if current_agent_id == int(agent_id)]


def normalize_activation_code(code: str | None) -> str:
	return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


def sha256_hash(value: str) -> str:
	return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_activation_code(code: str | None) -> str:
	return sha256_hash(normalize_activation_code(code))


def hash_agent_token(token: str) -> str:
	return sha256_hash(token)


def verify_agent_token(token: str | None, expected_hash: str | None) -> bool:
	if not token or not expected_hash:
		return False
	return hmac.compare_digest(hash_agent_token(str(token)), str(expected_hash))


def generate_activation_code() -> str:
	raw = secrets.token_hex(6).upper()
	return "-".join(raw[i:i + 4] for i in range(0, 12, 4))


def generate_agent_token() -> str:
	return secrets.token_urlsafe(32)


def sanitize_thresholds(value: Any) -> dict[str, float]:
	if value is None:
		return dict(DEFAULT_THRESHOLDS)
	if not isinstance(value, dict):
		raise ValueError("thresholds deve ser um objeto JSON")
	result = dict(DEFAULT_THRESHOLDS)
	for key in DEFAULT_THRESHOLDS:
		if key not in value:
			continue
		try:
			number = float(value[key])
		except (TypeError, ValueError):
			raise ValueError(f"Threshold {key} inválido") from None
		if not 0 < number <= 200:
			raise ValueError(f"Threshold {key} fora do intervalo permitido")
		result[key] = number
	return result


def create_enrollment(agent: RemoteAgent, expires_minutes: int = 30) -> str:
	if not agent or not agent.id or agent.is_revoked:
		raise ValueError("Agente inválido ou revogado")
	try:
		expires_minutes = max(1, min(int(expires_minutes), 24 * 60))
	except (TypeError, ValueError):
		expires_minutes = 30
	now = utc_now()
	RemoteAgentEnrollment.query.filter(
		RemoteAgentEnrollment.agent_id == agent.id,
		RemoteAgentEnrollment.used_at.is_(None),
		RemoteAgentEnrollment.expires_at > now,
	).update({"expires_at": now}, synchronize_session=False)
	for _ in range(5):
		code = generate_activation_code()
		row = RemoteAgentEnrollment(
			agent_id=agent.id,
			code_hash=hash_activation_code(code),
			expires_at=now + timedelta(minutes=expires_minutes),
		)
		db.session.add(row)
		try:
			db.session.commit()
			return code
		except IntegrityError:
			db.session.rollback()
	raise RuntimeError("Não foi possível gerar um código de ativação único")


def activate(code: str | None, requested_device_id: str | None = None, version: str | None = None) -> tuple[RemoteAgent, str]:
	normalized = normalize_activation_code(code)
	if len(normalized) != 12:
		raise ValueError("Código de ativação inválido")
	now = utc_now()
	enrollment = (
		RemoteAgentEnrollment.query
		.filter_by(code_hash=hash_activation_code(normalized), used_at=None)
		.with_for_update()
		.first()
	)
	if not enrollment or enrollment.expires_at <= now:
		raise ValueError("Código de ativação inválido, expirado ou já utilizado")
	agent = enrollment.agent
	if not agent or agent.is_revoked:
		raise ValueError("Agente revogado ou inexistente")

	if requested_device_id:
		try:
			device_id = str(uuid.UUID(str(requested_device_id)))
		except (ValueError, TypeError, AttributeError):
			raise ValueError("device_id deve ser um UUID válido") from None
	else:
		device_id = str(uuid.uuid4())
	duplicate = RemoteAgent.query.filter(
		RemoteAgent.device_uuid == device_id,
		RemoteAgent.id != agent.id,
	).first()
	if duplicate:
		raise ValueError("device_id já cadastrado")

	token = generate_agent_token()
	enrollment.used_at = now
	agent.device_uuid = device_id
	agent.token_hash = hash_agent_token(token)
	agent.status = "online"
	agent.last_seen = now
	agent.version = str(version or "")[:50] or agent.version
	db.session.commit()
	return agent, token


def authenticate_agent(device_id: str | None, token: str | None, *, touch: bool = False) -> RemoteAgent | None:
	device_id = str(device_id or "").strip()
	if not device_id or not token or len(str(token)) > 512:
		return None
	agent = RemoteAgent.query.filter_by(device_uuid=device_id).first()
	if not agent or agent.is_revoked or not verify_agent_token(str(token), agent.token_hash):
		return None
	if touch:
		_touch_agent(agent)
		db.session.commit()
	return agent


def _command_string(value: Any, field: str, *, allow_empty: bool = False, maximum: int = 4096) -> str:
	if not isinstance(value, str):
		raise ValueError(f"{field} deve ser texto")
	value = value.strip()
	if "\x00" in value:
		raise ValueError(f"{field} contém caractere inválido")
	if not allow_empty and not value:
		raise ValueError(f"{field} é obrigatório")
	if len(value) > maximum:
		raise ValueError(f"{field} excede o tamanho permitido")
	return value


def sanitize_windows_path(value: Any, field: str = "path", *, allow_empty: bool = False) -> str:
	path = _command_string(value, field, allow_empty=allow_empty)
	if not path and allow_empty:
		return ""
	normalized_slashes = path.replace("/", "\\")
	lowered = normalized_slashes.lower()
	if lowered.startswith("\\\\.\\") or lowered.startswith("\\\\?\\"):
		raise ValueError(f"{field} não permite caminhos de dispositivo")
	if normalized_slashes.startswith("\\\\"):
		raise ValueError(f"{field} não permite caminhos UNC")
	drive, tail = ntpath.splitdrive(normalized_slashes)
	is_drive_absolute = bool(drive) and tail.startswith("\\")
	if not is_drive_absolute:
		raise ValueError(f"{field} deve ser um caminho absoluto do Windows")
	return ntpath.normpath(normalized_slashes)


def sanitize_command_payload(command_type: str, payload: Any) -> dict:
	command_type = str(command_type or "").strip().lower()
	if command_type not in ALLOWED_COMMAND_TYPES:
		raise ValueError("Tipo de comando remoto não permitido")
	if payload is None:
		payload = {}
	if not isinstance(payload, dict):
		raise ValueError("payload deve ser um objeto JSON")
	if command_type in {"reboot", "shutdown"}:
		return {}
	if command_type == "list_directory":
		return {"path": sanitize_windows_path(payload.get("path", ""), allow_empty=True)}
	if command_type in {"mkdir", "delete"}:
		return {"path": sanitize_windows_path(payload.get("path"))}
	if command_type in {"rename", "move", "copy"}:
		return {
			"source_path": sanitize_windows_path(payload.get("source_path"), "source_path"),
			"destination_path": sanitize_windows_path(payload.get("destination_path"), "destination_path"),
		}
	if command_type in {"upload_file", "download_file"}:
		try:
			transfer_uuid = str(uuid.UUID(str(payload.get("transfer_uuid") or "")))
		except (ValueError, TypeError, AttributeError):
			raise ValueError("transfer_uuid inválido") from None
		return {
			"remote_path": sanitize_windows_path(payload.get("remote_path"), "remote_path"),
			"transfer_uuid": transfer_uuid,
		}
	raise ValueError("Tipo de comando remoto não permitido")


def enqueue_command(
	agent: RemoteAgent,
	command_type: str,
	payload: Any,
	requested_by_id: int,
	*,
	audit_ip: str | None = None,
	audit_user_agent: str | None = None,
	push_immediately: bool = True,
) -> RemoteAgentCommand:
	if not agent or not agent.id:
		raise ValueError("Agente inexistente")
	if agent.is_revoked:
		raise ValueError("Não é permitido enviar comandos para agente revogado")
	pending_count = RemoteAgentCommand.query.filter(
		RemoteAgentCommand.agent_id == agent.id,
		RemoteAgentCommand.status.in_(("pending", "running")),
	).count()
	if pending_count >= MAX_PENDING_COMMANDS:
		raise ValueError("Limite da fila pendente deste agente atingido")
	clean_payload = sanitize_command_payload(command_type, payload)
	command = RemoteAgentCommand(
		agent_id=agent.id,
		command_type=str(command_type).strip().lower(),
		payload=clean_payload,
		status="pending",
		requested_by_id=int(requested_by_id),
		audit_ip=str(audit_ip or "")[:64] or None,
		audit_user_agent=str(audit_user_agent or "")[:500] or None,
	)
	db.session.add(command)
	db.session.commit()
	if push_immediately:
		push_command(command)
	return command


def push_command(command: RemoteAgentCommand, sid: str | None = None) -> int:
	"""Envia apenas aos SIDs autenticados do agente, nunca em broadcast."""
	from . import socketio
	targets = [str(sid)] if sid else sids_for_agent(command.agent_id)
	for target_sid in targets:
		try:
			socketio.emit(
				"remote_command",
				command.to_agent_event(),
				namespace="/remote-monitor",
				room=target_sid,
			)
		except Exception:
			current_app.logger.exception(
				"Falha ao enviar comando %s ao SID autenticado do agente %s",
				command.id,
				command.agent_id,
			)
	return len(targets)


def push_pending_commands(agent_id: int, sid: str) -> int:
	rows = (
		RemoteAgentCommand.query
		.filter_by(agent_id=int(agent_id), status="pending")
		.order_by(RemoteAgentCommand.id.asc())
		.limit(MAX_PENDING_COMMANDS)
		.all()
	)
	for command in rows:
		push_command(command, sid)
	return len(rows)


def command_for_agent(command_id: int, agent_id: int) -> RemoteAgentCommand | None:
	return RemoteAgentCommand.query.filter_by(id=int(command_id), agent_id=int(agent_id)).first()


def mark_command_running(command_id: int, agent_id: int) -> RemoteAgentCommand:
	command = command_for_agent(command_id, agent_id)
	if not command:
		raise ValueError("Comando não encontrado para este agente")
	if command.status == "running":
		return command
	if command.status != "pending":
		raise ValueError(f"Comando já está em estado terminal: {command.status}")
	command.status = "running"
	command.started_at = utc_now()
	command.updated_at = command.started_at
	db.session.commit()
	return command


def mark_command_result(
	command_id: int,
	agent_id: int,
	*,
	status: str,
	result: Any = None,
	error: str | None = None,
) -> RemoteAgentCommand:
	command = command_for_agent(command_id, agent_id)
	if not command:
		raise ValueError("Comando não encontrado para este agente")
	status = str(status or "").strip().lower()
	if status not in {"done", "error", "cancelled"}:
		raise ValueError("Status final inválido")
	clean_result = _safe_json_object(result, "result") if result is not None else {}
	clean_error = _command_string(error, "error", allow_empty=True, maximum=4000) if error is not None else None
	if command.status in {"done", "error", "cancelled"}:
		if command.status == status and (command.result or {}) == clean_result and (command.error or None) == clean_error:
			return command
		raise ValueError(f"Comando já finalizado como {command.status}")
	if command.status not in {"pending", "running"}:
		raise ValueError("Transição de comando inválida")
	if command.command_type == "download_file" and status == "done":
		transfer_uuid = str(clean_result.get("transfer_uuid") or "")
		expected_uuid = str((command.payload or {}).get("transfer_uuid") or "")
		transfer = RemoteFileTransfer.query.filter_by(
			public_uuid=transfer_uuid,
			agent_id=agent_id,
			command_id=command.id,
			direction="download",
			status="ready",
		).first()
		if transfer_uuid != expected_uuid or not transfer:
			raise ValueError("Resultado download_file deve referenciar a transferência pronta")
	command.status = status
	command.result = clean_result
	command.error = clean_error
	command.finished_at = utc_now()
	command.updated_at = command.finished_at
	if command.started_at is None:
		command.started_at = command.finished_at
	if status in {"error", "cancelled"}:
		for transfer in command.transfers:
			if transfer.status not in {"expired"}:
				transfer.status = "error"
				transfer.updated_at = command.finished_at
	db.session.commit()
	return command


def transfer_directory() -> Path:
	root = Path(current_app.instance_path) / "remote_monitor_transfers"
	root.mkdir(parents=True, exist_ok=True)
	return root.resolve()


def transfer_file_path(transfer: RemoteFileTransfer) -> Path:
	if not transfer or not transfer.stored_filename:
		raise ValueError("Transferência inválida")
	try:
		safe_name = str(uuid.UUID(transfer.stored_filename))
	except (ValueError, TypeError, AttributeError):
		raise ValueError("Nome interno de transferência inválido") from None
	root = transfer_directory()
	path = (root / safe_name).resolve()
	if path.parent != root:
		raise ValueError("Caminho interno de transferência inválido")
	return path


def create_file_transfer(
	agent: RemoteAgent,
	direction: str,
	remote_path: Any,
	original_filename: Any,
	*,
	status: str = "pending",
) -> RemoteFileTransfer:
	if not agent or not agent.id or agent.is_revoked:
		raise ValueError("Agente inválido ou revogado")
	direction = str(direction or "").strip().lower()
	if direction not in {"upload", "download"}:
		raise ValueError("Direção de transferência inválida")
	path = sanitize_windows_path(remote_path, "remote_path")
	filename = _command_string(original_filename, "original_filename", maximum=255)
	filename = ntpath.basename(filename.replace("/", "\\"))
	if not filename or filename in {".", ".."}:
		raise ValueError("Nome de arquivo inválido")
	internal_uuid = str(uuid.uuid4())
	row = RemoteFileTransfer(
		public_uuid=str(uuid.uuid4()),
		agent_id=agent.id,
		direction=direction,
		remote_path=path,
		original_filename=filename,
		stored_filename=internal_uuid,
		size=0,
		status=status,
		expires_at=utc_now() + timedelta(hours=TRANSFER_TTL_HOURS),
	)
	db.session.add(row)
	db.session.commit()
	return row


def save_transfer_stream(transfer: RemoteFileTransfer, stream, *, expected_direction: str) -> RemoteFileTransfer:
	if transfer.direction != expected_direction:
		raise ValueError("Direção da transferência não permite envio de conteúdo")
	if transfer.expires_at <= utc_now():
		raise ValueError("Transferência expirada")
	final_path = transfer_file_path(transfer)
	part_path = final_path.with_name(f"{final_path.name}.part")
	size = 0
	try:
		with part_path.open("wb") as output:
			while True:
				chunk = stream.read(1024 * 1024)
				if not chunk:
					break
				size += len(chunk)
				if size > MAX_FILE_BYTES:
					raise ValueError("Arquivo excede o limite de 50 MiB")
				output.write(chunk)
		if size <= 0:
			raise ValueError("Arquivo vazio")
		part_path.replace(final_path)
	except Exception:
		try:
			part_path.unlink(missing_ok=True)
		except OSError:
			pass
		raise
	transfer.size = size
	transfer.status = "ready"
	transfer.completed_at = utc_now()
	transfer.updated_at = transfer.completed_at
	db.session.commit()
	return transfer


def transfer_for_agent(public_uuid: str, agent_id: int) -> RemoteFileTransfer | None:
	try:
		public_uuid = str(uuid.UUID(str(public_uuid)))
	except (ValueError, TypeError, AttributeError):
		return None
	return RemoteFileTransfer.query.filter_by(public_uuid=public_uuid, agent_id=int(agent_id)).first()


def purge_expired_transfers() -> int:
	rows = RemoteFileTransfer.query.filter(RemoteFileTransfer.expires_at <= utc_now()).all()
	for transfer in rows:
		try:
			transfer_file_path(transfer).unlink(missing_ok=True)
		except (OSError, ValueError):
			current_app.logger.warning("Falha ao remover arquivo expirado da transferência %s", transfer.public_uuid)
		db.session.delete(transfer)
	db.session.commit()
	# Remove apenas sobras UUID/.part antigas contidas no diretório dedicado.
	cutoff = datetime.now().timestamp() - TRANSFER_TTL_HOURS * 60 * 60
	for path in transfer_directory().iterdir():
		if not path.is_file() or (path.suffix != ".part" and not _is_uuid_filename(path.name)):
			continue
		try:
			if path.stat().st_mtime <= cutoff:
				path.unlink()
		except OSError:
			current_app.logger.warning("Falha ao remover staging órfão: %s", path.name)
	return len(rows)


def _is_uuid_filename(value: str) -> bool:
	try:
		return str(uuid.UUID(value)) == value
	except (ValueError, TypeError, AttributeError):
		return False


def _safe_json_object(value: Any, field: str) -> dict:
	if value is None:
		return {}
	if not isinstance(value, dict):
		raise ValueError(f"{field} deve ser um objeto JSON")
	try:
		encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
	except (TypeError, ValueError):
		raise ValueError(f"{field} contém valores JSON inválidos") from None
	if len(encoded.encode("utf-8")) > MAX_TELEMETRY_BYTES:
		raise ValueError(f"{field} excede o tamanho permitido")
	return value


def _number(metrics: dict, *names: str) -> float | None:
	for name in names:
		value = metrics.get(name)
		if isinstance(value, bool) or value is None:
			continue
		try:
			number = float(value)
		except (TypeError, ValueError):
			continue
		if number == number and -1000 <= number <= 10000:
			return round(number, 3)
	return None


def _main_metrics(metrics: dict) -> dict[str, float | None]:
	disk = metrics.get("disk")
	if isinstance(disk, dict):
		disk_value = max(
			(_number(item, "percent", "usage_percent") for item in disk.values() if isinstance(item, dict)),
			default=None,
			key=lambda value: value if value is not None else -1,
		)
	else:
		volumes = metrics.get("volumes")
		disk_value = max(
			(_number(item, "percent", "usage_percent") for item in volumes or [] if isinstance(item, dict)),
			default=None,
			key=lambda value: value if value is not None else -1,
		)
	memory = metrics.get("memory") if isinstance(metrics.get("memory"), dict) else {}
	temperatures = metrics.get("temperatures")
	temperature_value = max(
		(_number(item, "celsius", "current") for item in temperatures or [] if isinstance(item, dict)),
		default=None,
		key=lambda value: value if value is not None else -1,
	)
	return {
		"cpu": _number(metrics, "cpu", "cpu_percent", "cpu_usage"),
		"ram": _number(metrics, "ram", "ram_percent", "memory_percent", "memory_usage")
		or _number(memory, "percent", "usage_percent"),
		"disk": _number(metrics, "disk_percent", "disk_usage") if disk_value is None else disk_value,
		"temperature": _number(metrics, "temperature", "temperature_c", "cpu_temperature")
		if temperature_value is None else temperature_value,
	}


def _transition_alert(agent: RemoteAgent, alert_type: str, active: bool, message: str, severity: str, now) -> None:
	alert = RemoteAgentAlert.query.filter_by(
		agent_id=agent.id, alert_type=alert_type, resolved_at=None,
	).order_by(RemoteAgentAlert.opened_at.desc()).first()
	if active:
		if alert:
			alert.message = message
			alert.severity = severity
			alert.updated_at = now
		else:
			db.session.add(RemoteAgentAlert(
				agent_id=agent.id,
				alert_type=alert_type,
				severity=severity,
				message=message[:500],
				opened_at=now,
			))
	elif alert:
		alert.resolved_at = now
		alert.updated_at = now


def evaluate_metric_alerts(agent: RemoteAgent, metrics: dict, now=None) -> None:
	now = now or utc_now()
	values = _main_metrics(metrics)
	thresholds = sanitize_thresholds(agent.thresholds or {})
	labels = {"cpu": "CPU", "ram": "RAM", "disk": "Disco", "temperature": "Temperatura"}
	units = {"cpu": "%", "ram": "%", "disk": "%", "temperature": "°C"}
	for kind, threshold in thresholds.items():
		value = values.get(kind)
		if value is None:
			continue
		active = value >= threshold
		severity = "critical" if value >= threshold * 1.1 else "warning"
		message = f"{labels[kind]} em {value:.1f}{units[kind]} (limite {threshold:.1f}{units[kind]})"
		_transition_alert(agent, kind, active, message, severity, now)


def _touch_agent(agent: RemoteAgent, version: str | None = None) -> None:
	now = utc_now()
	agent.last_seen = now
	agent.status = "online"
	if version:
		agent.version = str(version)[:50]
	_transition_alert(agent, "offline", False, "", "critical", now)


def heartbeat(agent: RemoteAgent, payload: dict | None = None) -> dict:
	payload = payload if isinstance(payload, dict) else {}
	_touch_agent(agent, payload.get("version"))
	db.session.commit()
	result = agent.to_dict()
	_broadcast_update(result)
	return result


def ingest_telemetry(agent: RemoteAgent, payload: Any) -> dict:
	if not isinstance(payload, dict):
		raise ValueError("Payload de telemetria deve ser um objeto JSON")
	try:
		encoded_payload = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
	except (TypeError, ValueError):
		raise ValueError("Payload contém valores JSON inválidos") from None
	if len(encoded_payload.encode("utf-8")) > MAX_TELEMETRY_BYTES:
		raise ValueError("Payload excede o tamanho permitido")
	metrics = _safe_json_object(payload.get("metrics"), "metrics")
	inventory = _safe_json_object(payload.get("inventory"), "inventory")
	updates = _safe_json_object(payload.get("updates"), "updates")
	now = utc_now()
	_touch_agent(agent, payload.get("version"))

	snapshot = RemoteAgentSnapshot.query.filter_by(agent_id=agent.id).first()
	if not snapshot:
		snapshot = RemoteAgentSnapshot(agent_id=agent.id)
		db.session.add(snapshot)
	snapshot.metrics = metrics
	snapshot.inventory = inventory
	snapshot.updates = updates
	snapshot.updated_at = now

	minute = now.replace(second=0, microsecond=0)
	sample = RemoteAgentSample.query.filter_by(agent_id=agent.id, minute_at=minute).first()
	values = _main_metrics(metrics)
	if not sample:
		sample = RemoteAgentSample(agent_id=agent.id, minute_at=minute)
		db.session.add(sample)
	sample.cpu_percent = values["cpu"]
	sample.ram_percent = values["ram"]
	sample.disk_percent = values["disk"]
	sample.temperature_c = values["temperature"]
	evaluate_metric_alerts(agent, metrics, now)
	db.session.commit()
	result = agent.to_dict(include_snapshot=True)
	_broadcast_update(result)
	return result


def heal_connected_agents() -> int:
	"""Se o socket ainda está aberto, força status online mesmo com last_seen atrasado."""
	ids = connected_agent_ids()
	if not ids:
		return 0
	now = utc_now()
	refresh_before = now - timedelta(seconds=max(15, OFFLINE_AFTER_SECONDS // 3))
	agents = (
		RemoteAgent.query
		.filter(RemoteAgent.id.in_(ids), RemoteAgent.is_revoked.is_(False))
		.all()
	)
	healed: list[RemoteAgent] = []
	dirty = False
	for agent in agents:
		needs_status = agent.status != "online"
		stale = agent.last_seen is None or agent.last_seen < refresh_before
		if not needs_status and not stale:
			continue
		_touch_agent(agent)
		dirty = True
		if needs_status:
			healed.append(agent)
	if dirty:
		db.session.commit()
		for agent in healed:
			_broadcast_update(agent.to_dict())
	return len(healed)


def mark_offline_agents() -> int:
	heal_connected_agents()
	now = utc_now()
	cutoff = now - timedelta(seconds=OFFLINE_AFTER_SECONDS)
	query = RemoteAgent.query.filter(
		RemoteAgent.is_revoked.is_(False),
		RemoteAgent.last_seen.isnot(None),
		RemoteAgent.last_seen < cutoff,
		RemoteAgent.status != "offline",
	)
	agents = query.all()
	for agent in agents:
		agent.status = "offline"
		_transition_alert(
			agent, "offline", True,
			f"Agente sem comunicação há mais de {OFFLINE_AFTER_SECONDS} segundos",
			"critical", now,
		)
	db.session.commit()
	for agent in agents:
		_broadcast_update(agent.to_dict())
	return len(agents)


def purge_old_samples(days: int = RETENTION_DAYS) -> int:
	cutoff = utc_now() - timedelta(days=max(1, int(days)))
	count = RemoteAgentSample.query.filter(RemoteAgentSample.minute_at < cutoff).delete(synchronize_session=False)
	db.session.commit()
	return int(count or 0)


def revoke_agent(agent: RemoteAgent) -> None:
	now = utc_now()
	agent.is_revoked = True
	agent.revoked_at = now
	agent.status = "revoked"
	agent.token_hash = None
	RemoteAgentEnrollment.query.filter(
		RemoteAgentEnrollment.agent_id == agent.id,
		RemoteAgentEnrollment.used_at.is_(None),
	).update({"expires_at": now}, synchronize_session=False)
	db.session.commit()
	_broadcast_update(agent.to_dict())


def _broadcast_update(payload: dict) -> None:
	try:
		from . import socketio
		socketio.emit("telemetry_update", payload, namespace="/remote-monitor-view", room="remote-monitor")
		agent_id = payload.get("id")
		if agent_id:
			socketio.emit("telemetry_update", payload, namespace="/remote-monitor-view", room=f"agent:{agent_id}")
	except Exception:
		current_app.logger.exception("Falha ao transmitir atualização de monitoramento")


def broadcast_live_telemetry(agent: RemoteAgent, payload: Any) -> bool:
	"""Retransmite no máximo um tick por segundo; renova presença periodicamente."""
	if not isinstance(payload, dict):
		raise ValueError("Payload ao vivo deve ser um objeto JSON")
	metrics = _safe_json_object(payload.get("metrics"), "metrics")
	now = time.monotonic()
	should_touch = False
	with _live_lock:
		last = _last_live_by_agent.get(agent.id, 0.0)
		if now - last < 0.8:
			return False
		_last_live_by_agent[agent.id] = now
		last_touch = _last_touch_by_agent.get(agent.id, 0.0)
		if now - last_touch >= LIVE_TOUCH_SECONDS or agent.status != "online":
			_last_touch_by_agent[agent.id] = now
			should_touch = True
	if should_touch:
		was_offline = agent.status != "online"
		_touch_agent(agent, payload.get("version"))
		db.session.commit()
		if was_offline:
			_broadcast_update(agent.to_dict())
	message = {
		"id": agent.id,
		"device_id": agent.device_uuid,
		"metrics": metrics,
		"version": str(payload.get("version") or agent.version or "")[:50],
		"status": agent.status,
		"last_seen": utc_iso(agent.last_seen),
	}
	from . import socketio
	socketio.emit("live_telemetry", message, namespace="/remote-monitor-view", room="remote-monitor")
	socketio.emit("live_telemetry", message, namespace="/remote-monitor-view", room=f"agent:{agent.id}")
	return True


_maintenance_lock = threading.Lock()
_maintenance_started = False


def start_remote_monitor_maintenance(app) -> bool:
	"""Inicia uma única thread usando o app já criado, nunca chama create_app."""
	global _maintenance_started
	if app.testing or app.config.get("REMOTE_MONITOR_DISABLE_MAINTENANCE"):
		return False
	if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
		return False
	with _maintenance_lock:
		if _maintenance_started:
			return False
		_maintenance_started = True

	def run():
		last_retention = 0.0
		while True:
			try:
				with app.app_context():
					mark_offline_agents()
					if time.monotonic() - last_retention >= 24 * 60 * 60:
						purge_old_samples()
						purge_expired_transfers()
						last_retention = time.monotonic()
			except Exception:
				app.logger.exception("Falha na manutenção do monitoramento remoto")
				with app.app_context():
					db.session.rollback()
			time.sleep(15)

	thread = threading.Thread(target=run, daemon=True, name="RemoteMonitorMaintenance")
	thread.start()
	app.extensions["remote_monitor_maintenance"] = thread
	return True
