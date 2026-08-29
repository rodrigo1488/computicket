"""Cliente HTTP do engine WhatsApp (backend_compuchat)."""
from __future__ import annotations

import os
import secrets
import threading
import time
from typing import Any, Optional
from urllib.parse import urljoin

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


class EngineError(Exception):
    def __init__(self, message: str, status_code: int = 502, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def engine_url() -> str:
    return (os.environ.get("WHATSAPP_ENGINE_URL") or "http://127.0.0.1:4000").rstrip("/")


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
    timeout: int = 30,
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
    except requests.RequestException as exc:
        raise EngineError(f"Engine WhatsApp indisponível: {exc}", 503) from exc

    if res.status_code == 401:
        raise EngineError("Sessão do engine expirada", 401)
    if res.status_code >= 400:
        payload = res.json() if _is_json(res) else {"error": res.text[:500]}
        message = payload.get("error") or payload.get("message") or f"Erro do engine ({res.status_code})"
        raise EngineError(message, res.status_code, payload)
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


def send_engine_message(engine_ticket_id: int, body: str) -> None:
    """Envia texto na conversa WhatsApp sem assinatura de agente (evento de sistema)."""
    text = (body or "").strip()
    if not text or not engine_ticket_id:
        return
    try:
        admin_request("POST", f"/messages/{int(engine_ticket_id)}", json={"body": text})
    except EngineError:
        agent_request("POST", f"/messages/{int(engine_ticket_id)}", json={"body": text})


def notify_helpdesk_ticket(computicket_ticket_id: int, body: str) -> None:
    """Avisa todas as conversas vinculadas ao chamado. Falha do WhatsApp não sobe."""
    from .models import HelpDeskTicketLink

    if not computicket_ticket_id:
        return
    links = HelpDeskTicketLink.query.filter_by(computicket_ticket_id=int(computicket_ticket_id)).all()
    for link in links:
        try:
            send_engine_message(link.engine_ticket_id, body)
        except EngineError:
            continue


def engine_health() -> dict:
    try:
        res = requests.get(urljoin(engine_url() + "/", "auth/login"), timeout=3)
        # login é POST; GET pode 404/405, mas prova que o host responde
        return {"ok": res.status_code < 500, "url": engine_url(), "status": res.status_code}
    except requests.RequestException as exc:
        return {"ok": False, "url": engine_url(), "error": str(exc)}
