"""Regras de segurança, telemetria e manutenção do monitoramento remoto."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import current_app
from sqlalchemy.exc import IntegrityError

from . import db
from .models import (
	RemoteAgent,
	RemoteAgentAlert,
	RemoteAgentEnrollment,
	RemoteAgentSample,
	RemoteAgentSnapshot,
)

DEFAULT_THRESHOLDS = {"cpu": 90.0, "ram": 90.0, "disk": 90.0, "temperature": 85.0}
MAX_TELEMETRY_BYTES = 512 * 1024
# Heartbeat do agente a cada ~15s; margem para falha pontual de emit/ACK.
OFFLINE_AFTER_SECONDS = 90
LIVE_TOUCH_SECONDS = 10.0
RETENTION_DAYS = 30

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
