"""Fila de jobs Uniplus: enqueue, wait e push para o agente via Socket.IO."""
from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

from flask import current_app
from flask_login import current_user

from . import db, socketio
from .models import SystemConfig, UniplusJob
from .timezone_utils import get_brasilia_now

UNIPLUS_NS = "/uniplus"
AGENTS_ROOM = "uniplus_agents"

CFG_ENABLED = "uniplus_agent_enabled"
CFG_DEVICE_ID = "uniplus_agent_device_id"
CFG_TOKEN = "uniplus_agent_token"
CFG_CATEGORY = "uniplus"

# Postgres Unico (leituras da API + escritas legado) — só SystemConfig, sem .env
CFG_PG_HOST = "uniplus_pg_host"
CFG_PG_PORT = "uniplus_pg_port"
CFG_PG_DATABASE = "uniplus_pg_database"
CFG_PG_USER = "uniplus_pg_user"
CFG_PG_PASSWORD = "uniplus_pg_password"
CFG_PG_CONNECT_TIMEOUT = "uniplus_pg_connect_timeout"

# sids autenticados no namespace /uniplus (só após validate_agent_auth OK)
_connected_sids: set[str] = set()
_sid_devices: dict[str, str] = {}


def _cfg(key: str, env_key: str, default: str = "") -> str:
	"""SystemConfig primeiro; senão env; senão default."""
	try:
		v = SystemConfig.get(key)
		if v is not None and str(v).strip() != "":
			return str(v).strip()
	except Exception:
		pass
	return (os.environ.get(env_key) or default).strip()


def agent_enabled() -> bool:
	raw = _cfg(CFG_ENABLED, "UNIPLUS_AGENT_ENABLED", "0").lower()
	return raw in {"1", "true", "yes", "on"}


def expected_device_id() -> str:
	return _cfg(CFG_DEVICE_ID, "UNIPLUS_AGENT_DEVICE_ID")


def expected_token() -> str:
	return _cfg(CFG_TOKEN, "UNIPLUS_AGENT_TOKEN")


def token_matches(provided: str) -> bool:
	expected = expected_token()
	if not expected or not provided:
		return False
	# Comparação em tempo constante
	a = hashlib.sha256(provided.encode("utf-8")).digest()
	b = hashlib.sha256(expected.encode("utf-8")).digest()
	return a == b


def validate_agent_auth(device_id: str | None, token: str | None) -> tuple[bool, str]:
	exp_dev = expected_device_id()
	exp_tok = expected_token()
	if not exp_dev or not exp_tok:
		return False, "Device-Id / Token Uniplus não configurados (Configurações → Uniplus)"
	if (device_id or "").strip() != exp_dev:
		return False, "Device-Id inválido"
	if not token_matches(token or ""):
		return False, "Token inválido"
	return True, "ok"


def _cfg_system_only(key: str, default: str = "") -> str:
	"""Lê só SystemConfig (sem fallback de env) — usado para Postgres Unico."""
	try:
		v = SystemConfig.get(key)
		if v is not None and str(v).strip() != "":
			return str(v).strip()
	except Exception:
		pass
	return default


def get_unico_pg_config() -> dict[str, Any]:
	"""
	Credenciais/host do Postgres Unico para a API (leituras + legado).
	Somente SystemConfig — sem UNICO_PG_* no .env.
	"""
	port_raw = _cfg_system_only(CFG_PG_PORT, "5432")
	timeout_raw = _cfg_system_only(CFG_PG_CONNECT_TIMEOUT, "5")
	try:
		port = int(port_raw)
	except (TypeError, ValueError):
		port = 5432
	try:
		connect_timeout = int(timeout_raw)
	except (TypeError, ValueError):
		connect_timeout = 5
	return {
		"host": _cfg_system_only(CFG_PG_HOST, ""),
		"port": port,
		"database": _cfg_system_only(CFG_PG_DATABASE, "unico"),
		"user": _cfg_system_only(CFG_PG_USER, ""),
		"password": _cfg_system_only(CFG_PG_PASSWORD, ""),
		"connect_timeout": connect_timeout,
	}


