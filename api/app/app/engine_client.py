"""Cliente HTTP do engine WhatsApp (backend_compuchat)."""
from __future__ import annotations

import os
import secrets
import threading
import time
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

import requests
from flask_login import current_user

from . import db
from .models import HelpDeskAgentMap, User

DEFAULT_QUEUE = {"name": "SUPORTE", "color": "#3B82F6"}

_admin_lock = threading.Lock()
_admin_token: Optional[str] = None
_admin_token_exp = 0.0
_agent_tokens: dict[int, tuple[str, float]] = {}
_agent_lock = threading.Lock()
TOKEN_TTL_SEC = 12 * 60

# Hostnames só resolvíveis dentro da rede Docker — o browser não alcança.
_DOCKER_ONLY_HOSTS = frozenset(
    {
        "whatsapp-engine",
        "baileys",
        "api",
        "web",
        "postgres",
        "redis",
    }
)


class EngineError(Exception):
    def __init__(self, message: str, status_code: int = 502, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def engine_url() -> str:
    return (os.environ.get("WHATSAPP_ENGINE_URL") or "http://127.0.0.1:4000").rstrip("/")


def _engine_listen_port() -> str:
    explicit = (os.environ.get("COMPUTICKET_WHATSAPP_PORT") or "").strip()
    if explicit:
        return explicit
    parsed = urlparse(engine_url())
    return str(parsed.port or 4000)


def _is_browser_unreachable_host(hostname: str | None) -> bool:
    host = (hostname or "").strip().lower()
    if not host:
        return True
    if host in _DOCKER_ONLY_HOSTS:
        return True
    # Nomes de serviço Docker típicos (sem ponto) não resolvem no browser.
    if "." not in host and host not in {"localhost"}:
        return True
    return False


def _prefer_https(scheme: str, *hints: str | None) -> str:
    base = (scheme or "http").lower()
    for hint in hints:
        if not hint:
            continue
        parsed = urlparse(hint if "://" in hint else f"https://{hint}")
        if (parsed.scheme or "").lower() == "https":
            return "https"
    return base


def _format_public_origin(scheme: str, host: str, port: int | None) -> str:
    """Monta origem pública; em HTTPS omite portas de engine/dev (usa 443 + proxy)."""
    sch = (scheme or "http").lower()
    if sch == "https" and port in (None, 80, 443, 3000, 4000):
        return f"https://{host}"
    if port and port not in (80, 443):
        return f"{sch}://{host}:{port}"
    return f"{sch}://{host}"


def engine_public_url(*, browser_origin: str | None = None) -> str:
    """URL do Socket.IO/engine que o browser consegue abrir.

    ``WHATSAPP_ENGINE_URL`` costuma ser ``http://whatsapp-engine:4000`` (só Docker).
    O token devolvido ao front precisa de um host público (LAN/localhost/proxy
    same-origin em ``COMPUTICKET_PUBLIC_URL``, ex.: ``https://computicket.space``).

    Nunca devolve hostname Docker, mesmo que ``WHATSAPP_ENGINE_PUBLIC_URL`` esteja
    mal configurada.
    """
    explicit = (os.environ.get("WHATSAPP_ENGINE_PUBLIC_URL") or "").strip().rstrip("/")
    public = (os.environ.get("COMPUTICKET_PUBLIC_URL") or "").strip().rstrip("/")
    listen_port = int(_engine_listen_port() or "4000")

    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    if browser_origin:
        candidates.append(browser_origin)
    if public:
        candidates.append(public)

    for candidate in candidates:
        parsed = urlparse(candidate if "://" in candidate else f"http://{candidate}")
        host = parsed.hostname
        if not host or _is_browser_unreachable_host(host):
            continue
        scheme = _prefer_https(parsed.scheme or "http", browser_origin, public)
        # URL explícita com porta própria (ex. localhost:4000 em dev) — respeitar.
        # Origem do site (3000/443) → same-origin; Next faz proxy de /socket.io.
        port = parsed.port
        if explicit and candidate.rstrip("/") == explicit.rstrip("/") and port == listen_port:
            if scheme == "https":
                # Em HTTPS público, :4000 quase nunca tem TLS; preferir same-origin.
                if public:
                    pub = urlparse(public if "://" in public else f"https://{public}")
                    if pub.hostname and not _is_browser_unreachable_host(pub.hostname):
                        return _format_public_origin("https", pub.hostname, pub.port)
                if browser_origin:
                    bo = urlparse(
                        browser_origin if "://" in browser_origin else f"https://{browser_origin}"
                    )
                    if bo.hostname and not _is_browser_unreachable_host(bo.hostname):
                        return _format_public_origin("https", bo.hostname, bo.port)
            return _format_public_origin(scheme, host, port)
        return _format_public_origin(scheme, host, port)

    internal = engine_url()
    parsed = urlparse(internal)
    if not _is_browser_unreachable_host(parsed.hostname):
        return internal.rstrip("/")
    return f"http://127.0.0.1:{listen_port}"


def engine_admin_email() -> str:
    return os.environ.get("WHATSAPP_ENGINE_ADMIN_EMAIL") or "admin@admin.com"


def engine_admin_password() -> str:
    return os.environ.get("WHATSAPP_ENGINE_ADMIN_PASSWORD") or "123456"


def _login(email: str, password: str) -> str:
    try:
        res = requests.post(
            urljoin(engine_url() + "/", "auth/login"),
            json={"email": email, "password": password},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise EngineError(f"Engine WhatsApp indisponível: {exc}", 503) from exc
    if res.status_code >= 400:
        raise EngineError(
            (res.json() if _is_json(res) else {}).get("error") or f"Falha no login do engine ({res.status_code})",
            res.status_code,
        )
    data = res.json()
    token = data.get("token")
    if not token:
        raise EngineError("Engine não devolveu token")
    return token


def _is_json(res: requests.Response) -> bool:
    ctype = res.headers.get("Content-Type") or ""
    return "json" in ctype


def get_admin_token(force: bool = False) -> str:
    global _admin_token, _admin_token_exp
    now = time.time()
    with _admin_lock:
        if not force and _admin_token and now < _admin_token_exp:
            return _admin_token
        _admin_token = _login(engine_admin_email(), engine_admin_password())
        _admin_token_exp = now + TOKEN_TTL_SEC
        return _admin_token


def _request(
    method: str,
    path: str,
    token: str,
    *,
    json: Any = None,
    params: Optional[dict] = None,
    files: Any = None,
    data: Any = None,
    timeout: float | tuple[float, float] = 30,
) -> Any:
    url = urljoin(engine_url() + "/", path.lstrip("/"))
    headers = {"Authorization": f"Bearer {token}"}
    if json is not None and files is None:
        headers["Content-Type"] = "application/json"
    try:
        res = requests.request(
            method,
            url,
            headers=headers,
            json=json,
            params=params,
            files=files,
            data=data,
            timeout=timeout,
        )
    except requests.Timeout as exc:
        if files is not None:
            raise EngineError(
                "O envio do arquivo demorou demais. Tente um vídeo menor ou em MP4.",
                504,
            ) from exc
        raise EngineError("O WhatsApp demorou demais para responder. Tente novamente.", 504) from exc
    except requests.RequestException as exc:
        raise EngineError(f"Engine WhatsApp indisponível: {exc}", 503) from exc

    if res.status_code == 401:
        raise EngineError("Sessão do engine expirada", 401)
    if res.status_code >= 400:
        try:
            parsed = res.json() if _is_json(res) else {"error": (res.text or "")[:500]}
        except ValueError:
            parsed = {"error": (res.text or "")[:500] or f"Erro do engine ({res.status_code})"}
        payload = parsed if isinstance(parsed, dict) else {"error": str(parsed)[:500]}
        message = payload.get("error") or payload.get("message") or f"Erro do engine ({res.status_code})"
        raise EngineError(str(message), res.status_code, payload)
    if res.status_code == 204 or not res.content:
        return None
    if _is_json(res):
        return res.json()
    return res.content


def admin_request(method: str, path: str, **kwargs) -> Any:
    token = get_admin_token()
    try:
        return _request(method, path, token, **kwargs)
    except EngineError as exc:
        if exc.status_code == 401:
            token = get_admin_token(force=True)
            return _request(method, path, token, **kwargs)
        raise


def agent_request(method: str, path: str, **kwargs) -> Any:
    token = ensure_agent_session().token
    try:
        return _request(method, path, token, **kwargs)
    except EngineError as exc:
        if exc.status_code == 401:
            token = ensure_agent_session(force=True).token
            return _request(method, path, token, **kwargs)
        raise


class AgentSession:
    def __init__(self, token: str, engine_user_id: int, company_id: int, email: str):
        self.token = token
        self.engine_user_id = engine_user_id
        self.company_id = company_id
        self.email = email


def _engine_email_for(user: User) -> str:
    raw = (user.email or "").strip().lower()
    if raw and "@" in raw:
        return raw
    return f"user{user.id}@computicket.local"


def list_engine_users(search: str = "") -> list[dict]:
    data = admin_request("GET", "/users", params={"pageNumber": "1", "searchParam": search})
    if isinstance(data, dict):
        return data.get("users") or []
    return data if isinstance(data, list) else []


def ensure_default_queue() -> list[dict]:
    queues = admin_request("GET", "/queue") or []
    if not isinstance(queues, list):
        queues = []
    if queues:
        return queues
    created = admin_request("POST", "/queue", json=DEFAULT_QUEUE)
    return [created] if created else []


def _is_admin_role(user: User) -> bool:
    return (user.role or "").strip().lower() in {"admin", "administrador", "administrator"}


def _create_engine_user(user: User, password: str, queues: list[dict] | None = None) -> dict:
    # Filas vazias de propósito: o admin atribui em Configurações → WhatsApp.
    queue_ids = [q.get("id") for q in (queues or []) if q.get("id") is not None]
    profile = "admin" if _is_admin_role(user) else "user"
    payload = {
        "name": user.name or user.email,
        "email": _engine_email_for(user),
        "password": password,
        "profile": profile,
        "companyId": 1,
        "queueIds": queue_ids,
        "allTicket": "enabled" if profile == "admin" else "disabled",
    }
    return admin_request("POST", "/users", json=payload)


def ensure_agent_map(user: User, force_recreate: bool = False) -> HelpDeskAgentMap:
    mapping = HelpDeskAgentMap.query.filter_by(computicket_user_id=user.id).first()
    if mapping and not force_recreate:
        return mapping

    ensure_default_queue()
    password = secrets.token_urlsafe(18)
    email = _engine_email_for(user)

    existing = None
    for item in list_engine_users(email):
        if str(item.get("email") or "").lower() == email:
            existing = item
            break

    if existing:
        engine_user_id = int(existing["id"])
        if mapping:
            mapping.engine_user_id = engine_user_id
            mapping.engine_email = email
            db.session.commit()
            return mapping
        # Usuário já existe no engine (ex.: admin seed) — tenta a senha padrão se for o admin
        if email == engine_admin_email():
            password = engine_admin_password()
        else:
            # Recria senha via update se tivermos permissão
            try:
                admin_request(
                    "PUT",
                    f"/users/{engine_user_id}",
                    json={
                        "password": password,
                        "name": user.name,
                        "email": email,
                        "allTicket": "enabled" if _is_admin_role(user) else "disabled",
                    },
                )
            except EngineError:
                password = mapping.engine_password if mapping else password
    else:
        created = _create_engine_user(user, password)
        engine_user_id = int(created["id"])

    if mapping:
        mapping.engine_user_id = engine_user_id
        mapping.engine_email = email
        mapping.engine_password = password
        mapping.company_id = 1
    else:
        mapping = HelpDeskAgentMap(
            computicket_user_id=user.id,
            engine_user_id=engine_user_id,
            engine_email=email,
            engine_password=password,
            company_id=1,
        )
        db.session.add(mapping)
    db.session.commit()
    return mapping


def ensure_agent_session(force: bool = False) -> AgentSession:
    if not current_user.is_authenticated:
        raise EngineError("Não autenticado", 401)
    user: User = current_user
    mapping = ensure_agent_map(user)
    now = time.time()
    with _agent_lock:
        cached = _agent_tokens.get(user.id)
        if not force and cached and now < cached[1]:
            return AgentSession(cached[0], mapping.engine_user_id, mapping.company_id, mapping.engine_email)
    try:
        token = _login(mapping.engine_email, mapping.engine_password)
    except EngineError:
        mapping = ensure_agent_map(user, force_recreate=True)
        token = _login(mapping.engine_email, mapping.engine_password)
    with _agent_lock:
        _agent_tokens[user.id] = (token, now + TOKEN_TTL_SEC)
    return AgentSession(token, mapping.engine_user_id, mapping.company_id, mapping.engine_email)


def send_engine_message(engine_ticket_id: int, body: str, *, internal: bool = False) -> None:
    """Envia texto na conversa. internal=True grava nota só no Help Desk (não vai ao WhatsApp)."""
    text = (body or "").strip()
    if not text or not engine_ticket_id:
        return
    payload = {"body": text}
    if internal:
        payload["isInternal"] = True
    try:
        admin_request("POST", f"/messages/{int(engine_ticket_id)}", json=payload)
    except EngineError:
        agent_request("POST", f"/messages/{int(engine_ticket_id)}", json=payload)


def notify_helpdesk_ticket(computicket_ticket_id: int, body: str, *, internal: bool = False) -> None:
    """Avisa todas as conversas vinculadas ao chamado. Falha do WhatsApp não sobe."""
    from .models import HelpDeskTicketLink

    if not computicket_ticket_id:
        return
    links = HelpDeskTicketLink.query.filter_by(computicket_ticket_id=int(computicket_ticket_id)).all()
    for link in links:
        try:
            send_engine_message(link.engine_ticket_id, body, internal=internal)
        except EngineError:
            continue


def engine_health() -> dict:
    try:
        res = requests.get(urljoin(engine_url() + "/", "auth/login"), timeout=3)
        # login é POST; GET pode 404/405, mas prova que o host responde
        return {"ok": res.status_code < 500, "url": engine_url(), "status": res.status_code}
    except requests.RequestException as exc:
        return {"ok": False, "url": engine_url(), "error": str(exc)}
