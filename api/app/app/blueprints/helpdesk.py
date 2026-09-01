"""Help Desk WhatsApp — BFF autenticado para o engine Compuchat/Baileys."""
from __future__ import annotations

import hashlib
import mimetypes
import os
import random
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from flask import Blueprint, Response, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from .. import db
from ..engine_client import (
    EngineError,
    admin_request,
    agent_request,
    engine_health,
    engine_public_url,
    engine_url,
    ensure_agent_map,
    ensure_agent_session,
    ensure_default_queue,
    send_engine_message,
)
from ..models import (
    AIAuditLog,
    HelpDeskAgentMap,
    HelpDeskContactClientLink,
    HelpDeskRating,
    HelpDeskTicketLink,
    Ticket,
    User,
)
from ..timezone_utils import brasilia_to_utc, get_brasilia_now
from ..services.copilot import CopilotError, answer_question, improve_draft, suggest_reply, suggest_ticket

helpdesk_bp = Blueprint("helpdesk", __name__, url_prefix="/helpdesk")

_PLAYABLE_MIME = {
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "opus": "audio/ogg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "weba": "audio/webm",
    "flac": "audio/flac",
    "amr": "audio/amr",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "m4v": "video/x-m4v",
    "3gp": "video/3gpp",
    "3gpp": "video/3gpp",
    "mkv": "video/x-matroska",
    "avi": "video/x-msvideo",
}


def _media_mime(filename: str, fallback: str | None = None) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in _PLAYABLE_MIME:
        return _PLAYABLE_MIME[ext]
    guessed = mimetypes.guess_type(filename)[0]
    if guessed:
        return guessed
    if fallback and fallback != "application/octet-stream":
        return fallback
    return fallback or "application/octet-stream"


_ai_rate_lock = threading.Lock()
_ai_rate_hits: dict[int, deque[float]] = defaultdict(deque)


_CONTACT_STRIP_KEYS = frozenset(
    {"session", "qrcode", "facebookUserToken", "tokenStore", "gupshupApiKey"}
)


def _fail(exc: EngineError):
    status = int(exc.status_code or 502)
    message = (str(exc) or "").strip() or f"Erro do engine ({status})"
    if status >= 500 and "indispon" not in message.lower():
        message = f"Engine WhatsApp indisponível: {message}"
    return jsonify({"error": message, "details": exc.payload}), status


def _rewrite_engine_media_url(url: str | None) -> str | None:
    """Converte URL interna do engine (/public/...) no proxy público do BFF.

    O engine grava BACKEND_URL=http://whatsapp-engine:4000 — inacessível no browser.
    O cliente deve usar /flask/helpdesk/api/media/... (rewrite Next → Flask).
    """
    if not url or not isinstance(url, str):
        return None
    raw = url.strip()
    if not raw or "nopicture" in raw.lower():
        return None
    if "/helpdesk/api/media/" in raw:
        idx = raw.find("/helpdesk/api/media/")
        return f"/flask{raw[idx:]}"

    public_path: str | None = None
    if "/public/" in raw:
        public_path = raw.split("/public/", 1)[1]
    elif raw.startswith("public/"):
        public_path = raw[7:]
    elif raw.startswith("/"):
        # Caminho relativo já público do engine sem host
        parsed = urlparse(raw)
        if parsed.path.startswith("/public/"):
            public_path = parsed.path[len("/public/") :]

    if public_path is not None:
        public_path = public_path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if not public_path or ".." in public_path.split("/"):
            return None
        return f"/flask/helpdesk/api/media/{public_path}"

    # CDN/externo alcançável pelo browser
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return raw