def save_unico_pg_settings(
	*,
	host: str | None = None,
	port: int | str | None = None,
	database: str | None = None,
	user: str | None = None,
	password: str | None = None,
	connect_timeout: int | str | None = None,
) -> None:
	"""Persiste PG Unico em SystemConfig. password vazio/None = mantém o atual."""
	if host is not None:
		SystemConfig.set(
			CFG_PG_HOST,
			str(host).strip(),
			description="Host do Postgres Unico (leituras API / legado)",
			category=CFG_CATEGORY,
		)
	if port is not None:
		SystemConfig.set(
			CFG_PG_PORT,
			str(int(port)),
			description="Porta do Postgres Unico",
			category=CFG_CATEGORY,
		)
	if database is not None:
		SystemConfig.set(
			CFG_PG_DATABASE,
			str(database).strip() or "unico",
			description="Database do Postgres Unico",
			category=CFG_CATEGORY,
		)
	if user is not None:
		SystemConfig.set(
			CFG_PG_USER,
			str(user).strip(),
			description="Usuário do Postgres Unico",
			category=CFG_CATEGORY,
		)
	if password is not None and str(password).strip() != "":
		SystemConfig.set(
			CFG_PG_PASSWORD,
			str(password).strip(),
			description="Senha do Postgres Unico",
			category=CFG_CATEGORY,
		)
	if connect_timeout is not None:
		SystemConfig.set(
			CFG_PG_CONNECT_TIMEOUT,
			str(int(connect_timeout)),
			description="Timeout de conexão ao Postgres Unico (segundos)",
			category=CFG_CATEGORY,
		)


def get_agent_settings() -> dict[str, Any]:
	"""Snapshot para a UI (token/senha PG nunca em claro)."""
	tok = expected_token()
	pg = get_unico_pg_config()
	return {
		"enabled": agent_enabled(),
		"device_id": expected_device_id(),
		"token_configured": bool(tok),
		"connected_agents": connected_count(),
		"connected_devices": connected_device_ids(),
		"pending": UniplusJob.query.filter_by(status="pending").count(),
		"running": UniplusJob.query.filter_by(status="running").count(),
		"pg": {
			"host": pg["host"],
			"port": pg["port"],
			"database": pg["database"],
			"user": pg["user"],
			"password_configured": bool(pg["password"]),
			"connect_timeout": pg["connect_timeout"],
		},
		"source": {
			"enabled": _setting_source(CFG_ENABLED, "UNIPLUS_AGENT_ENABLED"),
			"device_id": _setting_source(CFG_DEVICE_ID, "UNIPLUS_AGENT_DEVICE_ID"),
			"token": _setting_source(CFG_TOKEN, "UNIPLUS_AGENT_TOKEN"),
		},
	}


def _setting_source(key: str, env_key: str) -> str:
	try:
		v = SystemConfig.get(key)
		if v is not None and str(v).strip() != "":
			return "system_config"
	except Exception:
		pass
	if (os.environ.get(env_key) or "").strip():
		return "env"
	return "default"


def save_agent_settings(
	*,
	enabled: bool | None = None,
	device_id: str | None = None,
	token: str | None = None,
	pg_host: str | None = None,
	pg_port: int | str | None = None,
	pg_database: str | None = None,
	pg_user: str | None = None,
	pg_password: str | None = None,
	pg_connect_timeout: int | str | None = None,
) -> dict[str, Any]:
	"""Persiste em SystemConfig. Token/senha PG vazios = mantém o atual."""
	if enabled is not None:
		SystemConfig.set(
			CFG_ENABLED,
			"1" if enabled else "0",
			description="Usar agente local para escritas no Unico (1/0)",
			category=CFG_CATEGORY,
		)
	if device_id is not None:
		SystemConfig.set(
			CFG_DEVICE_ID,
			device_id.strip(),
			description="Device-Id do agente Uniplus",
			category=CFG_CATEGORY,
		)
	if token is not None and str(token).strip() != "":
		SystemConfig.set(
			CFG_TOKEN,
			str(token).strip(),
			description="Token Bearer do agente Uniplus",
			category=CFG_CATEGORY,
		)
	if any(
		x is not None
		for x in (pg_host, pg_port, pg_database, pg_user, pg_password, pg_connect_timeout)
	):
		save_unico_pg_settings(
			host=pg_host,
			port=pg_port,
			database=pg_database,
			user=pg_user,
			password=pg_password,
			connect_timeout=pg_connect_timeout,
		)
	return get_agent_settings()


def register_sid(sid: str, device_id: str | None = None) -> None:
	_connected_sids.add(sid)
	if device_id:
		_sid_devices[sid] = device_id


def unregister_sid(sid: str) -> None:
	_connected_sids.discard(sid)
	_sid_devices.pop(sid, None)


def connected_count() -> int:
	"""Conta agentes autenticados. Prefere o set local; fallback no room do Socket.IO."""
	n = len(_connected_sids)
	if n > 0:
		return n
	try:
		participants = socketio.server.manager.get_participants(UNIPLUS_NS, AGENTS_ROOM)
		return len(list(participants))
	except Exception:
		return n


