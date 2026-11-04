"""Contexto do agente de WhatsApp: base de conhecimento e técnicos da agenda."""
from __future__ import annotations

import os

from flask import request

from ..models import User
from .copilot import CopilotError, answer_question


def internal_token_ok() -> bool:
	expected = (
		os.environ.get("COMPUTICKET_INTERNAL_TOKEN")
		or os.environ.get("SECRET_KEY")
		or ""
	).strip()
	provided = (request.headers.get("X-Internal-Token") or "").strip()
	return bool(expected) and provided == expected


def build_agent_context(question: str, history: str = "") -> dict:
	draft = ""
	sources: list[dict] = []
	text = (question or "").strip()
	if text:
		try:
			result = answer_question(text, history or "")
			sources = list(result.get("sources") or [])
			if sources:
				draft = str(result.get("draft") or "").strip()
		except CopilotError:
			sources = []
			draft = ""
	technicians = [
		{"id": user.id, "name": user.name}
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
