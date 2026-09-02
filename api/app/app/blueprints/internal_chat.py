"""Chat interno entre colaboradores — BFF autenticado para o engine /chats."""
from __future__ import annotations

import mimetypes
import os
from urllib.parse import urlparse

import requests
from flask import Blueprint, Response, current_app, has_app_context, jsonify, request
from flask_login import current_user, login_required

from ..engine_client import (
    EngineError,
    agent_request,
    engine_health,
    engine_url,
    ensure_agent_map,
    ensure_agent_session,
)
from ..models import HelpDeskAgentMap, User

bp = Blueprint("internal_chat", __name__, url_prefix="/internal-chat")

_MAX_MEDIA_BYTES = 10 * 1024 * 1024

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
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "pdf": "application/pdf",
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


def _fail(exc: EngineError):
    status = int(exc.status_code or 502)
    message = (str(exc) or "").strip() or f"Erro do engine ({status})"
    if status in (502, 503) and "indispon" not in message.lower():
        message = f"Engine WhatsApp indisponível: {message}"
    return jsonify({"error": message, "details": exc.payload}), status


def _rewrite_media_url(url: str | None) -> str | None:
    if not url or not isinstance(url, str):
        return None
    raw = url.strip()
    if not raw or "nopicture" in raw.lower():
        return None
    for prefix in ("/internal-chat/api/media/", "/helpdesk/api/media/"):
        if prefix in raw:
            idx = raw.find(prefix)
            return f"/flask{raw[idx:]}" if raw[idx:].startswith("/") else f"/flask/{raw[idx:]}"

    public_path: str | None = None
    if "/public/" in raw:
        public_path = raw.split("/public/", 1)[1]
    elif raw.startswith("public/"):
        public_path = raw[7:]
    elif raw.startswith("chat-media/") or raw.startswith("avatars/"):
        public_path = raw
    elif raw.startswith("/"):
        parsed = urlparse(raw)
        if parsed.path.startswith("/public/"):
            public_path = parsed.path[len("/public/") :]

    if public_path is not None:
        public_path = public_path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if not public_path or ".." in public_path.split("/"):
            return None
        return f"/flask/internal-chat/api/media/{public_path}"

    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return raw


def _as_int(raw) -> int | None:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _is_placeholder_name(name: str | None) -> bool:
    raw = (name or "").strip()
    return not raw or raw.casefold() in {"colaborador", "conversa"}


def _name_from_engine_user(engine_user_id: int | None, payload_name: str | None = None) -> str | None:
    raw = (payload_name or "").strip()
    if raw and not _is_placeholder_name(raw):
        return raw
    if not engine_user_id or not has_app_context():
        return raw or None
    mapping = HelpDeskAgentMap.query.filter_by(engine_user_id=engine_user_id).first()
    user = getattr(mapping, "user", None) if mapping else None
    looked_up = (getattr(user, "name", None) or "").strip()
    return looked_up or raw or None


def _participant(user: dict | None, fallback_id: int | None = None) -> dict:
    data = user if isinstance(user, dict) else {}
    uid = _as_int(data.get("id")) or fallback_id
    return {
        "id": uid,
        "name": _name_from_engine_user(uid, data.get("name")),
        "avatar": _rewrite_media_url(data.get("avatar")),
    }


def _normalize_chat(chat: dict, engine_user_id: int) -> dict:
    users = chat.get("users") if isinstance(chat.get("users"), list) else []
    participants: list[dict] = []
    unreads = 0
    peer: dict | None = None
    for row in users:
        if not isinstance(row, dict):
            continue
        user = row.get("user") if isinstance(row.get("user"), dict) else {}
        uid = _as_int(user.get("id")) or _as_int(row.get("userId"))
        participant = _participant(user, uid)
        if uid:
            participants.append(participant)
        if uid == engine_user_id:
            unreads = int(row.get("unreads") or 0)
        elif not chat.get("isGroup") and participant:
            peer = participant

    title = (chat.get("title") or "").strip()
    if _is_placeholder_name(title):
        title = ""
    if not chat.get("isGroup") and peer and peer.get("name"):
        title = peer.get("name") or title
    if chat.get("isGroup") and not title:
        title = "Grupo"

    owner = chat.get("owner") if isinstance(chat.get("owner"), dict) else {}
    return {
        "id": chat.get("id"),
        "uuid": chat.get("uuid"),
        "title": title or "Conversa",
        "lastMessage": chat.get("lastMessage") or "",
        "isGroup": bool(chat.get("isGroup")),
        "ownerId": _as_int(chat.get("ownerId")),
        "owner": _participant(owner, _as_int(chat.get("ownerId"))) if owner or chat.get("ownerId") else None,
        "unreads": unreads,
        "peer": peer,
        "participants": participants,
        "createdAt": chat.get("createdAt"),
        "updatedAt": chat.get("updatedAt"),
    }


