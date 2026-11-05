"""Resumo estruturado de uma conversa do Help Desk.

O job lê o histórico do motor, grava os campos no chamado e indexa o texto
sanitizado. A nota interna não leva o histórico.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any

from .. import db
from ..engine_client import EngineError, admin_request, send_engine_message
from ..models import AIAuditLog, HelpDeskAiInsight, HelpDeskContactClientLink
from .copilot import CopilotError, _generate
from .rag import hybrid_search, index_source, sanitize_for_rag

_EMPTY = {"", "não informado", "nao informado", "nenhuma", "sem solução", "sem solucao", "n/a"}
_FIELDS = (
	("problema", "Problema"),
	("diagnostico", "Diagnóstico"),
	("procedimentos", "Procedimentos"),
	("solucao", "Solução"),
	("pendencias", "Pendências"),
	("proxima_acao", "Próxima ação"),
)


def stated_solution(value: str | None) -> str:
	text = (value or "").replace("\n", " ").strip()
	if text.lower() in _EMPTY:
		return ""
	return text


def _clean_field(value: Any, *, solution: bool = False) -> str:
	text = sanitize_for_rag(str(value or ""))[:2000].strip()
	if solution:
		return stated_solution(text)
	if text.lower() in _EMPTY:
		return ""
	return text


def format_summary_note(fields: dict[str, str]) -> str:
	lines = ["*Resumo do atendimento*"]
	for key, label in _FIELDS:
		value = stated_solution(fields.get(key)) if key == "solucao" else (fields.get(key) or "").strip()
		if key == "solucao" and not value:
			continue
		lines.append(f"- *{label}:* {value or 'Não informado'}")
	return "\n".join(lines)


def _audit(operation: str, prompt: str, conversation_id: int | None, status: str, started: float, error_code: str | None = None) -> None:
	try:
		db.session.add(
			AIAuditLog(
				user_id=None,
				operation=operation[:40],
				conversation_id=conversation_id,
				prompt_hash=hashlib.sha256((prompt or "").encode("utf-8")).hexdigest(),
				input_chars=len(prompt or ""),
				source_count=0,
				status=status,
				error_code=error_code,
				duration_ms=int((time.monotonic() - started) * 1000),
			)
		)
		db.session.commit()
	except Exception:
		db.session.rollback()


def _insight(engine_ticket_id: int) -> HelpDeskAiInsight:
	row = HelpDeskAiInsight.query.filter_by(engine_ticket_id=int(engine_ticket_id)).first()
	if row is None:
		row = HelpDeskAiInsight(engine_ticket_id=int(engine_ticket_id), status="pending")
		db.session.add(row)
	return row


def _transcript_from_engine(engine_ticket_id: int) -> tuple[str, str, int | None]:
	ticket = admin_request("GET", f"/tickets/{int(engine_ticket_id)}", timeout=20) or {}
	data = admin_request("GET", f"/messages/{int(engine_ticket_id)}", params={"pageNumber": "1"}, timeout=25) or {}
	messages = data.get("messages") if isinstance(data, dict) else data
	if isinstance(data, dict) and isinstance(data.get("messages"), list):
		messages = data["messages"]
	elif not isinstance(messages, list):
		messages = []
	contact = ticket.get("contact") if isinstance(ticket, dict) and isinstance(ticket.get("contact"), dict) else {}
	client_name = str(contact.get("name") or "Cliente")[:200]
	contact_id = contact.get("id") or (ticket.get("contactId") if isinstance(ticket, dict) else None)
	external_client_id = None
	try:
		if contact_id is not None:
			link = HelpDeskContactClientLink.query.filter_by(engine_contact_id=int(contact_id)).first()
			if link:
				external_client_id = link.external_client_id
				if link.external_client_name:
					client_name = link.external_client_name[:200]
	except (TypeError, ValueError):
		external_client_id = None
	lines: list[str] = []
	for item in messages if isinstance(messages, list) else []:
		if not isinstance(item, dict) or item.get("isInternal"):
			continue
		body = item.get("body") or ""
		if not isinstance(body, str) or not body.strip():
			continue
		who = "Atendente" if item.get("fromMe") else "Cliente"
		lines.append(f"{who}: {body.strip()[:500]}")
	transcript = sanitize_for_rag("\n".join(lines))[-16000:]
	return transcript, client_name, external_client_id


def _ask_gemini(transcript: str) -> dict[str, str]:
	sources = hybrid_search(transcript[-3000:], limit=4)
	fontes = "\n".join(
		f"[{index}] {item.get('title')}: {item.get('snippet')}"
		for index, item in enumerate(sources, 1)
	) or "(nenhuma)"
	data = _generate(
		f"MENSAGENS:\n{transcript[-12000:]}\n\nFONTES:\n{fontes}",
		(
			"Resuma o atendimento em português, só com fatos das mensagens e das fontes. "
			"Não invente diagnóstico, procedimento nem solução. "
			"solucao fica vazia se as mensagens ou as fontes não trouxerem um jeito concreto de resolver. "
			"Não copie o histórico. Retorne JSON."
		),
		{
			"type": "object",
			"properties": {
				"problema": {"type": "string"},
				"diagnostico": {"type": "string"},
				"procedimentos": {"type": "string"},
				"solucao": {"type": "string"},
				"pendencias": {"type": "string"},
				"proxima_acao": {"type": "string"},
			},
			"required": ["problema", "diagnostico", "procedimentos", "solucao", "pendencias", "proxima_acao"],
		},
	)
	return {
		"problema": _clean_field(data.get("problema")),
		"diagnostico": _clean_field(data.get("diagnostico")),
		"procedimentos": _clean_field(data.get("procedimentos")),
		"solucao": _clean_field(data.get("solucao"), solution=True),
		"pendencias": _clean_field(data.get("pendencias")),
		"proxima_acao": _clean_field(data.get("proxima_acao")),
	}


def apply_summary_fields(engine_ticket_id: int, fields: dict[str, Any], *, transcript: str | None = None, client_name: str | None = None, external_client_id: int | None = None, status: str = "ready") -> HelpDeskAiInsight:
	if "proxima_acao" not in fields and fields.get("proximaAcao") is not None:
		fields = {**fields, "proxima_acao": fields.get("proximaAcao")}
	row = _insight(engine_ticket_id)
	if client_name:
		row.client_name = client_name[:200]
	if external_client_id is not None:
		row.external_client_id = external_client_id
	if transcript is not None:
		row.transcript = sanitize_for_rag(transcript)[-16000:]
	for key, _label in _FIELDS:
		if key in fields:
			setattr(row, key, _clean_field(fields.get(key), solution=key == "solucao"))
	row.status = status
	row.error_message = None
	db.session.commit()
	return row


def run_summarize(engine_ticket_id: int, *, post_note: bool = True) -> dict:
	"""Lê o motor, grava o resumo e indexa. A nota interna sai sem o histórico."""
	started = time.monotonic()
	prompt = f"summarize:{engine_ticket_id}"
	row = _insight(engine_ticket_id)
	row.status = "pending"
	row.error_message = None
	db.session.commit()
	try:
		transcript, client_name, external_client_id = _transcript_from_engine(engine_ticket_id)
	except EngineError as exc:
		row.status = "error"
		row.error_message = str(exc)[:300]
		db.session.commit()
		_audit("summarize_conversation", prompt, engine_ticket_id, "error", started, "engine_error")
		raise
	if not transcript.strip():
		row.status = "error"
		row.error_message = "Sem mensagens para resumir."
		row.client_name = client_name
		row.external_client_id = external_client_id
		db.session.commit()
		_audit("summarize_conversation", prompt, engine_ticket_id, "error", started, "empty")
		return row.to_dict()
	try:
		fields = _ask_gemini(transcript)
	except CopilotError as exc:
		row.status = "error"
		row.error_message = str(exc)[:300]
		db.session.commit()
		_audit("summarize_conversation", prompt, engine_ticket_id, "error", started, exc.code)
		raise
	row = apply_summary_fields(
		engine_ticket_id,
		fields,
		transcript=transcript,
		client_name=client_name,
		external_client_id=external_client_id,
	)
	try:
		index_source("helpdesk_conversation", int(engine_ticket_id))
	except Exception:
		db.session.rollback()
	if post_note:
		try:
			send_engine_message(int(engine_ticket_id), format_summary_note(fields), internal=True)
		except EngineError:
			pass
	_audit("summarize_conversation", prompt, engine_ticket_id, "success", started)
	return row.to_dict()
