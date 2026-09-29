"""Pastas e contatos de suporte — conversa direta, fora do Help Desk."""
from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from ..engine_client import EngineError, agent_request
from ..support_routing import is_support_ticket
from .helpdesk import _execute_ai, _fail, _normalize_messages
from ..services.support_knowledge import extract_support_solution, save_support_article

bp = Blueprint("support_contacts", __name__, url_prefix="/helpdesk/api/support")


def _engine(method: str, path: str, **kwargs):
	return agent_request(method, path, **kwargs)


def _require_support_ticket(ticket_id: int) -> dict:
	data = _engine("GET", f"/support-tickets/{ticket_id}")
	ticket = data.get("ticket") if isinstance(data, dict) else None
	if not isinstance(ticket, dict) or not is_support_ticket(ticket.get("status"), ticket.get("isSupport")):
		raise EngineError("Conversa de suporte não encontrada", 404)
	return ticket


def _folder_name(ticket: dict) -> str:
	folder = ticket.get("supportFolder") if isinstance(ticket.get("supportFolder"), dict) else {}
	return str(folder.get("name") or "").strip()


def _history_lines(messages: list) -> list[str]:
	lines: list[str] = []
	for item in messages:
		if not isinstance(item, dict):
			continue
		body = item.get("body") or item.get("message") or item.get("text") or ""
		if not isinstance(body, str) or not body.strip():
			continue
		if item.get("fromMe"):
			sender = "Equipe"
		else:
			contact = item.get("contact") if isinstance(item.get("contact"), dict) else {}
			sender = contact.get("name") or "Suporte"
		lines.append(f"{sender}: {body.strip()[:2000]}")
	return lines


def _support_history(ticket_id: int) -> str:
	pages: list[list[str]] = []
	for page in (1, 2, 3):
		data = _engine("GET", f"/messages/{ticket_id}", params={"pageNumber": str(page)}, timeout=20)
		normalized = _normalize_messages(data, ticket_id)
		pages.append(_history_lines(normalized.get("messages") or []))
		if not normalized.get("hasMore"):
			break
	ordered: list[str] = []
	for chunk in reversed(pages):
		ordered.extend(chunk)
	return "\n".join(ordered)[-16000:]


@bp.route("/folders", methods=["GET"])
@login_required
def list_folders():
	try:
		return jsonify(_engine("GET", "/support-folders"))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/folders", methods=["POST"])
@login_required
def create_folder():
	payload = request.get_json(silent=True) or {}
	try:
		data = _engine("POST", "/support-folders", json={"name": payload.get("name") or ""})
		return jsonify(data), 201
	except EngineError as exc:
		return _fail(exc)


@bp.route("/folders/<int:folder_id>", methods=["PUT"])
@login_required
def update_folder(folder_id: int):
	payload = request.get_json(silent=True) or {}
	try:
		return jsonify(_engine("PUT", f"/support-folders/{folder_id}", json={"name": payload.get("name") or ""}))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/folders/<int:folder_id>", methods=["DELETE"])
@login_required
def delete_folder(folder_id: int):
	try:
		return jsonify(_engine("DELETE", f"/support-folders/{folder_id}"))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/contacts", methods=["GET"])
@login_required
def list_contacts():
	params = {}
	folder_id = request.args.get("folderId") or request.args.get("folder_id")
	if folder_id:
		params["folderId"] = folder_id
	try:
		return jsonify(_engine("GET", "/support-contacts", params=params))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/contacts", methods=["POST"])
@login_required
def create_contact():
	payload = request.get_json(silent=True) or {}
	body = {
		"name": payload.get("name") or "",
		"number": payload.get("number") or "",
		"folderId": payload.get("folderId") or payload.get("folder_id"),
		"supportWhatsappId": payload.get("supportWhatsappId")
		if "supportWhatsappId" in payload
		else payload.get("whatsappId"),
	}
	try:
		data = _engine("POST", "/support-contacts", json=body)
		return jsonify(data), 201
	except EngineError as exc:
		return _fail(exc)


@bp.route("/contacts/<int:contact_id>", methods=["PUT"])
@login_required
def update_contact(contact_id: int):
	payload = request.get_json(silent=True) or {}
	body = {
		"name": payload.get("name") or "",
		"number": payload.get("number") or "",
		"folderId": payload.get("folderId") or payload.get("folder_id"),
		"supportWhatsappId": payload.get("supportWhatsappId")
		if "supportWhatsappId" in payload
		else payload.get("whatsappId"),
	}
	try:
		return jsonify(_engine("PUT", f"/support-contacts/{contact_id}", json=body))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/contacts/<int:contact_id>", methods=["DELETE"])
@login_required
def delete_contact(contact_id: int):
	try:
		return jsonify(_engine("DELETE", f"/support-contacts/{contact_id}"))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/contacts/<int:contact_id>/conversation", methods=["POST"])
@login_required
def open_conversation(contact_id: int):
	try:
		data = _engine("POST", f"/support-contacts/{contact_id}/conversation", json={})
		return jsonify(data), 201
	except EngineError as exc:
		return _fail(exc)


@bp.route("/conversations/<int:ticket_id>/messages", methods=["GET"])
@login_required
def list_messages(ticket_id: int):
	try:
		_require_support_ticket(ticket_id)
		data = _engine(
			"GET",
			f"/messages/{ticket_id}",
			params={"pageNumber": request.args.get("pageNumber") or "1"},
		)
		return jsonify(_normalize_messages(data, ticket_id))
	except EngineError as exc:
		return _fail(exc)


@bp.route("/conversations/<int:ticket_id>/messages", methods=["POST"])
@login_required
def send_message(ticket_id: int):
	payload = request.get_json(silent=True) or {}
	body = str(payload.get("body") or payload.get("message") or "").strip()
	if not body:
		return jsonify({"error": "Digite a mensagem."}), 400
	try:
		_require_support_ticket(ticket_id)
		result = _engine("POST", f"/messages/{ticket_id}", json={"body": body})
		if not isinstance(result, (dict, list)):
			return jsonify({"ok": True})
		return jsonify(result)
	except EngineError as exc:
		return _fail(exc)


@bp.route("/conversations/<int:ticket_id>/knowledge/preview", methods=["POST"])
@login_required
def preview_knowledge(ticket_id: int):
	def run():
		ticket = _require_support_ticket(ticket_id)
		history = _support_history(ticket_id)
		draft = extract_support_solution(history, _folder_name(ticket))
		draft["system_name"] = _folder_name(ticket) or draft.get("system_name") or ""
		return draft

	return _execute_ai("support_knowledge", f"support:{ticket_id}", ticket_id, run)


@bp.route("/conversations/<int:ticket_id>/knowledge", methods=["POST"])
@login_required
def save_knowledge(ticket_id: int):
	payload = request.get_json(silent=True) or {}
	try:
		ticket = _require_support_ticket(ticket_id)
	except EngineError as exc:
		return _fail(exc)
	system_name = str(payload.get("system_name") or _folder_name(ticket) or "").strip()
	try:
		article = save_support_article(
			title=str(payload.get("title") or ""),
			problem=str(payload.get("problem") or ""),
			solution=str(payload.get("solution") or ""),
			system_name=system_name,
			user_id=current_user.id,
		)
	except ValueError as exc:
		return jsonify({"error": str(exc)}), 400
	return jsonify(
		{
			"id": article.id,
			"title": article.title,
			"summary": article.summary or "",
			"category_id": article.category_id,
			"category_name": article.category.name if article.category else system_name,
			"url": f"/conhecimento/{article.category_id}",
		}
	), 201