def _normalize_quoted(quoted: dict | None, engine_user_id: int) -> dict | None:
    if not isinstance(quoted, dict):
        return None
    sender = quoted.get("sender") if isinstance(quoted.get("sender"), dict) else {}
    sender_id = _as_int(quoted.get("senderId")) or _as_int(sender.get("id"))
    return {
        "id": quoted.get("id"),
        "senderId": sender_id,
        "sender": _participant(sender, sender_id) if sender or sender_id else None,
        "message": quoted.get("message") or "",
        "mediaName": quoted.get("mediaName") or None,
        "isDeleted": bool(quoted.get("isDeleted")),
        "mine": sender_id == engine_user_id if sender_id else False,
    }


def _normalize_message(message: dict, engine_user_id: int) -> dict:
    sender = message.get("sender") if isinstance(message.get("sender"), dict) else {}
    sender_id = _as_int(message.get("senderId")) or _as_int(sender.get("id"))
    media_path = message.get("mediaPath") or ""
    media_url = _rewrite_media_url(media_path) if media_path else None
    return {
        "id": message.get("id"),
        "chatId": message.get("chatId"),
        "senderId": sender_id,
        "sender": _participant(sender, sender_id),
        "message": message.get("message") or "",
        "mediaPath": media_path or None,
        "mediaName": message.get("mediaName") or None,
        "mediaUrl": media_url,
        "mine": sender_id == engine_user_id,
        "isDeleted": bool(message.get("isDeleted")),
        "isEdited": bool(message.get("isEdited")),
        "quotedMsgId": message.get("quotedMsgId"),
        "quotedMsg": _normalize_quoted(message.get("quotedMsg"), engine_user_id),
        "createdAt": message.get("createdAt"),
        "updatedAt": message.get("updatedAt"),
    }


def _quoted_msg_id(payload: dict | None, form=None) -> int | None:
    raw = None
    if form is not None:
        raw = form.get("quotedMsgId") or form.get("quotedMsg")
    if raw is None and isinstance(payload, dict):
        quoted = payload.get("quotedMsgId") or payload.get("quotedMsg")
        if isinstance(quoted, dict):
            raw = quoted.get("id")
        else:
            raw = quoted
    return _as_int(raw)


def _user_ids_from_payload(payload: dict) -> list[dict]:
    raw = payload.get("users") or payload.get("userIds") or []
    ids: list[int] = []
    if not isinstance(raw, list):
        return []
    for item in raw:
        if isinstance(item, dict):
            uid = _as_int(item.get("engine_user_id") or item.get("id"))
        else:
            uid = _as_int(item)
        if uid and uid not in ids:
            ids.append(uid)
    return [{"id": uid} for uid in ids]


def _assert_owner(chat: dict, engine_user_id: int) -> EngineError | None:
    owner_id = _as_int(chat.get("ownerId"))
    if owner_id and owner_id != engine_user_id:
        return EngineError("Apenas o criador do grupo pode alterá-lo.", 403)
    return None


def _find_chat(chat_id: int, engine_user_id: int) -> dict | None:
    page = 1
    while page <= 20:
        data = agent_request("GET", "/chats", params={"pageNumber": str(page), "pageSize": "100"}) or {}
        records = data.get("records") if isinstance(data, dict) else []
        for row in records or []:
            if isinstance(row, dict) and _as_int(row.get("id")) == chat_id:
                return _normalize_chat(row, engine_user_id)
        if not (isinstance(data, dict) and data.get("hasMore")):
            break
        page += 1
    return None


@bp.route("/api/health")
@login_required
def health():
    try:
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


@bp.route("/api/nav-badge")
@login_required
def nav_badge():
    try:
        data = agent_request("GET", "/chats/unread-count") or {}
        count = int(data.get("count") or 0) if isinstance(data, dict) else 0
        return jsonify({"count": max(0, count)})
    except EngineError as exc:
        if exc.status_code in (404, 501):
            try:
                session = ensure_agent_session()
                data = agent_request("GET", "/chats", params={"pageNumber": "1", "pageSize": "100"}) or {}
                records = data.get("records") if isinstance(data, dict) else []
                total = 0
                for row in records or []:
                    if isinstance(row, dict):
                        total += _normalize_chat(row, session.engine_user_id).get("unreads") or 0
                return jsonify({"count": total})
            except EngineError as inner:
                return jsonify({"count": 0, "error": str(inner)})
        return jsonify({"count": 0, "error": str(exc)})


