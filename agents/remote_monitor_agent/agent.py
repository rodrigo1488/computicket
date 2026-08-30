"""Cliente Socket.IO e ciclo de coleta do Computicket Monitor Agent."""
from __future__ import annotations

import threading
import time
from typing import Any
from urllib.parse import urlparse, urlunparse

import requests
import socketio

import collector
import command_executor
import db

VERSION = "1.0.2"
NAMESPACE = "/remote-monitor"
READY_TIMEOUT_SEC = 12.0
_STOP = threading.Event()
_THREADS: list[threading.Thread] = []
_SIO: socketio.Client | None = None
_COMMAND_EXECUTOR: command_executor.CommandExecutor | None = None
_STATE_LOCK = threading.RLock()
_CACHE_LOCK = threading.RLock()
_CACHE: dict[str, Any] = {"inventory": None, "pending_updates": None}
_STATE: dict[str, Any] = {
    "connected": False,
    "socket_open": False,
    "authenticated": False,
    "last_error": "",
    "last_event": "starting",
    "last_live_at": None,
    "last_telemetry_at": None,
    "last_heartbeat_at": None,
    "version": VERSION,
}


def normalize_server_url(value: str) -> str:
    """Aceita http(s), host:porta sem esquema (assume http) e ws(s); rejeita credenciais."""
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Informe uma URL HTTP(S) válida, sem credenciais")
    lower = raw.lower()
    if lower.startswith("ws://"):
        raw = "http://" + raw[5:]
    elif lower.startswith("wss://"):
        raw = "https://" + raw[6:]
    elif "://" not in raw:
        raw = "http://" + raw
    parsed = urlparse(raw)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("Informe uma URL HTTP(S) válida, sem credenciais")
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = host if parsed.port is None else f"{host}:{parsed.port}"
    path = (parsed.path or "").rstrip("/")
    return urlunparse((parsed.scheme, netloc, path, "", "", ""))


def server_origin(value: str) -> str:
    """Origem sem path — Socket.IO e /api/* usam a raiz do servidor Flask."""
    normalized = normalize_server_url(value)
    parsed = urlparse(normalized)
    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def get_state() -> dict[str, Any]:
    with _STATE_LOCK:
        state = dict(_STATE)
    state["buffered"] = db.buffer_count()
    state["device_id"] = db.get_config("device_id")
    executor = _COMMAND_EXECUTOR
    command_stats = executor.stats() if executor else {"pending": 0, "last": None}
    state["pending_commands"] = command_stats["pending"]
    state["last_command"] = command_stats["last"]
    return state


def _set_state(**values: Any) -> None:
    with _STATE_LOCK:
        _STATE.update(values)


def _mask(message: object) -> str:
    text = str(message)
    try:
        token = db.get_token()
        return text.replace(token, "***") if token else text
    except Exception:
        return text


def _log(level: str, message: object) -> None:
    safe = _mask(message)
    db.add_log(level, safe)
    if level.upper() == "ERROR":
        _set_state(last_error=safe)


def _command_credentials() -> tuple[str, str, str]:
    token = db.get_token()
    device_id = str(db.get_config("device_id") or "")
    raw_url = (db.get_config("server_url") or "").strip()
    if not token or not device_id or not raw_url:
        raise RuntimeError("Credenciais do agente indisponíveis")
    return server_origin(raw_url), device_id, token


