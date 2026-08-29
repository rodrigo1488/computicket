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
_thread: threading.Thread | None = None
_sio = None
# connected=True só após evento "ready" (auth OK no servidor)
_state = {
	"connected": False,
	"socket_open": False,
	"authenticated": False,
	"last_error": "",
	"last_event": "",
}

READY_TIMEOUT_SEC = 12.0


def get_state() -> dict[str, Any]:
	return dict(_state)


def _log(level: str, msg: str):
	ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
	print(f"{ts} [{level}] {msg}")
	logger.log(getattr(logging, level, logging.INFO), msg)


def _http_base(ws_or_http: str) -> str:
	"""Normaliza URL para base HTTP do Socket.IO (ex.: http://host:5000)."""
	raw = (ws_or_http or "").strip()
	if not raw:
		return "http://127.0.0.1:5000"
	if raw.startswith("ws://"):
		raw = "http://" + raw[5:]
	elif raw.startswith("wss://"):
		raw = "https://" + raw[6:]
	# remove path /ws/uniplus se colado por engano
	parsed = urlparse(raw)
	path = parsed.path or ""
	if "/ws/" in path or path.endswith("/uniplus"):
		path = ""
	return urlunparse((parsed.scheme or "http", parsed.netloc, path.rstrip("/") or "", "", "", ""))


def _mark_disconnected(*, error: str = "", event: str = "disconnected"):
	_state["connected"] = False
	_state["socket_open"] = False
	_state["authenticated"] = False
	_state["last_event"] = event
	if error:
		_state["last_error"] = error


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
	sio.emit("ack", payload, namespace="/uniplus")


def _process_job(sio, data: dict):
	job_id = data.get("job_id")
	job_type = data.get("job_type") or ""
	payload = data.get("payload") or {}
	try:
		job_id = int(job_id)
	except (TypeError, ValueError):
		_log("ERROR", f"job_id inválido: {job_id}")
		return

	_log("INFO", f"Job {job_id} tipo={job_type}")
	local_db.add_log(job_id, job_type, "running", "iniciado")
	try:
		sio.emit("job_started", {"job_id": job_id}, namespace="/uniplus")
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


def _run_loop():
	global _sio, _should_stop
	if socketio is None:
		_state["last_error"] = "python-socketio não instalado"
		_log("ERROR", _state["last_error"])
		return

	backoff = 1.0
	while not _should_stop:
		cfg = local_db.get_all_config()
		if (cfg.get("agent_enabled") or "true").lower() not in {"1", "true", "yes", "on"}:
			_mark_disconnected(event="disabled")
			time.sleep(2)
			continue

		device_id = (cfg.get("device_id") or "").strip()
		token = (cfg.get("token") or "").strip()
		base = _http_base(cfg.get("ws_url") or "")
		if not device_id or not token:
			_mark_disconnected(error="Configure device_id e token na UI", event="misconfigured")
			time.sleep(3)
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
			_log("INFO", f"Socket aberto em {base}/uniplus device={device_id} — aguardando ready…")

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
			_state["last_event"] = f"job:{data.get('job_id')}"
			threading.Thread(target=_process_job, args=(sio, data or {}), daemon=True).start()

		@sio.on("pong_agent", namespace="/uniplus")
		def on_pong(_data):
			_state["last_event"] = "pong"

		try:
			# Query string + auth + headers: cobre websocket (headers fracos) e versões antigas
			qs = urlencode({"device_id": device_id, "token": token})
			url = f"{base}?{qs}"
			_log("INFO", f"Conectando em {base} namespace=/uniplus …")
			sio.connect(
				url,
				namespaces=["/uniplus"],
				auth={"device_id": device_id, "token": token},
				headers={
					"Authorization": f"Bearer {token}",
					"X-Device-Id": device_id,
				},
				# polling primeiro: headers HTTP confiáveis no handshake
				transports=["polling", "websocket"],
				wait_timeout=15,
			)

			# Exige "ready" do servidor — connect sem ready = auth falhou / servidor antigo
			if not ready_event.wait(timeout=READY_TIMEOUT_SEC):
				msg = "Timeout aguardando ready (auth/token ou servidor sem handler /uniplus)"
				_mark_disconnected(error=msg, event="ready_timeout")
				_log("ERROR", msg)
				try:
					sio.disconnect()
				except Exception:
					pass
				time.sleep(backoff)
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
				time.sleep(max(backoff, 15.0))
				backoff = min(60.0, backoff * 2)
				continue

			backoff = 1.0
			while not _should_stop and sio.connected and _state.get("authenticated"):
				try:
					sio.emit("ping_agent", {}, namespace="/uniplus")
				except Exception:
					pass
				time.sleep(25)
		except Exception as e:
			_mark_disconnected(error=str(e), event="connect_failed")
			_log("ERROR", f"Falha conexão: {e}")
			time.sleep(backoff)
			backoff = min(60.0, backoff * 2)
		finally:
			try:
				if sio.connected:
					sio.disconnect()
			except Exception:
				pass
			_sio = None
			if _state.get("connected") or _state.get("socket_open"):
				_mark_disconnected(event=_state.get("last_event") or "disconnected")


def start_agent_thread():
	global _thread, _should_stop
	_should_stop = False
	if _thread and _thread.is_alive():
		return
	_thread = threading.Thread(target=_run_loop, name="uniplus-agent-ws", daemon=True)
	_thread.start()
	_log("INFO", "Thread do agente iniciada")


def stop_agent_thread():
	global _should_stop, _sio
	_should_stop = True
	try:
		if _sio and getattr(_sio, "connected", False):
			_sio.disconnect()
	except Exception:
		pass


def restart_agent_thread():
	stop_agent_thread()
	time.sleep(0.5)
	start_agent_thread()