@bp.route("/api/colleagues")
@login_required
def colleagues():
    try:
        ensure_agent_session()
    except EngineError as exc:
        return _fail(exc)

    rows = (
        User.query.filter(User.status == "1", User.id != current_user.id)
        .order_by(User.name.asc())
        .all()
    )
    items = []
    for user in rows:
        mapping = HelpDeskAgentMap.query.filter_by(computicket_user_id=user.id).first()
        if not mapping:
            try:
                mapping = ensure_agent_map(user)
            except EngineError:
                continue
        if not mapping:
            continue
        items.append(
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "engine_user_id": mapping.engine_user_id,
            }
        )
    return jsonify({"items": items})


@bp.route("/api/chats")
@login_required
def list_chats():
    try:
        session = ensure_agent_session()
        is_group = request.args.get("isGroup")
        page_number = request.args.get("pageNumber") or "1"
        params: dict[str, str] = {"pageNumber": page_number, "pageSize": request.args.get("pageSize") or "50"}
        if is_group in {"true", "false"}:
            params["isGroup"] = is_group
        data = agent_request("GET", "/chats", params=params) or {}
        records = data.get("records") if isinstance(data, dict) else []
        normalized = [
            _normalize_chat(row, session.engine_user_id)
            for row in (records or [])
            if isinstance(row, dict)
        ]
        return jsonify(
            {
                "records": normalized,
                "count": data.get("count") if isinstance(data, dict) else len(normalized),
                "hasMore": bool(data.get("hasMore")) if isinstance(data, dict) else False,
                "engineUserId": session.engine_user_id,
            }
        )
    except EngineError as exc:
        return _fail(exc)


@bp.route("/api/chats", methods=["POST"])
@login_required
def create_chat():
    payload = request.get_json(silent=True) or {}
    title = str(payload.get("title") or "").strip()
    users = _user_ids_from_payload(payload)
    if not title:
        return jsonify({"error": "Informe o nome do grupo."}), 400
    if len(users) < 1:
        return jsonify({"error": "Selecione pelo menos um colaborador."}), 400
    try:
        session = ensure_agent_session()
        data = agent_request(
            "POST",
            "/chats",
            json={"title": title, "users": users, "isGroup": True},
        )
        if not isinstance(data, dict):
            return jsonify({"ok": True})
        return jsonify(_normalize_chat(data, session.engine_user_id))
    except EngineError as exc:
        return _fail(exc)


