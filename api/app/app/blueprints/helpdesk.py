"""Help Desk WhatsApp — BFF autenticado para o engine Compuchat/Baileys."""
from __future__ import annotations

import random

from flask import Blueprint, Response, jsonify, request
from flask_login import current_user, login_required

from .. import db
from ..engine_client import (
    EngineError,
    admin_request,
    agent_request,
    engine_health,
    engine_url,
    ensure_agent_map,
    ensure_agent_session,
    ensure_default_queue,
    send_engine_message,
)
from ..models import HelpDeskAgentMap, HelpDeskTicketLink, Ticket, User

helpdesk_bp = Blueprint("helpdesk", __name__, url_prefix="/helpdesk")


def _fail(exc: EngineError):
    return jsonify({"error": str(exc), "details": exc.payload}), exc.status_code


def _links_by_engine_ids(ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = HelpDeskTicketLink.query.filter(HelpDeskTicketLink.engine_ticket_id.in_(ids)).all()
    return {row.engine_ticket_id: row.computicket_ticket_id for row in rows}


def _with_link(ticket: dict | None) -> dict | None:
    if not ticket:
        return ticket
    engine_id = ticket.get("id")
    if engine_id is None:
        return ticket
    row = HelpDeskTicketLink.query.filter_by(engine_ticket_id=int(engine_id)).first()
    ticket = dict(ticket)
    ticket["computicket_ticket_id"] = row.computicket_ticket_id if row else None
    return ticket


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
        return jsonify(
            {
                "token": session.token,
                "companyId": session.company_id,
                "engineUserId": session.engine_user_id,
                "engineUrl": engine_url(),
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
    links = _links_by_engine_ids([t.get("id") for t in tickets if t.get("id") is not None])
    for ticket in tickets:
        ticket["computicket_ticket_id"] = links.get(ticket.get("id"))
    if isinstance(data, dict):
        data["tickets"] = tickets
        return jsonify(data)
    return jsonify({"tickets": tickets, "count": len(tickets), "hasMore": False})


@helpdesk_bp.route("/api/conversations/<int:ticket_id>")
@login_required
def show_conversation(ticket_id: int):
    try:
        ticket = agent_request("GET", f"/tickets/{ticket_id}")
        return jsonify(_with_link(ticket))
    except EngineError as exc:
        return _fail(exc)


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
        ticket = agent_request("PUT", f"/tickets/{ticket_id}", json={"status": "closed"})
        return jsonify(_with_link(ticket.get("ticket") if isinstance(ticket, dict) and "ticket" in ticket else ticket))
    except EngineError as exc:
        return _fail(exc)


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
    if row:
        row.computicket_ticket_id = ticket.id
    else:
        row = HelpDeskTicketLink(engine_ticket_id=ticket_id, computicket_ticket_id=ticket.id)
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


@helpdesk_bp.route("/api/contacts/<int:contact_id>")
@login_required
def show_contact(contact_id: int):
    try:
        data = agent_request("GET", f"/contacts/{contact_id}")
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


@helpdesk_bp.route("/api/contacts/<int:contact_id>", methods=["PUT"])
@login_required
def update_contact(contact_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        existing = agent_request("GET", f"/contacts/{contact_id}") or {}
        body = {
            "name": (payload.get("name") or existing.get("name") or "").strip(),
            "number": existing.get("number") or payload.get("number") or "",
            "email": payload.get("email") if "email" in payload else (existing.get("email") or ""),
            "extraInfo": payload.get("extraInfo") if "extraInfo" in payload else (existing.get("extraInfo") or []),
        }
        data = agent_request("PUT", f"/contacts/{contact_id}", json=body)
        return jsonify(data)
    except EngineError as exc:
        return _fail(exc)


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
    try:
        content = admin_request("GET", f"/public/{filename}", timeout=60)
    except EngineError as exc:
        return _fail(exc)
    if not isinstance(content, (bytes, bytearray)):
        return jsonify({"error": "Mídia inválida"}), 502
    return Response(content, mimetype="application/octet-stream")