def _command_headers(device_id: str, token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Device-Id": device_id}


def _report_command_started(command_id: str) -> bool:
    payload = {"command_id": command_id}
    sio = _SIO
    if sio and sio.connected:
        with _STATE_LOCK:
            authenticated = bool(_STATE.get("authenticated"))
        if authenticated:
            sio.emit("command_started", payload, namespace=NAMESPACE)
    try:
        base, device_id, token = _command_credentials()
        response = requests.post(
            f"{base}/api/remote-monitor/agent/commands/{command_id}/started",
            headers=_command_headers(device_id, token),
            timeout=(5, 20),
            verify=True,
        )
        response.raise_for_status()
        return True
    except Exception as exc:
        _log("ERROR", f"Falha ao confirmar início do comando {command_id}: {exc}")
        return False


def _report_command_result(
    command_id: str, status: str, result: dict[str, Any], error: str | None
) -> bool:
    payload = {
        "command_id": command_id,
        "status": status,
        "result": result,
        "error": error,
    }
    sio = _SIO
    if sio and sio.connected:
        with _STATE_LOCK:
            authenticated = bool(_STATE.get("authenticated"))
        if authenticated:
            sio.emit("command_result", payload, namespace=NAMESPACE)
    try:
        base, device_id, token = _command_credentials()
        response = requests.post(
            f"{base}/api/remote-monitor/agent/commands/{command_id}/result",
            headers=_command_headers(device_id, token),
            json={"status": status, "result": result, "error": error},
            timeout=(5, 30),
            verify=True,
        )
        response.raise_for_status()
        _set_state(last_event=f"command_{status}")
        return True
    except Exception as exc:
        _log("ERROR", f"Falha ao enviar resultado do comando {command_id}: {exc}")
        return False


def _fetch_pending_commands() -> int:
    executor = _COMMAND_EXECUTOR
    if executor is None:
        return 0
    try:
        base, device_id, token = _command_credentials()
        response = requests.get(
            f"{base}/api/remote-monitor/agent/commands",
            headers=_command_headers(device_id, token),
            timeout=(5, 30),
            verify=True,
        )
        response.raise_for_status()
        data = response.json()
        items = data.get("items", []) if isinstance(data, dict) else []
        accepted = 0
        for item in items:
            if isinstance(item, dict) and executor.enqueue(item, confirmed_pending=True):
                accepted += 1
        if accepted:
            _log("INFO", f"{accepted} comando(s) pendente(s) recebido(s) por HTTP")
        return accepted
    except Exception as exc:
        _log("ERROR", f"Consulta de comandos pendentes falhou: {exc}")
        return 0


def enroll(server_url: str, activation_code: str) -> dict[str, Any]:
    origin = server_origin(server_url)
    code = activation_code.strip()
    if not code:
        raise ValueError("Código de ativação obrigatório")
    local_device_id = db.get_config("device_id")
    response = requests.post(
        f"{origin}/api/remote-monitor/enroll",
        json={"activation_code": code, "device_id": local_device_id, "version": VERSION},
        timeout=(5, 20),
        verify=True,
    )
    response.raise_for_status()
    data = response.json()
    token = str(data.get("token") or "")
    returned_id = str(data.get("device_id") or local_device_id)
    if not token or not returned_id:
        raise ValueError("Resposta de ativação sem token/device_id")
    db.set_many({"server_url": origin, "device_id": returned_id, "enabled": "true"})
    db.set_token(token)
    _log("INFO", f"Dispositivo ativado: {returned_id}")
    restart_agent()
    return {"device_id": returned_id}


def reconfigure(server_url: str, enabled: bool) -> None:
    db.set_many({"server_url": server_origin(server_url), "enabled": "true" if enabled else "false"})
    restart_agent()


def _http_heartbeat(base: str, device_id: str, token: str) -> bool:
    """Fallback HTTP quando o emit Socket.IO não atualiza last_seen no servidor."""
    try:
        response = requests.post(
            f"{base}/api/remote-monitor/heartbeat",
            headers={"Authorization": f"Bearer {token}", "X-Device-Id": device_id},
            json={"device_id": device_id, "version": VERSION},
            timeout=(3, 10),
            verify=True,
        )
        if response.ok:
            _set_state(last_heartbeat_at=time.time(), last_event="http_heartbeat")
            return True
        _log("ERROR", f"Heartbeat HTTP {response.status_code}: {response.text[:200]}")
    except Exception as exc:
        _log("ERROR", f"Heartbeat HTTP falhou: {exc}")
    return False


def _http_telemetry(base: str, device_id: str, token: str, payload: dict[str, Any]) -> bool:
    """Envia snapshot por HTTP (confiável) — a fila não depende de ACK do Socket.IO."""
    try:
        response = requests.post(
            f"{base}/api/remote-monitor/telemetry",
            headers={"Authorization": f"Bearer {token}", "X-Device-Id": device_id},
            json=payload,
            timeout=(5, 30),
            verify=True,
        )
        if response.ok:
            return True
        _log("ERROR", f"Telemetry HTTP {response.status_code}: {response.text[:200]}")
    except Exception as exc:
        _log("ERROR", f"Telemetry HTTP falhou: {exc}")
    return False


def _collector_loop() -> None:
    next_full = 0.0
    while not _STOP.is_set():
        started = time.monotonic()
        try:
            light = collector.collect_light()
            now = time.monotonic()
            configured = bool(db.get_config("token_ciphertext"))
            enabled = db.get_config("enabled", "true") == "true"
            if now >= next_full and configured and enabled:
                with _CACHE_LOCK:
                    inventory = _CACHE["inventory"]
                    updates = _CACHE["pending_updates"]
                db.enqueue(
                    {
                        "version": VERSION,
                        "device_id": db.get_config("device_id"),
                        "metrics": light,
                        "inventory": inventory,
                        "updates": updates,
                    }
                )
                next_full = now + 15
            sio = _SIO
            with _STATE_LOCK:
                authenticated = bool(_STATE.get("authenticated"))
            if sio and sio.connected and authenticated:
                sio.emit(
                    "live_telemetry",
                    {"device_id": db.get_config("device_id"), "version": VERSION, "metrics": light},
                    namespace=NAMESPACE,
                )
                _set_state(last_live_at=time.time(), last_event="live_telemetry")
        except Exception as exc:
            _log("ERROR", f"Falha na coleta: {exc}")
        _STOP.wait(max(0.05, 1.0 - (time.monotonic() - started)))


def _maintenance_loop() -> None:
    next_inventory = next_updates = 0.0
    while not _STOP.is_set():
        now = time.monotonic()
        if now >= next_inventory:
            result = collector.collect_inventory()
            with _CACHE_LOCK:
                _CACHE["inventory"] = result
            next_inventory = time.monotonic() + 6 * 3600
        if _STOP.is_set():
            return
        if now >= next_updates:
            result = collector.collect_pending_updates()
            with _CACHE_LOCK:
                _CACHE["pending_updates"] = result
            next_updates = time.monotonic() + 3600
        _STOP.wait(30)


def _ack_callback(row_id: int):
    def callback(*args: Any) -> None:
        accepted = not args or args[0] is True or (isinstance(args[0], dict) and args[0].get("ok", True))
        if accepted:
            db.acknowledge(row_id)
            _set_state(last_telemetry_at=time.time(), last_event="telemetry_ack")
    return callback


def _drain(sio: socketio.Client | None = None) -> None:
    """Descarrega a fila local preferindo HTTP; Socket.IO é complementar."""
    token = db.get_token()
    device_id = db.get_config("device_id")
    raw_url = (db.get_config("server_url") or "").strip()
    if not token or not device_id or not raw_url:
        return
    try:
        base = server_origin(raw_url)
    except Exception:
        return

    for item in db.pending(50):
        if _STOP.is_set():
            return
        payload = dict(item["payload"])
        payload["buffer_id"] = item["id"]
        payload["device_id"] = device_id
        payload.setdefault("version", VERSION)

        if _http_telemetry(base, str(device_id), token, payload):
            db.acknowledge(item["id"])
            _set_state(last_telemetry_at=time.time(), last_event="telemetry_http")
            continue

        # Fallback Socket.IO se HTTP falhar e o socket estiver autenticado.
        if sio and sio.connected:
            with _STATE_LOCK:
                authenticated = bool(_STATE.get("authenticated"))
            if authenticated:
                sio.emit("telemetry", payload, namespace=NAMESPACE, callback=_ack_callback(item["id"]))
                # Não bloqueia: ACK explícito (evento telemetry_ack) também limpa a fila.
                continue
        return


def _socket_loop() -> None:
    global _SIO
    backoff = 1.0
    while not _STOP.is_set():
        if db.get_config("enabled", "true") != "true":
            _set_state(connected=False, socket_open=False, authenticated=False, last_event="disabled")
            _STOP.wait(2)
            continue
        try:
            token, device_id = db.get_token(), db.get_config("device_id")
            if not token:
                raise RuntimeError("Agente ainda não ativado")
            raw_url = (db.get_config("server_url") or "").strip()
            if not raw_url:
                raise RuntimeError("Informe a URL do servidor na configuração")
            base = server_origin(raw_url)
        except Exception as exc:
            _set_state(
                connected=False,
                socket_open=False,
                authenticated=False,
                last_error=_mask(exc),
                last_event="not_configured",
            )
            _STOP.wait(3)
            continue

        ready_event = threading.Event()
        auth_failed = {"msg": ""}
        sio = socketio.Client(reconnection=False, ssl_verify=True, logger=False, engineio_logger=False)
        _SIO = sio

        @sio.event(namespace=NAMESPACE)
        def connect() -> None:
            # Socket aberto — "conectado" só após ready (auth OK no Computicket).
            _set_state(socket_open=True, connected=False, authenticated=False, last_error="", last_event="socket_open")
            _log("INFO", f"Socket aberto em {base}{NAMESPACE} — aguardando ready…")

        @sio.event(namespace=NAMESPACE)
        def disconnect() -> None:
            _set_state(connected=False, socket_open=False, authenticated=False, last_event="disconnected")
            ready_event.set()

        @sio.event(namespace=NAMESPACE)
        def connect_error(data: Any) -> None:
            msg = _mask(data)
            auth_failed["msg"] = msg
            _set_state(
                connected=False,
                socket_open=False,
                authenticated=False,
                last_error=msg,
                last_event="connect_error",
            )
            ready_event.set()

        @sio.on("ready", namespace=NAMESPACE)
        def on_ready(data: Any) -> None:
            _set_state(
                connected=True,
                socket_open=True,
                authenticated=True,
                last_error="",
                last_event="ready",
            )
            _log("INFO", f"Autenticado no Computicket: {data}")
            ready_event.set()

        @sio.on("telemetry_ack", namespace=NAMESPACE)
        def telemetry_ack(data: Any) -> None:
            if isinstance(data, dict) and data.get("buffer_id") is not None:
                db.acknowledge(int(data["buffer_id"]))
                _set_state(last_telemetry_at=time.time(), last_event="telemetry_ack")

        @sio.on("remote_command", namespace=NAMESPACE)
        def remote_command(data: Any) -> None:
            # O callback de rede apenas valida/enfileira; toda execução ocorre no worker serial.
            try:
                if not isinstance(data, dict):
                    raise ValueError("Payload de comando deve ser objeto")
                executor = _COMMAND_EXECUTOR
                if executor is None:
                    raise RuntimeError("Executor de comandos indisponível")
                executor.enqueue(data, confirmed_pending=True)
                _set_state(last_event="command_queued")
            except Exception as exc:
                command_id = data.get("id") if isinstance(data, dict) else "desconhecido"
                _log("ERROR", f"Comando remoto {command_id} rejeitado: {exc}")

        try:
            sio.connect(
                base,
                namespaces=[NAMESPACE],
                auth={"device_id": device_id, "token": token},
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Device-Id": str(device_id or ""),
                },
                transports=["polling", "websocket"],
                wait_timeout=20,
            )
            if not ready_event.wait(timeout=READY_TIMEOUT_SEC):
                msg = auth_failed["msg"] or "Timeout aguardando ready (auth ou namespace /remote-monitor)"
                _set_state(connected=False, authenticated=False, last_error=msg, last_event="ready_timeout")
                _log("ERROR", msg)
                try:
                    sio.disconnect()
                except Exception:
                    pass
            else:
                with _STATE_LOCK:
                    authenticated = bool(_STATE.get("authenticated"))
                if authenticated:
                    backoff = 1.0
                    # Descarrega fila imediatamente após auth.
                    _drain(sio)
                    _fetch_pending_commands()
                    while sio.connected and not _STOP.is_set():
                        with _STATE_LOCK:
                            if not _STATE.get("authenticated"):
                                break
                        _drain(sio)
                        sio.emit(
                            "heartbeat",
                            {"device_id": device_id, "version": VERSION},
                            namespace=NAMESPACE,
                        )
                        _http_heartbeat(base, str(device_id or ""), token)
                        _fetch_pending_commands()
                        _STOP.wait(15)
        except Exception as exc:
            _set_state(
                connected=False,
                socket_open=False,
                authenticated=False,
                last_error=_mask(exc),
                last_event="connect_failed",
            )
            _log("ERROR", f"Falha de conexão: {exc}")
        finally:
            try:
                sio.disconnect()
            except Exception:
                pass
            _SIO = None
            _set_state(connected=False, socket_open=False, authenticated=False)
        # Mesmo sem socket, tenta esvaziar a fila por HTTP (presença fica offline).
        try:
            _drain(None)
            _fetch_pending_commands()
        except Exception as exc:
            _log("ERROR", f"Drain HTTP offline: {exc}")
        _STOP.wait(backoff)
        backoff = min(60.0, backoff * 2)


