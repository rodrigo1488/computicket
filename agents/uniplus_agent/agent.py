"""Cliente Socket.IO do agente Uniplus — conecta ao Computicket namespace /uniplus."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import db as local_db
from unico_handler import (
	UniplusOperationalError,
	UniplusPermanentError,
	handle as handle_job,
)

try:
	import socketio
except ImportError:
	socketio = None

logger = logging.getLogger("uniplus_agent")

_should_stop = False
_generation = 0
_wake = threading.Event()
_thread: threading.Thread | None = None
_sio = None
_sio_lock = threading.Lock()
_job_lock = threading.Lock()
_inflight: set[int] = set()
_last_ack: dict[int, dict] = {}
# connected=True só após evento "ready" (auth OK no servidor)
_state = {
	"connected": False,
	"socket_open": False,
	"authenticated": False,
	"last_error": "",
	"last_event": "",
}

# No site público, /socket.io é o engine do WhatsApp. O Flask fica em /flask-sio.
_PROXIED_SOCKET_PATHS = {"flask-sio", "flask/socket.io"}
_WEB_PORTS = {80, 443, 3000, 3001}

READY_TIMEOUT_SEC = 12.0


def get_state() -> dict[str, Any]:
	return dict(_state)


def _log(level: str, msg: str):
	ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
	print(f"{ts} [{level}] {msg}")
	logger.log(getattr(logging, level, logging.INFO), msg)


def _normalize_server_url(value: str) -> str:
	"""Aceita http(s), ws(s) e host:porta sem esquema."""
	raw = (value or "").strip()
	if not raw:
		return "http://127.0.0.1:5000"
	lower = raw.lower()
	if lower.startswith("ws://"):
		raw = "http://" + raw[5:]
	elif lower.startswith("wss://"):
		raw = "https://" + raw[6:]
	elif "://" not in raw:
		raw = "http://" + raw
	parsed = urlparse(raw)
	if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
		raise ValueError("URL do Computicket inválida (use http://host:5000 ou https://seu-dominio)")
	host = parsed.hostname
	if ":" in host and not host.startswith("["):
		host = f"[{host}]"
	netloc = host if parsed.port is None else f"{host}:{parsed.port}"
	path = (parsed.path or "").rstrip("/")
	return urlunparse((parsed.scheme, netloc, path, "", "", ""))


def resolve_socket_target(raw: str) -> tuple[str, str, bool]:
	"""Origem HTTP, path do Engine.IO e se o transporte fica só em polling.

	API direta (porta 5000) usa /socket.io e pode subir para websocket.
	O site (443/80/3000) só alcança o Flask em /flask-sio, e o proxy do Next
	não completa upgrade de websocket — por isso o polling fica fixo.
	Um path explícito na URL (/socket.io, /flask-sio, /flask/socket.io) vence.
	"""
	normalized = _normalize_server_url(raw)
	parsed = urlparse(normalized)
	path = (parsed.path or "").strip("/")
	origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
	if path in {"socket.io", "flask-sio", "flask/socket.io"}:
		socketio_path = path
	elif parsed.port == 5000 or (parsed.port not in _WEB_PORTS and parsed.port is not None):
		socketio_path = "socket.io"
	else:
		socketio_path = "flask-sio"
	polling_only = socketio_path in _PROXIED_SOCKET_PATHS
	return origin, socketio_path, polling_only


def _http_base(ws_or_http: str) -> str:
	"""Normaliza URL para a origem HTTP do Computicket."""
	return resolve_socket_target(ws_or_http)[0]


def _mark_disconnected(*, error: str = "", event: str = "disconnected"):
	_state["connected"] = False
	_state["socket_open"] = False
	_state["authenticated"] = False
	_state["last_event"] = event
	if error:
		_state["last_error"] = error


def _emit(sio, event: str, data: dict | None = None):
	"""python-socketio Client não é thread-safe; ACK e ping compartilham o socket."""
	with _sio_lock:
		sio.emit(event, data or {}, namespace="/uniplus")


def _send_ack(sio, job_id: int, status: str, message: str = "", *, permanent: bool = False, result: dict | None = None):
	payload = {
		"event": "ack",
		"job_id": job_id,
		"status": status,
		"message": message,
		"permanent": permanent,
	}
	if result is not None:
		payload["result"] = result
	try:
		_emit(sio, "ack", payload)
		with _job_lock:
			_last_ack[job_id] = payload
	finally:
		with _job_lock:
			_inflight.discard(job_id)


def _process_job(sio, data: dict):
	job_id = data.get("job_id")
	job_type = data.get("job_type") or ""
	payload = data.get("payload") or {}
	try:
		job_id = int(job_id)
	except (TypeError, ValueError):
		_log("ERROR", f"job_id inválido: {job_id}")
		return

	with _job_lock:
		if job_id in _inflight:
			_log("INFO", f"Job {job_id} já em execução — ignorando duplicata")
			return
		previous = _last_ack.get(job_id)
		if previous and (previous.get("status") == "done" or previous.get("permanent")):
			_inflight.add(job_id)
			replay = True
		else:
			_inflight.add(job_id)
			replay = False
	if replay and previous:
		_log("INFO", f"Job {job_id} já concluído — reenviando ACK")
		try:
			_emit(sio, "ack", previous)
		except Exception as e:
			_log("ERROR", f"Falha ao reenviar ACK do job {job_id}: {e}")
		finally:
			with _job_lock:
				_inflight.discard(job_id)
		return

	_log("INFO", f"Job {job_id} tipo={job_type}")
	local_db.add_log(job_id, job_type, "running", "iniciado")
	try:
		_emit(sio, "job_started", {"job_id": job_id})
	except Exception:
		pass

	try:
		result = handle_job(job_type, payload)
		_send_ack(sio, job_id, "done", "ok", result=result)
		local_db.add_log(job_id, job_type, "done", "ok")
		_log("INFO", f"Job {job_id} done")
	except UniplusPermanentError as e:
		_send_ack(sio, job_id, "error", str(e), permanent=True)
		local_db.add_log(job_id, job_type, "error", str(e))
		_log("ERROR", f"Job {job_id} permanente: {e}")
	except UniplusOperationalError as e:
		_send_ack(sio, job_id, "error", str(e), permanent=False)
		local_db.add_log(job_id, job_type, "error", str(e))
		_log("ERROR", f"Job {job_id} operacional: {e}")
	except Exception as e:
		_send_ack(sio, job_id, "error", str(e), permanent=False)
		local_db.add_log(job_id, job_type, "error", str(e))
		_log("ERROR", f"Job {job_id} falhou: {e}")


def _wait(gen: int, seconds: float) -> bool:
	"""Espera interrompível. False quando esta geração do loop foi encerrada."""
	deadline = time.monotonic() + max(0.0, seconds)
	while gen == _generation and not _should_stop:
		remaining = deadline - time.monotonic()
		if remaining <= 0:
			return True
		_wake.wait(min(0.5, remaining))
	return False


def _run_loop(gen: int):
	global _sio
	if socketio is None:
		_state["last_error"] = "python-socketio não instalado"
		_log("ERROR", _state["last_error"])
		return

	backoff = 1.0
	while gen == _generation and not _should_stop:
		cfg = local_db.get_all_config()
		if (cfg.get("agent_enabled") or "true").lower() not in {"1", "true", "yes", "on"}:
			_mark_disconnected(event="disabled")
			if not _wait(gen, 2):
				break
			continue

		device_id = (cfg.get("device_id") or "").strip()
		token = (cfg.get("token") or "").strip()
		try:
			base, socketio_path, polling_only = resolve_socket_target(cfg.get("ws_url") or "")
		except ValueError as e:
			_mark_disconnected(error=str(e), event="misconfigured")
			if not _wait(gen, 3):
				break
			continue
		if not device_id or not token:
			_mark_disconnected(error="Configure device_id e token na UI", event="misconfigured")
			if not _wait(gen, 3):
				break
			continue

		ready_event = threading.Event()
		auth_failed = {"msg": ""}

		sio = socketio.Client(
			reconnection=False,
			logger=False,
			engineio_logger=False,
			ssl_verify=False,
		)
		_sio = sio

		@sio.event(namespace="/uniplus")
		def connect():
			# Socket no namespace aberto — ainda NÃO autenticado até "ready"
			_state["socket_open"] = True
			_state["connected"] = False
			_state["authenticated"] = False
			_state["last_event"] = "socket_open"
			_state["last_error"] = ""
			_log("INFO", f"Socket aberto em {base} path=/{socketio_path} namespace=/uniplus device={device_id} — aguardando ready…")

		@sio.event(namespace="/uniplus")
		def connect_error(data):
			msg = data if isinstance(data, str) else (str(data) if data else "connect_error")
			auth_failed["msg"] = msg
			_mark_disconnected(error=f"Auth/conexão rejeitada: {msg}", event="auth_rejected")
			_log("ERROR", f"connect_error: {msg}")
			ready_event.set()

		@sio.event(namespace="/uniplus")
		def disconnect():
			was_auth = _state.get("authenticated")
			_mark_disconnected(event="disconnected")
			if was_auth:
				_log("WARN", "Desconectado do Computicket")
			ready_event.set()

		@sio.on("ready", namespace="/uniplus")
		def on_ready(data):
			_state["authenticated"] = True
			_state["connected"] = True
			_state["socket_open"] = True
			_state["last_error"] = ""
			_state["last_event"] = "ready"
			_log("INFO", f"Autenticado (ready): {data}")
			ready_event.set()

		@sio.on("uniplus_job", namespace="/uniplus")
		def on_job(data):
			data = data or {}
			_state["last_event"] = f"job:{data.get('job_id')}"
			threading.Thread(target=_process_job, args=(sio, data), daemon=True).start()

		@sio.on("pong_agent", namespace="/uniplus")
		def on_pong(_data):
			_state["last_event"] = "pong"

		try:
			# Query string + auth + headers: cobre websocket (headers fracos) e versões antigas
			qs = urlencode({"device_id": device_id, "token": token})
			url = f"{base}?{qs}"
			transports = ["polling"] if polling_only else ["polling", "websocket"]
			_log("INFO", f"Conectando em {base} path=/{socketio_path} namespace=/uniplus transports={transports}")
			sio.connect(
				url,
				namespaces=["/uniplus"],
				auth={"device_id": device_id, "token": token},
				headers={
					"Authorization": f"Bearer {token}",
					"X-Device-Id": device_id,
				},
				socketio_path=socketio_path,
				# polling primeiro: headers HTTP confiáveis no handshake.
				# Pelo site público o proxy não faz upgrade de websocket.
				transports=transports,
				wait_timeout=15,
			)
			if gen != _generation or _should_stop:
				continue

			# O ready emitido dentro do connect do servidor pode se perder.
			# hello pede de novo e drena a fila com o cliente já escutando.
			try:
				_emit(sio, "hello", {"device_id": device_id})
			except Exception:
				pass

			# Exige "ready" do servidor — connect sem ready = auth falhou / servidor antigo
			if not ready_event.wait(timeout=READY_TIMEOUT_SEC):
				msg = "Timeout aguardando ready (auth/token ou servidor sem handler /uniplus)"
				_mark_disconnected(error=msg, event="ready_timeout")
				_log("ERROR", msg)
				try:
					sio.disconnect()
				except Exception:
					pass
				if not _wait(gen, backoff):
					break
				backoff = min(60.0, backoff * 2)
				continue

			if not _state.get("authenticated"):
				msg = auth_failed["msg"] or _state.get("last_error") or "Autenticação rejeitada pelo Computicket"
				_mark_disconnected(error=msg, event="auth_rejected")
				_log("ERROR", msg)
				try:
					if sio.connected:
						sio.disconnect()
				except Exception:
					pass
				# Token errado: backoff maior para não martelar
				if not _wait(gen, max(backoff, 15.0)):
					break
				backoff = min(60.0, backoff * 2)
				continue

			backoff = 1.0
			while gen == _generation and not _should_stop and sio.connected and _state.get("authenticated"):
				try:
					_emit(sio, "ping_agent", {})
				except Exception:
					pass
				if not _wait(gen, 25):
					break
		except Exception as e:
			_mark_disconnected(error=str(e), event="connect_failed")
			_log("ERROR", f"Falha conexão: {e}")
			if not _wait(gen, backoff):
				break
			backoff = min(60.0, backoff * 2)
		finally:
			try:
				if sio.connected:
					sio.disconnect()
			except Exception:
				pass
			if _sio is sio:
				_sio = None
			if gen == _generation and (_state.get("connected") or _state.get("socket_open")):
				_mark_disconnected(event=_state.get("last_event") or "disconnected")


def start_agent_thread():
	global _thread, _should_stop, _generation
	if _thread and _thread.is_alive() and not _should_stop:
		return
	_should_stop = False
	_wake.clear()
	_generation += 1
	gen = _generation
	_thread = threading.Thread(target=_run_loop, args=(gen,), name="uniplus-agent-ws", daemon=True)
	_thread.start()
	_log("INFO", "Thread do agente iniciada")


def stop_agent_thread():
	global _should_stop, _generation
	_should_stop = True
	_generation += 1
	_wake.set()
	try:
		if _sio and getattr(_sio, "connected", False):
			_sio.disconnect()
	except Exception:
		pass


def restart_agent_thread():
	old = _thread
	stop_agent_thread()
	if old and old.is_alive():
		old.join(timeout=30)
	start_agent_thread()