@bp.route("/api/chats/<int:chat_id>", methods=["PUT"])
@login_required
def update_chat(chat_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        session = ensure_agent_session()
        existing = _find_chat(chat_id, session.engine_user_id)
        if not existing:
            return jsonify({"error": "Conversa não encontrada."}), 404
        denied = _assert_owner(existing, session.engine_user_id)
        if denied:
            return _fail(denied)
        body: dict = {}
        if "title" in payload:
            title = str(payload.get("title") or "").strip()
            if not title:
                return jsonify({"error": "Informe o nome do grupo."}), 400
            body["title"] = title
        if "users" in payload or "userIds" in payload:
            users = _user_ids_from_payload(payload)
            if len(users) < 1:
                return jsonify({"error": "Selecione pelo menos um colaborador."}), 400
            body["users"] = users
        data = agent_request("PUT", f"/chats/{chat_id}", json=body)
        if not isinstance(data, dict):
            return jsonify(existing)
        return jsonify(_normalize_chat(data, session.engine_user_id))
    except EngineError as exc:
        return _fail(exc)


@bp.route("/api/chats/<int:chat_id>", methods=["DELETE"])
@login_required
def delete_chat(chat_id: int):
    try:
        session = ensure_agent_session()
        existing = _find_chat(chat_id, session.engine_user_id)
        if not existing:
            return jsonify({"error": "Conversa não encontrada."}), 404
        denied = _assert_owner(existing, session.engine_user_id)
        if denied:
            return _fail(denied)
        agent_request("DELETE", f"/chats/{chat_id}")
        return jsonify({"ok": True, "id": chat_id})
    except EngineError as exc:
        return _fail(exc)


@bp.route("/api/chats/<int:chat_id>/messages")
@login_required
def list_messages(chat_id: int):
    try:
        session = ensure_agent_session()
        page = request.args.get("pageNumber") or "1"
        data = agent_request("GET", f"/chats/{chat_id}/messages", params={"pageNumber": page}) or {}
        records = data.get("records") if isinstance(data, dict) else []
        normalized = [
            _normalize_message(row, session.engine_user_id)
            for row in (records or [])
            if isinstance(row, dict)
        ]
        return jsonify(
            {
                "records": normalized,
                "count": data.get("count") if isinstance(data, dict) else len(normalized),
                "hasMore": bool(data.get("hasMore")) if isinstance(data, dict) else False,
            }
        )
    except EngineError as exc:
        return _fail(exc)


@bp.route("/api/chats/<int:chat_id>/messages", methods=["POST"])
@login_required
def send_message(chat_id: int):
    try:
        session = ensure_agent_session()
        if request.files:
            storage = request.files.get("media") or next(iter(request.files.values()), None)
            if storage is None:
                return jsonify({"error": "Arquivo não enviado."}), 400
            stream = storage.stream
            size = None
            if hasattr(stream, "seek") and hasattr(stream, "tell"):
                try:
                    stream.seek(0, os.SEEK_END)
                    size = stream.tell()
                    stream.seek(0)
                except (OSError, ValueError):
                    size = None
            if size is not None and size > _MAX_MEDIA_BYTES:
                return jsonify({"error": "Arquivo muito grande. O chat interno aceita no máximo 10 MB."}), 413
            filename = storage.filename or "arquivo"
            files = [
                (
                    "media",
                    (filename, stream, storage.mimetype or _media_mime(filename)),
                )
            ]
            data = {"message": request.form.get("message") or ""}
            quoted_id = _quoted_msg_id(None, request.form)
            if quoted_id:
                data["quotedMsgId"] = str(quoted_id)
            result = agent_request(
                "POST",
                f"/chats/{chat_id}/messages",
                files=files,
                data=data,
                timeout=(30, 120),
            )
        else:
            payload = request.get_json(silent=True) or {}
            message = str(payload.get("message") or payload.get("body") or "").strip()
            if not message:
                return jsonify({"error": "Digite uma mensagem."}), 400
            data = {"message": message}
            quoted_id = _quoted_msg_id(payload)
            if quoted_id:
                data["quotedMsgId"] = quoted_id
            result = agent_request(
                "POST",
                f"/chats/{chat_id}/messages",
                json=data,
            )
        if not isinstance(result, dict):
            return jsonify({"ok": True})
        return jsonify(_normalize_message(result, session.engine_user_id))
    except EngineError as exc:
        return _fail(exc)
    except Exception:
        current_app.logger.exception("Falha ao enviar mensagem no chat interno")
        if request.files:
            return jsonify({"error": "Não foi possível enviar o arquivo. Tente novamente."}), 500
        return jsonify({"error": "Não foi possível enviar a mensagem. Tente novamente."}), 500


@bp.route("/api/chats/<int:chat_id>/messages/<int:message_id>", methods=["PUT"])
@login_required
def edit_message(chat_id: int, message_id: int):
    try:
        session = ensure_agent_session()
        payload = request.get_json(silent=True) or {}
        message = str(payload.get("message") or payload.get("body") or "").strip()
        if not message:
            return jsonify({"error": "Digite o novo texto da mensagem."}), 400
        result = agent_request(
            "PUT",
            f"/chats/{chat_id}/messages/{message_id}",
            json={"message": message},
        )
        if not isinstance(result, dict):
            return jsonify({"ok": True})
        return jsonify(_normalize_message(result, session.engine_user_id))
    except EngineError as exc:
        return _fail(exc)
    except Exception:
        current_app.logger.exception("Falha ao editar mensagem no chat interno")
        return jsonify({"error": "Não foi possível editar a mensagem. Tente novamente."}), 500


@bp.route("/api/chats/<int:chat_id>/messages/<int:message_id>", methods=["DELETE"])
@login_required
def delete_message(chat_id: int, message_id: int):
    try:
        session = ensure_agent_session()
        result = agent_request("DELETE", f"/chats/{chat_id}/messages/{message_id}")
        if not isinstance(result, dict):
            return jsonify({"ok": True})
        return jsonify(_normalize_message(result, session.engine_user_id))
    except EngineError as exc:
        return _fail(exc)
    except Exception:
        current_app.logger.exception("Falha ao excluir mensagem no chat interno")
        return jsonify({"error": "Não foi possível excluir a mensagem. Tente novamente."}), 500


@bp.route("/api/chats/<int:chat_id>/read", methods=["POST"])
@login_required
def mark_read(chat_id: int):
    try:
        session = ensure_agent_session()
        result = agent_request(
            "POST",
            f"/chats/{chat_id}/read",
            json={"userId": session.engine_user_id},
        )
        if isinstance(result, dict):
            return jsonify(_normalize_chat(result, session.engine_user_id))
        return jsonify({"ok": True, "id": chat_id})
    except EngineError as exc:
        return _fail(exc)


@bp.route("/api/media/<path:filename>")
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
