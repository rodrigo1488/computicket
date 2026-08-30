"""Serviço de geração assistida com contexto RAG."""
from __future__ import annotations

import json
from typing import Any

from .gemini_client import GeminiConfigError, generation_model, get_client
from .rag import hybrid_search, sanitize_for_rag

MAX_INPUT_CHARS = 12000
MAX_HISTORY_CHARS = 16000


class CopilotError(RuntimeError):
	def __init__(self, message: str, code: str = "gemini_error", status_code: int = 502):
		super().__init__(message)
		self.code = code
		self.status_code = status_code


def _trim(value: str | None, limit: int) -> str:
	return sanitize_for_rag(value or "")[:limit]


def _source_context(sources: list[dict]) -> str:
	return "\n\n".join(
		f"[{index}] {item['source_type']} #{item['source_id']} — {item['title']}\n{item['snippet']}"
		for index, item in enumerate(sources, 1)
	)


def _generate(contents: str, system: str, schema: dict[str, Any]) -> dict[str, Any]:
	try:
		response = get_client().models.generate_content(
			model=generation_model(),
			contents=contents,
			config={
				"system_instruction": system,
				"response_mime_type": "application/json",
				"response_json_schema": schema,
				"temperature": 0.25,
			},
		)
	except GeminiConfigError as exc:
		raise CopilotError(str(exc), "gemini_config", 503) from exc
	except Exception as exc:
		raise CopilotError(f"Falha ao consultar o Gemini: {exc}") from exc
	text = (getattr(response, "text", None) or "").strip()
	try:
		data = json.loads(text)
	except (json.JSONDecodeError, TypeError) as exc:
		raise CopilotError("O Gemini retornou uma resposta inválida.", "invalid_response") from exc
	if not isinstance(data, dict):
		raise CopilotError("O Gemini retornou um formato inesperado.", "invalid_response")
	return data


def _prepare(query: str, history: str = "") -> tuple[str, str, list[dict]]:
	query = _trim(query, MAX_INPUT_CHARS)
	history = _trim(history, MAX_HISTORY_CHARS)
	if not query:
		raise CopilotError("Informe um texto para o Copiloto.", "validation", 400)
	search_query = f"{query} {history[-3000:]}".strip()
	return query, history, hybrid_search(search_query)


def answer_question(question: str, history: str = "") -> dict:
	question, history, sources = _prepare(question, history)
	if not sources:
		return {
			"draft": (
				"Não encontrei evidências suficientes na base de conhecimento ou "
				"nos tickets fechados para responder com segurança."
			),
			"sources": [],
		}
	data = _generate(
		f"PERGUNTA:\n{question}\n\nHISTÓRICO MÍNIMO:\n{history}\n\nFONTES:\n{_source_context(sources)}",
		(
			"Você é o Copiloto de suporte do Computicket. Responda em português do Brasil, "
			"objetivamente. Use as fontes como base factual e não invente credenciais, procedimentos "
			"ou fatos ausentes. Nunca peça nem reproduza senhas, tokens ou dados pessoais. "
			"Retorne JSON com o campo draft."
		),
		{"type": "object", "properties": {"draft": {"type": "string"}}, "required": ["draft"]},
	)
	return {"draft": str(data.get("draft") or "").strip(), "sources": sources}


def suggest_reply(instruction: str, history: str) -> dict:
	query = instruction.strip() or "Sugira a próxima resposta adequada para esta conversa."
	query, history, sources = _prepare(query, history)
	data = _generate(
		f"INSTRUÇÃO:\n{query}\n\nCONVERSA:\n{history}\n\nFONTES:\n{_source_context(sources)}",
		(
			"Escreva apenas uma resposta profissional pronta para envio ao cliente, em português do Brasil. "
			"Seja cordial e breve, não afirme ações não realizadas e não exponha dados sensíveis. "
			"Use as fontes quando relevantes. Retorne JSON com draft."
		),
		{"type": "object", "properties": {"draft": {"type": "string"}}, "required": ["draft"]},
	)
	return {"draft": str(data.get("draft") or "").strip(), "sources": sources}


def improve_draft(text: str, history: str) -> dict:
	text, history, sources = _prepare(text, history)
	data = _generate(
		f"RASCUNHO:\n{text}\n\nCONVERSA:\n{history}\n\nFONTES:\n{_source_context(sources)}",
		(
			"Melhore clareza, gramática e tom profissional do rascunho sem mudar seu sentido nem inventar fatos. "
			"Não inclua credenciais ou dados pessoais. Retorne JSON com draft."
		),
		{"type": "object", "properties": {"draft": {"type": "string"}}, "required": ["draft"]},
	)
	return {"draft": str(data.get("draft") or "").strip(), "sources": sources}


def suggest_ticket(history: str, requester: str = "") -> dict:
	query, history, sources = _prepare("Estruture um ticket a partir da conversa.", history)
	schema = {
		"type": "object",
		"properties": {
			"ticket": {
				"type": "object",
				"properties": {
					"title": {"type": "string"},
					"description": {"type": "string"},
					"solicitante": {"type": "string"},
					"clientQuery": {"type": "string"},
				},
				"required": ["title", "description", "solicitante", "clientQuery"],
			}
		},
		"required": ["ticket"],
	}
	data = _generate(
		f"CONVERSA:\n{history}\n\nSOLICITANTE CONHECIDO:\n{_trim(requester, 200)}"
		f"\n\nFONTES:\n{_source_context(sources)}",
		(
			"Converta a conversa em um ticket técnico estruturado. Não invente cliente, solicitante, "
			"diagnóstico ou resolução. clientQuery deve resumir o pedido original para busca de cliente. "
			"Retorne somente o JSON solicitado."
		),
		schema,
	)
	ticket = data.get("ticket") if isinstance(data.get("ticket"), dict) else {}
	return {
		"ticket": {
			"title": str(ticket.get("title") or "")[:200],
			"description": str(ticket.get("description") or ""),
			"solicitante": str(ticket.get("solicitante") or requester or "")[:200],
			"clientQuery": str(ticket.get("clientQuery") or "")[:200],
		},
		"sources": sources,
	}