def connected_device_ids() -> list[str]:
	return sorted({d for d in _sid_devices.values() if d})


def enqueue_uniplus_job(
	job_type: str,
	payload: dict[str, Any] | None = None,
	*,
	created_by_id: int | None = None,
	push: bool = True,
) -> UniplusJob:
	uid = created_by_id
	if uid is None:
		try:
			if current_user and getattr(current_user, "is_authenticated", False):
				uid = getattr(current_user, "id", None)
		except Exception:
			uid = None

	job = UniplusJob(
		job_type=job_type,
		payload=json.dumps(payload or {}, ensure_ascii=False, default=str),
		status="pending",
		created_by_id=uid,
		created_at=get_brasilia_now(),
	)
	db.session.add(job)
	db.session.commit()

	if push:
		push_job_to_agents(job)
	return job


def push_job_to_agents(job: UniplusJob) -> None:
	"""Envia job para todos os agentes conectados no namespace /uniplus."""
	try:
		socketio.emit("uniplus_job", job.to_agent_event(), namespace=UNIPLUS_NS)
	except Exception as e:
		try:
			current_app.logger.warning("Falha ao emitir uniplus_job %s: %s", job.id, e)
		except Exception:
			print(f"Falha ao emitir uniplus_job {job.id}: {e}")


def push_pending_jobs(sid: str | None = None) -> int:
	"""Drena jobs pending/running para o agente (reenvio)."""
	jobs = (
		UniplusJob.query.filter(UniplusJob.status.in_(["pending", "running"]))
		.order_by(UniplusJob.id.asc())
		.limit(100)
		.all()
	)
	for job in jobs:
		if sid:
			socketio.emit("uniplus_job", job.to_agent_event(), to=sid, namespace=UNIPLUS_NS)
		else:
			push_job_to_agents(job)
	return len(jobs)


def apply_ack(
	job_id: int,
	status: str,
	message: str | None = None,
	*,
	permanent: bool = False,
	result: dict[str, Any] | None = None,
) -> UniplusJob | None:
	job = UniplusJob.query.get(job_id)
	if not job:
		return None
	if status not in {"done", "error"}:
		status = "error"
	job.status = status
	job.message = message
	job.permanent = bool(permanent)
	job.finished_at = get_brasilia_now()
	if result is not None:
		job.result_json = json.dumps(result, ensure_ascii=False, default=str)
	if job.started_at is None:
		job.started_at = job.finished_at
	db.session.commit()
	return job


def mark_running(job_id: int) -> None:
	job = UniplusJob.query.get(job_id)
	if not job or job.status not in {"pending", "running"}:
		return
	job.status = "running"
	job.started_at = get_brasilia_now()
	db.session.commit()


class UniplusJobError(RuntimeError):
	def __init__(self, message: str, *, permanent: bool = False, job: UniplusJob | None = None):
		super().__init__(message)
		self.permanent = permanent
		self.job = job


def wait_job(job_id: int, timeout: float = 60.0, poll: float = 0.25) -> UniplusJob:
	"""Bloqueia até done/error ou timeout. Levanta UniplusJobError em falha/timeout."""
	deadline = time.monotonic() + timeout
	while time.monotonic() < deadline:
		db.session.expire_all()
		job = UniplusJob.query.get(job_id)
		if not job:
			raise UniplusJobError(f"Job {job_id} não encontrado")
		if job.status == "done":
			return job
		if job.status == "error":
			raise UniplusJobError(
				job.message or f"Job {job_id} falhou",
				permanent=bool(job.permanent),
				job=job,
			)
		time.sleep(poll)

	job = UniplusJob.query.get(job_id)
	raise UniplusJobError(
		f"Timeout aguardando agente Uniplus (job {job_id}). Agentes conectados: {connected_count()}",
		job=job,
	)


def enqueue_and_wait(
	job_type: str,
	payload: dict[str, Any] | None = None,
	*,
	timeout: float = 60.0,
	created_by_id: int | None = None,
	on_enqueued=None,
) -> dict[str, Any]:
	"""Enfileira, espera ACK e retorna result_dict (pode ser {})."""
	if not agent_enabled():
		raise UniplusJobError("UNIPLUS_AGENT_ENABLED está desligado")
	if connected_count() == 0:
		# ainda enfileira — agente pode conectar e drenar; wait pode timeout
		pass
	job = enqueue_uniplus_job(job_type, payload, created_by_id=created_by_id)
	if on_enqueued is not None:
		on_enqueued(job)
	done = wait_job(job.id, timeout=timeout)
	return done.result_dict()
