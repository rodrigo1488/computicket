"""Contexto do agente de WhatsApp: base de conhecimento e técnicos da agenda."""
from __future__ import annotations

import os
import re

from flask import request

from ..models import HelpDeskAgentMap, User
from .copilot import CopilotError, answer_question


def phone_key(value: str) -> str:
	digits = re.sub(r"\D", "", value or "")
	if digits.startswith("55") and len(digits) > 11:
		digits = digits[2:]
	if len(digits) < 10:
		return ""
	return digits[-11:]


def find_technician_by_phone(phone: str) -> dict | None:
	wanted = phone_key(phone)
	if not wanted:
		return None
	staff_roles = {"tecnico", "admin", "administrador", "administrator"}
	for user in User.query.filter(User.status == "1", User.phone.isnot(None)).all():
		role = (user.role or "tecnico").strip().lower()
		if role not in staff_roles:
			continue
		if phone_key(user.phone or "") == wanted:
			return {"id": user.id, "name": user.name}
	return None


_PRIVATE_ROSTER = re.compile(
	r"(?i)(?:"
	r"\b(?:quais|quem|liste|lista|listar|mostra|mostre|me passa|me fala|quero ver)\b[\s\S]{0,80}\b(?:atendimentos?|chamados?|clientes?|empresas?|conversas?)\b"
	r"|\b(?:atendimentos?|chamados?|clientes?|empresas?)\b[\s\S]{0,50}\b(?:abert\w*|em andamento|pendentes?|de hoje|da empresa|cadastrad\w*)\b"
	r"|\b(?:outros?|demais|todos os|todas as)\s+(?:clientes?|atendimentos?|chamados?|empresas?)\b"
	r")"
)


def customer_asks_for_private_records(text: str) -> bool:
	"""Pedido de lista da operação: outros clientes, chamados ou atendimentos."""
	return bool(_PRIVATE_ROSTER.search(text or ""))


def internal_token_ok() -> bool:
	expected = (
		os.environ.get("COMPUTICKET_INTERNAL_TOKEN")
		or os.environ.get("SECRET_KEY")
		or ""
	).strip()
	provided = (request.headers.get("X-Internal-Token") or "").strip()
	return bool(expected) and provided == expected


def build_agent_context(
	question: str,
	history: str = "",
	include_knowledge: bool = True,
	audience: str = "staff",
) -> dict:
	draft = ""
	sources: list[dict] = []
	text = (question or "").strip()
	customer = (audience or "staff").strip().lower() == "customer"
	# O cliente final não recebe chamados, cofre, orçamentos nem conversas de outras pessoas.
	if customer and customer_asks_for_private_records(text):
		include_knowledge = False
	if include_knowledge and text:
		try:
			result = answer_question(text, history or "", public_only=customer)
			sources = [
				item
				for item in (result.get("sources") or [])
				if isinstance(item, dict) and (not customer or item.get("source_type") == "knowledge_article")
			]
			if sources:
				draft = str(result.get("draft") or "").strip()
		except CopilotError:
			sources = []
			draft = ""
	engine_by_user = {
		row.computicket_user_id: row.engine_user_id
		for row in HelpDeskAgentMap.query.all()
	}
	technicians = [
		{
			"id": user.id,
			"name": user.name,
			"engine_user_id": engine_by_user.get(user.id),
		}
		for user in User.query.filter(User.status == "1").order_by(User.name.asc()).all()
		if user.name
	]
	public_sources = [
		{
			"title": item.get("title") or "",
			"snippet": str(item.get("snippet") or "")[:500],
			"source_type": item.get("source_type") or "",
		}
		for item in sources
		if isinstance(item, dict)
	]
	return {
		"draft": draft,
		"has_evidence": bool(public_sources),
		"sources": public_sources,
		"technicians": technicians,
	}
