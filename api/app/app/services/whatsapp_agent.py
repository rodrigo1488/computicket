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


def internal_token_ok() -> bool:
	expected = (
		os.environ.get("COMPUTICKET_INTERNAL_TOKEN")
		or os.environ.get("SECRET_KEY")
		or ""
	).strip()
	provided = (request.headers.get("X-Internal-Token") or "").strip()
	return bool(expected) and provided == expected


def build_agent_context(question: str, history: str = "", include_knowledge: bool = True) -> dict:
	draft = ""
	sources: list[dict] = []
	text = (question or "").strip()
	if include_knowledge and text:
		try:
			result = answer_question(text, history or "")
			sources = list(result.get("sources") or [])
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