def _sanitize_contact(data):
    """Remove blobs de sessão Baileys e reescreve profilePicUrl para o proxy."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    wa = out.get("whatsapp")
    if isinstance(wa, dict):
        out["whatsapp"] = {k: v for k, v in wa.items() if k not in _CONTACT_STRIP_KEYS}
    if "profilePicUrl" in out:
        out["profilePicUrl"] = _rewrite_engine_media_url(out.get("profilePicUrl"))
    return out


def _rewrite_message_media(msg):
    if not isinstance(msg, dict):
        return msg
    out = dict(msg)
    if "mediaUrl" in out:
        out["mediaUrl"] = _rewrite_engine_media_url(out.get("mediaUrl"))
    contact = out.get("contact")
    if isinstance(contact, dict):
        out["contact"] = _sanitize_contact(contact)
    quoted = out.get("quotedMsg")
    if isinstance(quoted, dict):
        out["quotedMsg"] = _rewrite_message_media(quoted)
    return out


def _rewrite_ticket_media(ticket: dict | None) -> dict | None:
    if not isinstance(ticket, dict):
        return ticket
    out = dict(ticket)
    contact = out.get("contact")
    if isinstance(contact, dict):
        out["contact"] = _sanitize_contact(contact)
    return out


def _ai_rate_allowed(user_id: int) -> bool:
    """Limiter local por processo; evita dependência externa para esta proteção básica."""
    try:
        limit = max(1, min(int(os.environ.get("COPILOT_RATE_LIMIT_PER_MINUTE") or "20"), 120))
    except ValueError:
        limit = 20
    now = time.monotonic()
    with _ai_rate_lock:
        hits = _ai_rate_hits[user_id]
        while hits and now - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


def _conversation_ai_context(ticket_id: int) -> tuple[str, str]:
    """Lê somente o histórico recente pelas mesmas rotas autenticadas do engine."""
    ticket = agent_request("GET", f"/tickets/{ticket_id}", timeout=15) or {}
    data = agent_request("GET", f"/messages/{ticket_id}", params={"pageNumber": "1"}, timeout=20)
    normalized = _normalize_messages(data, ticket_id)
    lines: list[str] = []
    for item in (normalized.get("messages") or [])[-20:]:
        if not isinstance(item, dict):
            continue
        body = item.get("body") or item.get("message") or item.get("text") or ""
        if not isinstance(body, str) or not body.strip():
            continue
        sender = (
            item.get("senderName")
            or item.get("sender_name")
            or (item.get("contact") or {}).get("name")
            or ("Agente" if item.get("fromMe") else "Cliente")
        )
        lines.append(f"{sender}: {body[:2000]}")
    contact = ticket.get("contact") if isinstance(ticket, dict) else {}
    requester = (contact or {}).get("name") if isinstance(contact, dict) else ""
    return "\n".join(lines)[-16000:], str(requester or "")[:200]


def _audit_ai(
    operation: str,
    prompt: str,
    conversation_id: int | None,
    status: str,
    started: float,
    source_count: int = 0,
    error_code: str | None = None,
) -> None:
    try:
        db.session.add(
            AIAuditLog(
                user_id=current_user.id,
                operation=operation,
                conversation_id=conversation_id,
                prompt_hash=hashlib.sha256((prompt or "").encode("utf-8")).hexdigest(),
                input_chars=len(prompt or ""),
                source_count=source_count,
                status=status,
                error_code=error_code,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()


def _execute_ai(operation: str, prompt: str, conversation_id: int | None, callback):
    started = time.monotonic()
    if not _ai_rate_allowed(current_user.id):
        _audit_ai(operation, prompt, conversation_id, "rate_limited", started, error_code="rate_limit")
        return jsonify({"error": "Limite temporário do Copiloto atingido. Tente novamente em um minuto."}), 429
    try:
        result = callback()
        _audit_ai(operation, prompt, conversation_id, "success", started, len(result.get("sources") or []))
        return jsonify(result)
    except EngineError as exc:
        _audit_ai(operation, prompt, conversation_id, "error", started, error_code="engine_error")
        return _fail(exc)
    except CopilotError as exc:
        _audit_ai(operation, prompt, conversation_id, "error", started, error_code=exc.code)
        return jsonify({"error": str(exc), "code": exc.code}), exc.status_code
    except Exception:
        _audit_ai(operation, prompt, conversation_id, "error", started, error_code="internal_error")
        return jsonify({"error": "Não foi possível executar o Copiloto."}), 500


_CLOSED_TICKET_STATUSES = ("fechado", "cancelado")


def _visible_linked_ticket_id(computicket_id, conversation_status: str | None):
	"""Chamado fechado/cancelado não fica ativo em conversa nova/aberta."""
	if not computicket_id:
		return None
	ticket = db.session.get(Ticket, int(computicket_id))
	if not ticket:
		return None
	if ticket.status in _CLOSED_TICKET_STATUSES and conversation_status != "closed":
		return None
	return ticket.id


def _visible_rating(rating: dict | None, conversation_status: str | None):
	"""Avaliação pertence só à conversa encerrada em que foi pedida."""
	if not rating or conversation_status != "closed":
		return None
	return rating


def _links_by_engine_ids(ids: list[int]) -> dict[int, int]:
	if not ids:
		return {}
	rows = HelpDeskTicketLink.query.filter(HelpDeskTicketLink.engine_ticket_id.in_(ids)).all()
	return {row.engine_ticket_id: row.computicket_ticket_id for row in rows}


def _ratings_by_engine_ids(ids: list[int]) -> dict[int, dict]:
	if not ids:
		return {}
	rows = (
		HelpDeskRating.query.filter(HelpDeskRating.engine_ticket_id.in_(ids))
		.order_by(HelpDeskRating.id.asc())
		.all()
	)
	return {row.engine_ticket_id: row.to_dict() for row in rows}


def _get_or_create_rating(engine_ticket_id: int, conversation: dict | None = None) -> HelpDeskRating:
    rating = (
        HelpDeskRating.query.filter_by(engine_ticket_id=engine_ticket_id)
        .order_by(HelpDeskRating.id.desc())
        .first()
    )
    if rating and not rating.answered:
        return rating

    link = HelpDeskTicketLink.query.filter_by(engine_ticket_id=engine_ticket_id).first()
    contact = (conversation or {}).get("contact")
    customer_name = contact.get("name") if isinstance(contact, dict) else None
    engine_user_id = _conversation_user_id(conversation or {})
    agent_map = (
        HelpDeskAgentMap.query.filter_by(engine_user_id=engine_user_id).first()
        if engine_user_id is not None
        else None
    )
    assigned_agent = User.query.get(agent_map.computicket_user_id) if agent_map else None
    agent = assigned_agent or current_user
    rating = HelpDeskRating(
        engine_ticket_id=engine_ticket_id,
        computicket_ticket_id=link.computicket_ticket_id if link else None,
        token=secrets.token_urlsafe(32),
        agent_id=agent.id,
        agent_name=(agent.name or "")[:200] or None,
        customer_name=str(customer_name or "")[:200] or None,
    )
    db.session.add(rating)
    try:
        db.session.commit()
        return rating
    except IntegrityError:
        db.session.rollback()
        concurrent = (
            HelpDeskRating.query.filter_by(engine_ticket_id=engine_ticket_id)
            .order_by(HelpDeskRating.id.desc())
            .first()
        )
        if concurrent:
            return concurrent
        raise


_PRODUCTION_SITE = "https://www.computicket.space"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def _public_site_origin() -> str:
    """Origem usada em links enviados ao WhatsApp — nunca localhost."""
    raw = (os.environ.get("COMPUTICKET_PUBLIC_URL") or "").strip().rstrip("/")
    if raw:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        host = (parsed.hostname or "").lower()
        if host and host not in _LOCAL_HOSTS:
            if host in {"computicket.space", "www.computicket.space"}:
                return _PRODUCTION_SITE
            scheme = (parsed.scheme or "https").lower()
            if scheme != "https" and "." in host:
                scheme = "https"
            if parsed.port and parsed.port not in (80, 443, 3000):
                return f"{scheme}://{host}:{parsed.port}"
            return f"{scheme}://{host}"
    return _PRODUCTION_SITE


def _rating_public_url(rating: HelpDeskRating) -> str:
    return f"{_public_site_origin()}/avaliar-atendimento/{rating.token}"


def _send_rating_invitation(rating: HelpDeskRating) -> None:
    if rating.answered:
        return
    send_engine_message(
        rating.engine_ticket_id,
        "Como foi o seu atendimento? Sua opinião nos ajuda a melhorar.\n"
        f"Avalie de 1 a 5 estrelas: {_rating_public_url(rating)}",
    )
    rating.sent_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()


def _history_for_contact(contact_id, current_ticket_id) -> list[dict]:
    """Ciclos fechados anteriores do mesmo contato (não mistura no thread atual)."""
    if not contact_id:
        return []
    try:
        data = admin_request("GET", f"/tickets/history/contact/{int(contact_id)}")
    except EngineError:
        return []
    sessions = data.get("sessions") if isinstance(data, dict) else None
    if not isinstance(sessions, list):
        return []
    rows: list[dict] = []
    ids: list[int] = []
    current = int(current_ticket_id) if current_ticket_id is not None else None
    for session in sessions:
        if not isinstance(session, dict):
            continue
        sid = session.get("id")
        if sid is None:
            continue
        sid = int(sid)
        if current is not None and sid == current:
            continue
        ids.append(sid)
        rows.append(session)
    links = _links_by_engine_ids(ids)
    ratings = _ratings_by_engine_ids(ids)
    history: list[dict] = []
    for session in rows:
        sid = int(session["id"])
        history.append({
            "id": sid,
            "status": session.get("status"),
            "lastMessage": session.get("lastMessage"),
            "updatedAt": session.get("updatedAt") or session.get("finishedAt"),
            "rating": ratings.get(sid),
            "computicket_ticket_id": links.get(sid),
        })
    return history


def _with_link(ticket: dict | None, *, include_history: bool = False) -> dict | None:
    if not ticket:
        return ticket
    engine_id = ticket.get("id")
    if engine_id is None:
        return _rewrite_ticket_media(ticket)
    row = HelpDeskTicketLink.query.filter_by(engine_ticket_id=int(engine_id)).first()
    rating = (
        HelpDeskRating.query.filter_by(engine_ticket_id=int(engine_id))
        .order_by(HelpDeskRating.id.desc())
        .first()
    )
    ticket = dict(ticket)
    ticket["computicket_ticket_id"] = _visible_linked_ticket_id(
        row.computicket_ticket_id if row else None,
        ticket.get("status"),
    )
    ticket["rating"] = _visible_rating(rating.to_dict() if rating else None, ticket.get("status"))
    if include_history:
        contact = ticket.get("contact") if isinstance(ticket.get("contact"), dict) else {}
        contact_id = contact.get("id") or ticket.get("contactId")
        ticket["history"] = _history_for_contact(contact_id, ticket.get("id"))
    return _rewrite_ticket_media(ticket)


def _require_admin():
    if not current_user.has_role("admin"):
        return jsonify({"error": "Apenas administradores podem alterar o WhatsApp."}), 403
    return None


def _as_int_ids(raw) -> list[int]:
    if not raw:
        return []
    out: list[int] = []
    for item in raw:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


_QUEUE_INTRO = "Olá! Escolha o setor:"


def _is_auto_menu(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return True
    return "escolha o setor" in raw.lower() or "[1]" in raw or "[ 1 ]" in raw


def _menu_greeting(queue_ids: list[int], queues: list[dict], custom: str) -> str:
    """O engine monta o menu ao vivo a partir das filas da conexão.

    A greeting só precisa existir quando há mais de uma fila
    (ERR_WAPP_GREETING_REQUIRED). Não gravar a lista [1]/[2] no banco —
    ela fica obsoleta quando uma fila nova é criada.
    """
    greeting = (custom or "").strip()
    if len(queue_ids) <= 1:
        return "" if _is_auto_menu(greeting) else greeting
    if not greeting or _is_auto_menu(greeting):
        return _QUEUE_INTRO
    return greeting


def _listed_whatsapps() -> list[dict]:
    data = admin_request("GET", "/whatsapp/") or []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if isinstance(data.get("whatsapps"), list):
            return data["whatsapps"]
        if data.get("id"):
            return [data]
    return []


def _valid_queue_ids(queues: list[dict]) -> set[int]:
    return {int(q["id"]) for q in queues if q.get("id") is not None}


def _ids_from_whatsapp(w: dict, valid: set[int]) -> list[int]:
    raw = _as_int_ids([q.get("id") for q in (w.get("queues") or [])])
    return [qid for qid in raw if qid in valid]


def _put_whatsapp_queues(whatsapp: dict, queue_ids: list[int], queues: list[dict]) -> dict:
    payload = {
        "name": (whatsapp.get("name") or "").strip(),
        "queueIds": queue_ids,
        "isDefault": bool(whatsapp.get("isDefault")),
        "greetingMessage": _menu_greeting(queue_ids, queues, whatsapp.get("greetingMessage") or ""),
        "complationMessage": whatsapp.get("complationMessage") or "",
        "outOfHoursMessage": whatsapp.get("outOfHoursMessage") or "",
    }
    return admin_request("PUT", f"/whatsapp/{whatsapp['id']}", json=payload)


def _attach_queue_to_connections(queue_id: int) -> None:
    queues = ensure_default_queue()
    valid = _valid_queue_ids(queues)
    if queue_id not in valid:
        valid.add(queue_id)
    for whatsapp in _listed_whatsapps():
        if not whatsapp.get("id"):
            continue
        current = _ids_from_whatsapp(whatsapp, valid)
        if queue_id not in current:
            current.append(queue_id)
        _put_whatsapp_queues(whatsapp, current, queues)


def _repair_connection_queues() -> list[dict]:
    """Remove filas apagadas da conexão e vincula as filas atuais se ficou vazia."""
    queues = ensure_default_queue()
    valid = _valid_queue_ids(queues)
    all_ids = [q.get("id") for q in queues if q.get("id") is not None]
    repaired: list[dict] = []
    for whatsapp in _listed_whatsapps():
        if not whatsapp.get("id"):
            repaired.append(whatsapp)
            continue
        linked = _as_int_ids([q.get("id") for q in (whatsapp.get("queues") or [])])
        alive = [qid for qid in linked if qid in valid]
        greeting = whatsapp.get("greetingMessage") or ""
        stale_ids = any(qid not in valid for qid in linked)
        empty = not alive and bool(all_ids)
        has_old_menu = "[1]" in greeting or "[ 1 ]" in greeting
        names = [str(q.get("name") or "") for q in queues if q.get("name")]
        stale_menu = has_old_menu and (not names or not all(name in greeting for name in names))
        if stale_ids or empty or stale_menu:
            next_ids = alive or list(all_ids)
            try:
                updated = _put_whatsapp_queues(whatsapp, next_ids, queues)
                repaired.append(updated if isinstance(updated, dict) else whatsapp)
                continue
            except EngineError:
                pass
        repaired.append(whatsapp)
    return repaired


def _normalize_messages(data, ticket_id: int) -> dict:
    if isinstance(data, list):
        messages = data
        ticket = None
        count = len(messages)
        has_more = False
    elif isinstance(data, dict):
        messages = data.get("messages")
        if messages is None:
            messages = data.get("rows") or []
        if not isinstance(messages, list):
            messages = []
        ticket = data.get("ticket")
        count = data.get("count") if data.get("count") is not None else len(messages)
        has_more = bool(data.get("hasMore"))
    else:
        messages, ticket, count, has_more = [], None, 0, False
    if isinstance(ticket, dict):
        slim = {
            key: ticket.get(key)
            for key in (
                "id",
                "status",
                "unreadMessages",
                "userId",
                "queueId",
                "contact",
                "queue",
                "user",
                "whatsapp",
                "lastMessage",
                "updatedAt",
            )
        }
        ticket = _with_link(slim)
    messages = [_rewrite_message_media(m) for m in messages]
    return {"messages": messages, "ticket": ticket, "count": count, "hasMore": has_more, "ticketId": ticket_id}


_QUEUE_COLORS = (
    "#3B82F6",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#8B5CF6",
    "#EC4899",
    "#14B8A6",
    "#0EA5E9",
    "#84CC16",
    "#F97316",
)


def _unused_color(requested: str, queues: list[dict]) -> str:
    used = {(q.get("color") or "").strip().lower() for q in queues}
    color = (requested or "").strip()
    if color and color.lower() not in used:
        return color
    for candidate in _QUEUE_COLORS:
        if candidate.lower() not in used:
            return candidate
    return f"#{random.randint(0, 0xFFFFFF):06X}"


_WEEKDAYS = (
    ("monday", "Segunda-feira"),
    ("tuesday", "Terça-feira"),
    ("wednesday", "Quarta-feira"),
    ("thursday", "Quinta-feira"),
    ("friday", "Sexta-feira"),
    ("saturday", "Sábado"),
    ("sunday", "Domingo"),
)


def _normalize_schedules(raw) -> list[dict] | None:
    """None = não alterar. [] = limpar expediente (engine não bloqueia)."""
    if raw is None:
        return None
    if raw is False:
        return []
    if not isinstance(raw, list):
        return None
    labels = {en: label for en, label in _WEEKDAYS}
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        weekday_en = str(item.get("weekdayEn") or item.get("weekday_en") or "").strip().lower()
        if weekday_en not in labels:
            continue
        start = str(item.get("startTime") or item.get("start_time") or "").strip()
        end = str(item.get("endTime") or item.get("end_time") or "").strip()
        out.append(
            {
                "weekday": item.get("weekday") or labels[weekday_en],
                "weekdayEn": weekday_en,
                "startTime": start,
                "endTime": end,
            }
        )
    return out


def _queue_body(payload: dict, queues: list[dict], *, pick_color: bool = False) -> dict:
    name = (payload.get("name") or "").strip()
    color = (payload.get("color") or "").strip()
    if pick_color:
        color = _unused_color(color, queues)
    elif not color:
        color = "#6366F1"
    body = {
        "name": name,
        "color": color,
        "greetingMessage": payload.get("greetingMessage") or "",
        "outOfHoursMessage": payload.get("outOfHoursMessage") or "",
    }
    if payload.get("orderQueue") not in (None, ""):
        body["orderQueue"] = payload.get("orderQueue")
    if "schedules" in payload:
        schedules = _normalize_schedules(payload.get("schedules"))
        if schedules is not None:
            body["schedules"] = schedules
    return body


def _whatsapp_body(payload: dict, queues: list[dict], *, name: str | None = None) -> dict:
    queue_ids = _as_int_ids(payload.get("queueIds"))
    body = {
        "queueIds": queue_ids,
        "isDefault": bool(payload.get("isDefault")),
        "greetingMessage": _menu_greeting(queue_ids, queues, payload.get("greetingMessage") or ""),
        "complationMessage": (payload.get("complationMessage") or "").strip(),
        "outOfHoursMessage": (payload.get("outOfHoursMessage") or "").strip(),
    }
    if name is not None:
        body["name"] = name
    elif payload.get("name"):
        body["name"] = str(payload.get("name")).strip()
    return body


def _agent_payload(user: User, mapping: HelpDeskAgentMap | None, queues: list | None) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "engine_user_id": mapping.engine_user_id if mapping else None,
        "queues": queues or [],
    }


@helpdesk_bp.route("/api/health")
@login_required
def health():
    try:
        try:
            _repair_connection_queues()
        except EngineError:
            ensure_default_queue()
        session = ensure_agent_session()
        return jsonify(
            {
                "ok": True,
                "engine": engine_health(),
                "companyId": session.company_id,
                "engineUserId": session.engine_user_id,
            }
        )
    except EngineError as exc:
        return jsonify({"ok": False, "engine": engine_health(), "error": str(exc)}), exc.status_code


@helpdesk_bp.route("/api/engine-token")
@login_required
def engine_token():
    try:
        session = ensure_agent_session()
        # Preferir Origin/Referer do browser (atrás do proxy Next /flask) para
        # montar um host alcançável; WHATSAPP_ENGINE_URL interno (Docker) não serve.
        origin = (request.headers.get("Origin") or "").strip()
        referer = (request.headers.get("Referer") or "").strip()
        xf_host = (request.headers.get("X-Forwarded-Host") or "").strip()
        xf_proto = (request.headers.get("X-Forwarded-Proto") or "").strip().lower()
        if origin:
            browser_origin = origin
        elif xf_host:
            host = xf_host.split(",")[0].strip()
            if "://" in host:
                browser_origin = host
            else:
                browser_origin = f"{xf_proto or 'https'}://{host}"
        else:
            browser_origin = referer
        return jsonify(
            {
                "token": session.token,
                "companyId": session.company_id,
                "engineUserId": session.engine_user_id,
                "engineUrl": engine_public_url(browser_origin=browser_origin or None),
            }
        )
    except EngineError as exc:
        return _fail(exc)


def _as_optional_int(raw) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _conversation_unread(ticket: dict) -> int:
    try:
        return max(0, int(ticket.get("unreadMessages") or 0))
    except (TypeError, ValueError):
        return 0


def _conversation_user_id(ticket: dict) -> int | None:
    raw = ticket.get("userId")
    if raw is None and isinstance(ticket.get("user"), dict):
        raw = ticket["user"].get("id")
    return _as_optional_int(raw)


def _conversation_queue_id(ticket: dict) -> int | None:
    raw = ticket.get("queueId")
    if raw is None and isinstance(ticket.get("queue"), dict):
        raw = ticket["queue"].get("id")
    return _as_optional_int(raw)


def _engine_user_queue_ids(engine_user: dict | None) -> set[int]:
    data = engine_user or {}
    ids = set(_as_int_ids(data.get("queueIds")))
    for queue in data.get("queues") or []:
        if isinstance(queue, dict) and queue.get("id") is not None:
            qid = _as_optional_int(queue.get("id"))
            if qid is not None:
                ids.add(qid)
    return ids


def _list_engine_tickets(status: str) -> list[dict]:
    tickets: list[dict] = []
    page = 1
    while page <= 20:
        data = agent_request(
            "GET",
            "/tickets",
            params={"status": status, "showAll": "true", "pageNumber": str(page)},
        )
        chunk = data.get("tickets") if isinstance(data, dict) else data
        tickets.extend(item for item in (chunk or []) if isinstance(item, dict))
        if not (isinstance(data, dict) and data.get("hasMore")):
            break
        page += 1
    return tickets


def _helpdesk_nav_badge_count() -> int:
    session = ensure_agent_session()
    engine_user_id = session.engine_user_id
    agent_queue_ids: set[int] = set()
    try:
        engine_user = admin_request("GET", f"/users/{engine_user_id}") or {}
        agent_queue_ids = _engine_user_queue_ids(engine_user if isinstance(engine_user, dict) else {})
    except EngineError:
        agent_queue_ids = set()

    count = 0
    for ticket in _list_engine_tickets("open"):
        if _conversation_unread(ticket) <= 0:
            continue
        if _conversation_user_id(ticket) == engine_user_id:
            count += 1

    for ticket in _list_engine_tickets("pending"):
        if _conversation_unread(ticket) <= 0:
            continue
        queue_id = _conversation_queue_id(ticket)
        if queue_id is None or queue_id in agent_queue_ids:
            count += 1
    return count


@helpdesk_bp.route("/api/nav-badge")
@login_required
def nav_badge():
    """Conta conversas com mensagem nova visíveis para o usuário logado."""
    try:
        return jsonify({"count": _helpdesk_nav_badge_count()})
    except EngineError:
        return jsonify({"count": 0})


@helpdesk_bp.route("/api/overview")
@login_required
def overview():
    try:
        data = agent_request("GET", "/tickets/overview", params={"showAll": "true"})
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations")
@login_required
def list_conversations():
    status = request.args.get("status") or "pending"
    params = {
        "status": status,
        "showAll": "true",
        "pageNumber": request.args.get("pageNumber") or "1",
    }
    search = request.args.get("searchParam") or request.args.get("search")
    if search:
        params["searchParam"] = search
    queue_ids = request.args.get("queueIds")
    if queue_ids:
        params["queueIds"] = queue_ids
    try:
        data = agent_request("GET", "/tickets", params=params)
    except EngineError as exc:
        return _fail(exc)
    tickets = data.get("tickets") if isinstance(data, dict) else data
    tickets = tickets or []
    engine_ids = [t.get("id") for t in tickets if t.get("id") is not None]
    links = _links_by_engine_ids(engine_ids)
    ratings = _ratings_by_engine_ids(engine_ids)
    rewritten: list[dict] = []
    for ticket in tickets:
        if not isinstance(ticket, dict):
            continue
        item = dict(ticket)
        item["computicket_ticket_id"] = _visible_linked_ticket_id(
            links.get(item.get("id")),
            item.get("status"),
        )
        item["rating"] = _visible_rating(ratings.get(item.get("id")), item.get("status"))
        rewritten.append(_rewrite_ticket_media(item) or item)
    tickets = rewritten
    if isinstance(data, dict):
        data["tickets"] = tickets
        return jsonify(data)
    return jsonify({"tickets": tickets, "count": len(tickets), "hasMore": False})


@helpdesk_bp.route("/api/conversations/<int:ticket_id>")
@login_required
def show_conversation(ticket_id: int):
    try:
        ticket = agent_request("GET", f"/tickets/{ticket_id}")
        return jsonify(_with_link(ticket, include_history=True))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/history")
@login_required
def conversation_history(ticket_id: int):
    try:
        ticket = agent_request("GET", f"/tickets/{ticket_id}") or {}
    except EngineError as exc:
        return _fail(exc)
    contact = ticket.get("contact") if isinstance(ticket, dict) and isinstance(ticket.get("contact"), dict) else {}
    contact_id = contact.get("id") or (ticket.get("contactId") if isinstance(ticket, dict) else None)
    return jsonify({"history": _history_for_contact(contact_id, ticket_id)})


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/messages")
@login_required
def list_messages(ticket_id: int):
    params = {"pageNumber": request.args.get("pageNumber") or "1"}
    try:
        try:
            data = agent_request("GET", f"/messages/{ticket_id}", params=params)
        except EngineError as exc:
            if exc.status_code not in {401, 403}:
                raise
            data = admin_request("GET", f"/messages/{ticket_id}", params=params)
        return jsonify(_normalize_messages(data, ticket_id))
    except EngineError as exc:
        return _fail(exc)


def _format_ai_chat_history(raw) -> str:
    """Histórico curto da sessão (dashboard/chat); não persiste conteúdo bruto."""
    if isinstance(raw, str):
        return raw.strip()[:16000]
    if not isinstance(raw, list):
        return ""
    lines: list[str] = []
    for item in raw[-12:]:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or item.get("text") or "").strip()
        if not content:
            continue
        role = str(item.get("role") or "").strip().lower()
        label = "Usuário" if role in ("user", "human") else "Assistente"
        lines.append(f"{label}: {content[:2000]}")
    return "\n".join(lines)[-16000:]


@helpdesk_bp.route("/api/ai/query", methods=["POST"])
@helpdesk_bp.route("/api/ai/chat", methods=["POST"])
@login_required
def ai_query():
    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question") or payload.get("message") or "").strip()
    if not question:
        return jsonify({"error": "question é obrigatório"}), 400
    if len(question) > 12000:
        return jsonify({"error": "question excede o limite de 12000 caracteres"}), 400
    raw_conversation_id = payload.get("conversation_id")
    try:
        conversation_id = int(raw_conversation_id) if raw_conversation_id not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "conversation_id inválido"}), 400

    session_history = _format_ai_chat_history(payload.get("history") or payload.get("messages") or "")

    def run():
        if conversation_id:
            history = _conversation_ai_context(conversation_id)[0]
        else:
            history = session_history
        return answer_question(question, history)

    operation = "chat" if request.path.rstrip("/").endswith("/chat") else "query"
    return _execute_ai(operation, question, conversation_id, run)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/ai/suggest-reply", methods=["POST"])
@login_required
def ai_suggest_reply(ticket_id: int):
    payload = request.get_json(silent=True) or {}
    instruction = str(payload.get("instruction") or payload.get("text") or "").strip()
    if len(instruction) > 12000:
        return jsonify({"error": "Texto excede o limite de 12000 caracteres"}), 400

    def run():
        history, _requester = _conversation_ai_context(ticket_id)
        return suggest_reply(instruction, history)

    return _execute_ai("suggest_reply", instruction, ticket_id, run)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/ai/improve", methods=["POST"])
@login_required
def ai_improve(ticket_id: int):
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text é obrigatório"}), 400
    if len(text) > 12000:
        return jsonify({"error": "text excede o limite de 12000 caracteres"}), 400

    def run():
        history, _requester = _conversation_ai_context(ticket_id)
        return improve_draft(text, history)

    return _execute_ai("improve", text, ticket_id, run)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/ai/suggest-ticket", methods=["POST"])
@login_required
def ai_suggest_ticket(ticket_id: int):
    def run():
        history, requester = _conversation_ai_context(ticket_id)
        return suggest_ticket(history, requester)

    return _execute_ai("suggest_ticket", f"conversation:{ticket_id}", ticket_id, run)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/messages", methods=["POST"])
@login_required
def send_message(ticket_id: int):
    try:
        if request.files:
            storages = request.files.getlist("medias") or list(request.files.values())
            files = [("medias", (storage.filename, storage.read(), storage.mimetype)) for storage in storages]
            data = {k: v for k, v in request.form.items()}
            if "body" not in data:
                data["body"] = request.form.get("message") or ""
            result = agent_request("POST", f"/messages/{ticket_id}", files=files, data=data, timeout=60)
            return jsonify(result or {"ok": True})
        payload = request.get_json(silent=True) or {}
        body = payload.get("body") or payload.get("message") or ""
        data = {"body": body}
        if payload.get("isInternal") or payload.get("isPrivate"):
            data["isInternal"] = True
        result = agent_request("POST", f"/messages/{ticket_id}", json=data)
        return jsonify(result or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/assume", methods=["PUT", "POST"])
@login_required
def assume_conversation(ticket_id: int):
    try:
        session = ensure_agent_session()
        ticket = agent_request(
            "PUT",
            f"/tickets/{ticket_id}",
            json={"status": "open", "userId": session.engine_user_id},
        )
        return jsonify(_with_link(ticket.get("ticket") if isinstance(ticket, dict) and "ticket" in ticket else ticket))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/pending", methods=["PUT", "POST"])
@login_required
def return_conversation(ticket_id: int):
    try:
        ticket = agent_request(
            "PUT",
            f"/tickets/{ticket_id}",
            json={"status": "pending", "userId": None},
        )
        return jsonify(_with_link(ticket.get("ticket") if isinstance(ticket, dict) and "ticket" in ticket else ticket))
    except EngineError as exc:
        return _fail(exc)


def _id_or_none(value) -> int | None:
    if value in (None, "", "null"):
        return None
    return int(value)


def _nested_id(data: dict | None, key: str, nested: str) -> int | None:
    if not data:
        return None
    if data.get(key) is not None:
        try:
            return int(data.get(key))
        except (TypeError, ValueError):
            return None
    inner = data.get(nested) or {}
    if isinstance(inner, dict) and inner.get("id") is not None:
        try:
            return int(inner.get("id"))
        except (TypeError, ValueError):
            return None
    return None


def _queue_name(queue_id: int | None, ticket: dict | None) -> str:
    if queue_id is None:
        return ""
    nested = (ticket or {}).get("queue") if isinstance(ticket, dict) else None
    if isinstance(nested, dict) and nested.get("name") and int(nested.get("id") or 0) == queue_id:
        return str(nested.get("name"))
    try:
        for queue in ensure_default_queue():
            if int(queue.get("id") or 0) == queue_id:
                return str(queue.get("name") or "")
    except EngineError:
        pass
    return ""


def _agent_name(user_id: int | None, ticket: dict | None) -> str:
    if user_id is None:
        return ""
    nested = (ticket or {}).get("user") if isinstance(ticket, dict) else None
    if isinstance(nested, dict) and nested.get("name") and int(nested.get("id") or 0) == user_id:
        return str(nested.get("name"))
    try:
        user = admin_request("GET", f"/users/{user_id}") or {}
        return str(user.get("name") or "")
    except EngineError:
        mapping = HelpDeskAgentMap.query.filter_by(engine_user_id=user_id).first()
        if mapping and mapping.user:
            return mapping.user.name or ""
    return ""


def _transfer_notice(queue_changed: bool, user_changed: bool, queue_name: str, agent_name: str) -> str:
    if queue_changed and user_changed and queue_name and agent_name:
        return f"Conversa transferida para a fila {queue_name} e para {agent_name}."
    if queue_changed and queue_name:
        return f"Conversa transferida para a fila {queue_name}."
    if user_changed and agent_name:
        return f"Conversa transferida para {agent_name}."
    return ""


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/transfer", methods=["PUT", "POST"])
@login_required
def transfer_conversation(ticket_id: int):
    payload = request.get_json(silent=True) or {}
    body: dict = {}
    try:
        if "userId" in payload:
            body["userId"] = _id_or_none(payload.get("userId"))
        if "queueId" in payload:
            body["queueId"] = _id_or_none(payload.get("queueId"))
    except (TypeError, ValueError):
        return jsonify({"error": "userId ou queueId inválido"}), 400
    if "status" in payload and payload.get("status"):
        body["status"] = payload.get("status")
    elif body.get("userId"):
        body["status"] = "open"
    if not body:
        return jsonify({"error": "Informe userId e/ou queueId para transferir."}), 400
    try:
        current = agent_request("GET", f"/tickets/{ticket_id}") or {}
        old_user = _nested_id(current if isinstance(current, dict) else {}, "userId", "user")
        old_queue = _nested_id(current if isinstance(current, dict) else {}, "queueId", "queue")
        ticket = agent_request("PUT", f"/tickets/{ticket_id}", json=body)
        updated = ticket.get("ticket") if isinstance(ticket, dict) and "ticket" in ticket else ticket
        updated = updated if isinstance(updated, dict) else {}
        new_user = _nested_id(updated, "userId", "user")
        if "userId" in body:
            new_user = body["userId"]
        new_queue = _nested_id(updated, "queueId", "queue")
        if "queueId" in body:
            new_queue = body["queueId"]
        user_changed = "userId" in body and new_user != old_user
        queue_changed = "queueId" in body and new_queue != old_queue
        notice = _transfer_notice(
            queue_changed,
            user_changed,
            _queue_name(new_queue, updated),
            _agent_name(new_user, updated),
        )
        if notice:
            try:
                send_engine_message(ticket_id, notice)
            except EngineError:
                pass
        return jsonify(_with_link(updated or ticket))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/reopen", methods=["PUT", "POST"])
@login_required
def reopen_conversation(ticket_id: int):
    try:
        session = ensure_agent_session()
        ticket = agent_request(
            "PUT",
            f"/tickets/{ticket_id}",
            json={"status": "open", "userId": session.engine_user_id},
        )
        return jsonify(_with_link(ticket.get("ticket") if isinstance(ticket, dict) and "ticket" in ticket else ticket))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/resolve", methods=["PUT", "POST"])
@login_required
def resolve_conversation(ticket_id: int):
    try:
        try:
            conversation = agent_request("GET", f"/tickets/{ticket_id}") or {}
        except EngineError:
            conversation = {}
        rating_warning = None
        rating = None
        try:
            rating = _get_or_create_rating(ticket_id, conversation if isinstance(conversation, dict) else None)
            _send_rating_invitation(rating)
        except Exception:
            db.session.rollback()
            rating_warning = "Conversa encerrada, mas não foi possível enviar a pesquisa de satisfação."
        ticket = agent_request(
            "PUT",
            f"/tickets/{ticket_id}",
            json={"status": "closed", "skipComplation": True},
        )
        result = ticket.get("ticket") if isinstance(ticket, dict) and "ticket" in ticket else ticket
        result = _with_link(result)
        result = dict(result or {})
        if rating:
            result["rating"] = rating.to_dict()
        if rating_warning:
            result["rating_warning"] = rating_warning
        return jsonify(result)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/rating/resend", methods=["POST"])
@login_required
def resend_rating(ticket_id: int):
    try:
        conversation = agent_request("GET", f"/tickets/{ticket_id}") or {}
        if isinstance(conversation, dict) and conversation.get("status") != "closed":
            return jsonify({"error": "A pesquisa só pode ser enviada após encerrar a conversa."}), 400
        rating = _get_or_create_rating(ticket_id, conversation if isinstance(conversation, dict) else None)
        if rating.answered:
            return jsonify({"error": "Esta avaliação já foi respondida."}), 409
        if rating.sent_at:
            elapsed = datetime.now(timezone.utc).replace(tzinfo=None) - rating.sent_at.replace(tzinfo=None)
            if elapsed.total_seconds() < 60:
                return jsonify({"error": "Aguarde um minuto antes de reenviar a pesquisa."}), 429
        _send_rating_invitation(rating)
        return jsonify({"message": "Pesquisa de satisfação reenviada.", "rating": rating.to_dict()})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/ratings/summary")
@login_required
def rating_summary():
    sent = HelpDeskRating.query.filter(HelpDeskRating.sent_at.isnot(None))
    answered = sent.filter(HelpDeskRating.score.isnot(None))
    responded = answered.count()
    total = sent.count()
    average = answered.with_entities(func.avg(HelpDeskRating.score)).scalar()
    grouped = (
        answered.with_entities(HelpDeskRating.score, func.count(HelpDeskRating.id))
        .group_by(HelpDeskRating.score)
        .all()
    )
    recent = answered.order_by(HelpDeskRating.responded_at.desc()).limit(10).all()
    return jsonify(
        {
            "average": round(float(average or 0), 2),
            "responded": responded,
            "pending": max(total - responded, 0),
            "response_rate": round((responded / total * 100) if total else 0, 1),
            "distribution": {str(score): 0 for score in range(1, 6)}
            | {str(score): count for score, count in grouped},
            "recent": [rating.to_dict() for rating in recent],
        }
    )


@helpdesk_bp.route("/api/ratings/public/<token>")
def public_rating(token: str):
    rating = HelpDeskRating.query.filter_by(token=token).first()
    if not rating:
        return jsonify({"error": "Pesquisa de satisfação não encontrada."}), 404
    if request.method == "GET":
        return jsonify(
            {
                "answered": rating.answered,
                "score": rating.score,
                "customer_name": rating.customer_name,
            }
        )


@helpdesk_bp.route("/api/ratings/public/<token>", methods=["POST"])
def submit_public_rating(token: str):
    rating = HelpDeskRating.query.filter_by(token=token).first()
    if not rating:
        return jsonify({"error": "Pesquisa de satisfação não encontrada."}), 404
    if rating.answered:
        return jsonify({"error": "Esta avaliação já foi enviada."}), 409

    payload = request.get_json(silent=True) or {}
    try:
        score = int(payload.get("score"))
    except (TypeError, ValueError):
        return jsonify({"error": "Informe uma nota de 1 a 5."}), 400
    if score < 1 or score > 5:
        return jsonify({"error": "A nota deve estar entre 1 e 5."}), 400
    comment = str(payload.get("comment") or "").strip()
    if len(comment) > 1000:
        return jsonify({"error": "O comentário deve ter no máximo 1000 caracteres."}), 400

    from ..timezone_utils import brasilia_to_utc, get_brasilia_now

    responded_at = brasilia_to_utc(get_brasilia_now())
    updated = (
        HelpDeskRating.query.filter(
            HelpDeskRating.id == rating.id,
            HelpDeskRating.responded_at.is_(None),
        )
        .update(
            {
                HelpDeskRating.score: score,
                HelpDeskRating.comment: comment or None,
                HelpDeskRating.responded_at: responded_at,
            },
            synchronize_session=False,
        )
    )
    if not updated:
        db.session.rollback()
        return jsonify({"error": "Esta avaliação já foi enviada."}), 409
    db.session.commit()
    return jsonify({"message": "Obrigado pela sua avaliação!", "score": score})


@helpdesk_bp.route("/api/conversations/<int:ticket_id>/link-ticket", methods=["POST"])
@login_required
def link_ticket(ticket_id: int):
    payload = request.get_json(silent=True) or {}
    computicket_id = payload.get("ticket_id") or payload.get("computicket_ticket_id")
    if not computicket_id:
        return jsonify({"error": "ticket_id é obrigatório"}), 400
    ticket = Ticket.query.get(int(computicket_id))
    if not ticket:
        return jsonify({"error": "Chamado não encontrado"}), 404
    row = HelpDeskTicketLink.query.filter_by(engine_ticket_id=ticket_id).first()
    linked_at = brasilia_to_utc(get_brasilia_now())
    if row:
        current_linked = db.session.get(Ticket, row.computicket_ticket_id)
        if current_linked and current_linked.status not in _CLOSED_TICKET_STATUSES:
            return jsonify({
                "error": "Esta conversa já possui um chamado ativo.",
                "computicket_ticket_id": current_linked.id,
            }), 409
        row.computicket_ticket_id = ticket.id
        row.created_at = linked_at
    else:
        row = HelpDeskTicketLink(
            engine_ticket_id=ticket_id,
            computicket_ticket_id=ticket.id,
            created_at=linked_at,
        )
        db.session.add(row)
    db.session.commit()
    try:
        send_engine_message(ticket_id, f"Ticket #{ticket.id} anexado a esta conversa.")
    except EngineError:
        pass
    return jsonify({"ok": True, "engine_ticket_id": ticket_id, "computicket_ticket_id": ticket.id})


@helpdesk_bp.route("/api/connections")
@login_required
def list_connections():
    try:
        data = _repair_connection_queues()
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections", methods=["POST"])
@login_required
def create_connection():
    denied = _require_admin()
    if denied:
        return denied
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Nome da conexão é obrigatório"}), 400
    try:
        queues = ensure_default_queue()
        if "queueIds" not in payload:
            payload = dict(payload)
            payload["queueIds"] = [q.get("id") for q in queues if q.get("id") is not None]
        data = admin_request("POST", "/whatsapp/", json=_whatsapp_body(payload, queues, name=name))
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections/<int:whatsapp_id>")
@login_required
def show_connection(whatsapp_id: int):
    try:
        data = admin_request("GET", f"/whatsapp/{whatsapp_id}")
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections/<int:whatsapp_id>", methods=["PUT"])
@login_required
def update_connection(whatsapp_id: int):
    denied = _require_admin()
    if denied:
        return denied
    payload = request.get_json(silent=True) or {}
    try:
        queues = ensure_default_queue()
        current = admin_request("GET", f"/whatsapp/{whatsapp_id}") or {}
        name = (payload.get("name") or current.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Nome da conexão é obrigatório"}), 400
        if "queueIds" not in payload:
            payload = dict(payload)
            payload["queueIds"] = [q.get("id") for q in (current.get("queues") or []) if q.get("id") is not None]
        for field in ("greetingMessage", "complationMessage", "outOfHoursMessage", "isDefault"):
            if field not in payload and current.get(field) is not None:
                payload[field] = current.get(field)
        data = admin_request("PUT", f"/whatsapp/{whatsapp_id}", json=_whatsapp_body(payload, queues, name=name))
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections/<int:whatsapp_id>/session", methods=["POST"])
@login_required
def start_session(whatsapp_id: int):
    denied = _require_admin()
    if denied:
        return denied
    try:
        data = admin_request("POST", f"/whatsappsession/{whatsapp_id}")
        return jsonify(data or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections/<int:whatsapp_id>/session", methods=["PUT"])
@login_required
def restart_session(whatsapp_id: int):
    denied = _require_admin()
    if denied:
        return denied
    try:
        data = admin_request("PUT", f"/whatsappsession/{whatsapp_id}")
        return jsonify(data or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections/<int:whatsapp_id>/session", methods=["DELETE"])
@login_required
def logout_session(whatsapp_id: int):
    denied = _require_admin()
    if denied:
        return denied
    try:
        data = admin_request("DELETE", f"/whatsappsession/{whatsapp_id}")
        return jsonify(data or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/connections/<int:whatsapp_id>", methods=["DELETE"])
@login_required
def delete_connection(whatsapp_id: int):
    denied = _require_admin()
    if denied:
        return denied
    try:
        data = admin_request("DELETE", f"/whatsapp/{whatsapp_id}")
        return jsonify(data or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/queues")
@login_required
def list_queues():
    try:
        queues = ensure_default_queue()
        return jsonify(queues)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/queues/<int:queue_id>")
@login_required
def show_queue(queue_id: int):
    try:
        data = admin_request("GET", f"/queue/{queue_id}")
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/queues", methods=["POST"])
@login_required
def create_queue():
    denied = _require_admin()
    if denied:
        return denied
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Nome da fila é obrigatório"}), 400
    try:
        queues = ensure_default_queue()
        data = admin_request("POST", "/queue", json=_queue_body(payload, queues, pick_color=True))
        attach = payload.get("attachToConnections")
        if attach is None or attach is True:
            qid = (data or {}).get("id") if isinstance(data, dict) else None
            if qid is not None:
                _attach_queue_to_connections(int(qid))
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/queues/<int:queue_id>", methods=["PUT"])
@login_required
def update_queue(queue_id: int):
    denied = _require_admin()
    if denied:
        return denied
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Nome da fila é obrigatório"}), 400
    try:
        queues = ensure_default_queue()
        data = admin_request("PUT", f"/queue/{queue_id}", json=_queue_body(payload, queues))
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/queues/<int:queue_id>", methods=["DELETE"])
@login_required
def delete_queue(queue_id: int):
    denied = _require_admin()
    if denied:
        return denied
    try:
        data = admin_request("DELETE", f"/queue/{queue_id}")
        try:
            _repair_connection_queues()
        except EngineError:
            pass
        return jsonify(data or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/assignees")
@login_required
def list_assignees():
    try:
        users = User.query.filter(User.status == "1").order_by(User.name.asc()).all()
        maps = {
            row.computicket_user_id: row
            for row in HelpDeskAgentMap.query.filter(
                HelpDeskAgentMap.computicket_user_id.in_([u.id for u in users] or [0])
            ).all()
        }
        result = []
        for user in users:
            mapping = maps.get(user.id)
            if not mapping:
                continue
            result.append(
                {
                    "id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "role": user.role,
                    "engine_user_id": mapping.engine_user_id,
                }
            )
        return jsonify(result)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/quick-messages")
@login_required
def list_quick_messages():
    try:
        session = ensure_agent_session()
        page = 1
        records: list = []
        while page <= 10:
            data = agent_request(
                "GET",
                "/quick-messages",
                params={"pageNumber": str(page), "userId": session.engine_user_id},
            )
            chunk = data.get("records") if isinstance(data, dict) else data
            records.extend(chunk or [])
            if not (isinstance(data, dict) and data.get("hasMore")):
                break
            page += 1
        return jsonify(records)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/quick-messages", methods=["POST"])
@login_required
def create_quick_message():
    payload = request.get_json(silent=True) or {}
    shortcode = (payload.get("shortcode") or payload.get("shortcut") or "").strip().lstrip("/")
    message = (payload.get("message") or "").strip()
    if not shortcode or not message:
        return jsonify({"error": "Atalho e mensagem são obrigatórios"}), 400
    try:
        data = agent_request("POST", "/quick-messages", json={"shortcode": shortcode, "message": message})
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/quick-messages/<int:item_id>", methods=["PUT"])
@login_required
def update_quick_message(item_id: int):
    payload = request.get_json(silent=True) or {}
    shortcode = (payload.get("shortcode") or payload.get("shortcut") or "").strip().lstrip("/")
    message = (payload.get("message") or "").strip()
    if not shortcode or not message:
        return jsonify({"error": "Atalho e mensagem são obrigatórios"}), 400
    try:
        data = agent_request(
            "PUT",
            f"/quick-messages/{item_id}",
            json={"shortcode": shortcode, "message": message},
        )
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/quick-messages/<int:item_id>", methods=["DELETE"])
@login_required
def delete_quick_message(item_id: int):
    try:
        data = agent_request("DELETE", f"/quick-messages/{item_id}")
        return jsonify(data or {"ok": True})
    except EngineError as exc:
        return _fail(exc)


def _sanitize_contacts_payload(data):
    """Normaliza lista de contatos do engine (array ou {contacts, count, hasMore})."""
    if isinstance(data, list):
        contacts = [_sanitize_contact(c) for c in data if isinstance(c, dict)]
        return {"contacts": contacts, "count": len(contacts), "hasMore": False}
    if not isinstance(data, dict):
        return {"contacts": [], "count": 0, "hasMore": False}
    raw = data.get("contacts") if isinstance(data.get("contacts"), list) else []
    contacts = [_sanitize_contact(c) for c in raw if isinstance(c, dict)]
    return {
        "contacts": contacts,
        "count": int(data.get("count") or len(contacts)),
        "hasMore": bool(data.get("hasMore")),
    }


def _find_engine_contact_by_number(number: str):
    """Busca contato existente no engine pelo número (dígitos)."""
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    if not digits:
        return None
    try:
        listed = agent_request(
            "GET",
            "/contacts",
            params={"searchParam": digits, "pageNumber": "1"},
        )
    except EngineError:
        return None
    contacts = _sanitize_contacts_payload(listed).get("contacts") or []
    for contact in contacts:
        contact_digits = "".join(ch for ch in str(contact.get("number") or "") if ch.isdigit())
        if contact_digits == digits or contact_digits.endswith(digits) or digits.endswith(contact_digits):
            return contact
    return None


@helpdesk_bp.route("/api/contacts")
@login_required
def list_contacts():
    params = {
        "pageNumber": request.args.get("pageNumber") or "1",
    }
    search = request.args.get("searchParam") or request.args.get("search") or request.args.get("q")
    if search:
        params["searchParam"] = search
    try:
        data = agent_request("GET", "/contacts", params=params)
        return jsonify(_sanitize_contacts_payload(data))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/contacts", methods=["POST"])
@login_required
def create_contact():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    number = "".join(ch for ch in str(payload.get("number") or "") if ch.isdigit())
    if not name:
        return jsonify({"error": "Nome é obrigatório"}), 400
    if len(number) < 8:
        return jsonify({"error": "Informe um telefone/WhatsApp válido"}), 400

    body = {
        "name": name,
        "number": number,
        "email": (payload.get("email") or "").strip(),
    }
    try:
        data = agent_request("POST", "/contacts", json=body)
        return jsonify(_sanitize_contact(data)), 201
    except EngineError as exc:
        message = str(exc) or ""
        # Número já cadastrado no engine — devolve o contato existente.
        if "DUPLICATED" in message.upper() or "duplicad" in message.lower():
            existing = _find_engine_contact_by_number(number)
            if existing:
                return jsonify(_sanitize_contact(existing))
        return _fail(exc)


@helpdesk_bp.route("/api/contacts/<int:contact_id>")
@login_required
def show_contact(contact_id: int):
    try:
        data = agent_request("GET", f"/contacts/{contact_id}")
        return jsonify(_sanitize_contact(data))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/contacts/<int:contact_id>", methods=["PUT"])
@login_required
def update_contact(contact_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        existing = _sanitize_contact(agent_request("GET", f"/contacts/{contact_id}") or {})
        body = {
            "name": (payload.get("name") or existing.get("name") or "").strip(),
            "number": existing.get("number") or payload.get("number") or "",
            "email": payload.get("email") if "email" in payload else (existing.get("email") or ""),
            "extraInfo": payload.get("extraInfo") if "extraInfo" in payload else (existing.get("extraInfo") or []),
        }
        data = agent_request("PUT", f"/contacts/{contact_id}", json=body)
        return jsonify(_sanitize_contact(data))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/conversations", methods=["POST"])
@login_required
def start_conversation():
    """Inicia (ou reabre) conversa no engine para um contato existente."""
    payload = request.get_json(silent=True) or {}
    try:
        contact_id = int(payload.get("contactId") or payload.get("contact_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "contactId é obrigatório"}), 400

    queue_id = _id_or_none(payload.get("queueId") if "queueId" in payload else payload.get("queue_id"))
    whatsapp_id = _id_or_none(
        payload.get("whatsappId") if "whatsappId" in payload else payload.get("whatsapp_id")
    )

    body: dict = {
        "contactId": contact_id,
        "status": "open",
        "reuseOpenTicket": True,
    }
    if queue_id is not None:
        body["queueId"] = queue_id
    if whatsapp_id is not None:
        body["whatsappId"] = whatsapp_id

    try:
        session = ensure_agent_session()
        body["userId"] = session.engine_user_id
        ticket = agent_request("POST", "/tickets", json=body)
        if isinstance(ticket, dict) and "ticket" in ticket and isinstance(ticket["ticket"], dict):
            ticket = ticket["ticket"]
        return jsonify(_with_link(ticket if isinstance(ticket, dict) else None)), 201
    except EngineError as exc:
        return _fail(exc)


def _contact_client_link_payload(row: HelpDeskContactClientLink | None):
    if not row:
        return {"linked": False, "link": None}
    return {"linked": True, "link": row.to_dict()}


@helpdesk_bp.route("/api/contacts/<int:contact_id>/client-link")
@login_required
def get_contact_client_link(contact_id: int):
    row = HelpDeskContactClientLink.query.filter_by(engine_contact_id=contact_id).first()
    return jsonify(_contact_client_link_payload(row))


@helpdesk_bp.route("/api/contacts/<int:contact_id>/client-link", methods=["PUT", "POST"])
@login_required
def upsert_contact_client_link(contact_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        external_client_id = int(payload.get("external_client_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "external_client_id é obrigatório"}), 400

    name = (payload.get("external_client_name") or payload.get("name") or "").strip()
    if not name:
        try:
            from ..external_pg import ExternalPgError, fetch_external_clients

            clients = fetch_external_clients()
            selected = next((c for c in clients if c.get("id") == external_client_id), None)
            name = (selected or {}).get("name") or ""
        except Exception:
            name = ""
    if not name:
        return jsonify({"error": "external_client_name é obrigatório"}), 400

    contact_number = (payload.get("contact_number") or payload.get("number") or "").strip() or None
    if not contact_number:
        try:
            existing = _sanitize_contact(agent_request("GET", f"/contacts/{contact_id}") or {})
            contact_number = (existing.get("number") or "").strip() or None
        except EngineError:
            contact_number = None

    row = HelpDeskContactClientLink.query.filter_by(engine_contact_id=contact_id).first()
    if row:
        row.external_client_id = external_client_id
        row.external_client_name = name[:200]
        if contact_number:
            row.contact_number = contact_number[:50]
    else:
        row = HelpDeskContactClientLink(
            engine_contact_id=contact_id,
            contact_number=(contact_number[:50] if contact_number else None),
            external_client_id=external_client_id,
            external_client_name=name[:200],
        )
        db.session.add(row)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Não foi possível salvar o vínculo"}), 409

    return jsonify(_contact_client_link_payload(row))


@helpdesk_bp.route("/api/contacts/<int:contact_id>/client-link", methods=["DELETE"])
@login_required
def delete_contact_client_link(contact_id: int):
    row = HelpDeskContactClientLink.query.filter_by(engine_contact_id=contact_id).first()
    if row:
        db.session.delete(row)
        db.session.commit()
    return jsonify({"linked": False, "link": None, "ok": True})


@helpdesk_bp.route("/api/agents")
@login_required
def list_agents():
    denied = _require_admin()
    if denied:
        return denied
    try:
        users = User.query.filter(User.status == "1").order_by(User.name.asc()).all()
        maps = {
            row.computicket_user_id: row
            for row in HelpDeskAgentMap.query.filter(
                HelpDeskAgentMap.computicket_user_id.in_([u.id for u in users] or [0])
            ).all()
        }
        result = []
        for user in users:
            mapping = maps.get(user.id)
            queues = []
            if mapping:
                try:
                    engine_user = admin_request("GET", f"/users/{mapping.engine_user_id}") or {}
                    queues = engine_user.get("queues") or []
                except EngineError:
                    queues = []
            result.append(_agent_payload(user, mapping, queues))
        return jsonify(result)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/agents/<int:user_id>", methods=["PUT"])
@login_required
def update_agent(user_id: int):
    denied = _require_admin()
    if denied:
        return denied
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuário não encontrado"}), 404
    payload = request.get_json(silent=True) or {}
    if "queueIds" not in payload:
        return jsonify({"error": "queueIds é obrigatório"}), 400
    queue_ids = _as_int_ids(payload.get("queueIds"))
    try:
        mapping = ensure_agent_map(user)
        is_admin = (user.role or "").strip().lower() in {"admin", "administrador", "administrator"}
        admin_request(
            "PUT",
            f"/users/{mapping.engine_user_id}",
            json={
                "name": user.name,
                "email": mapping.engine_email,
                "queueIds": queue_ids,
                "allTicket": "enabled" if is_admin else "disabled",
            },
        )
        engine_user = admin_request("GET", f"/users/{mapping.engine_user_id}") or {}
        return jsonify(_agent_payload(user, mapping, engine_user.get("queues") or []))
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/media/<path:filename>")
@login_required
def proxy_media(filename: str):
    safe = (filename or "").replace("\\", "/").lstrip("/")
    if not safe or ".." in safe.split("/"):
        return jsonify({"error": "Caminho inválido"}), 400
    try:
        res = requests.get(f"{engine_url()}/public/{safe}", timeout=60)
    except requests.RequestException as exc:
        return jsonify({"error": f"Engine WhatsApp indisponível: {exc}"}), 503
    if res.status_code == 404:
        return jsonify({"error": "Mídia não encontrada"}), 404
    if res.status_code >= 400:
        return jsonify({"error": f"Falha ao obter mídia ({res.status_code})"}), 502
    mime = _media_mime(safe, res.headers.get("Content-Type"))
    return Response(res.content, mimetype=mime)