def start_agent() -> None:
    global _THREADS, _COMMAND_EXECUTOR
    if any(thread.is_alive() for thread in _THREADS):
        return
    _STOP.clear()
    if _COMMAND_EXECUTOR is None:
        _COMMAND_EXECUTOR = command_executor.CommandExecutor(
            db.DB_FILE,
            _command_credentials,
            _report_command_started,
            _report_command_result,
            _log,
        )
    _COMMAND_EXECUTOR.start()
    _THREADS = [
        threading.Thread(target=_collector_loop, name="monitor-collector", daemon=True),
        threading.Thread(target=_maintenance_loop, name="monitor-maintenance", daemon=True),
        threading.Thread(target=_socket_loop, name="monitor-socket", daemon=True),
    ]
    for thread in _THREADS:
        thread.start()


def stop_agent() -> None:
    _STOP.set()
    sio = _SIO
    if sio:
        try:
            sio.disconnect()
        except Exception:
            pass
    for thread in _THREADS:
        thread.join(timeout=2)
    executor = _COMMAND_EXECUTOR
    if executor:
        executor.stop()


def restart_agent() -> None:
    sio = _SIO
    if sio:
        try:
            sio.disconnect()
        except Exception:
            pass
    _set_state(connected=False, socket_open=False, authenticated=False, last_event="reconfiguring")
