"""Classifica um chamado aguardando sem movê-lo.

A fila e o técnico só entram se existirem de verdade. A correção humana
substitui o JSON.
"""
from __future__ import annotations

import json
import unicodedata
from typing import Any

from .. import db
from ..engine_client import ensure_default_queue
from ..models import HelpDeskAgentMap, HelpDeskAiInsight, User
from .conversation_summary import _audit, _transcript_from_engine
from .copilot import CopilotError, _generate

_PRIORITIES = {"baixa", "normal", "alta"}
_INTENTS = {"consulta", "problema"}
_SYSTEMS = {
	"clipp": "CLIPP",
	"uniplus": "UniPlus",
	"arpa": "ARPA",
	"mais gestao": "Mais Gestão",
	"mais gestão": "Mais Gestão",
}


def _norm(value: str | None) -> str:
	text = unicodedata.normalize("NFKD", value or "")
	text = "".join(char for char in text if not unicodedata.combining(char))
	return " ".join(text.casefold().split())


def match_named(value: str | None, options: list[str]) -> str:
	wanted = _norm(value)
	if not wanted or not options:
		return ""
	exact = [item for item in options if _norm(item) == wanted]
	if len(exact) == 1:
		return exact[0]
	first = wanted.split(" ")[0]
	if len(first) < 3:
		return ""
	hits = [item for item in options if _norm(item).split(" ")[0] == first]
	return hits[0] if len(hits) == 1 else ""


def _system_name(value: str | None, transcript: str) -> str:
	raw = (value or "").strip()
	canon = _SYSTEMS.get(_norm(raw))
	if canon:
		return canon
	if raw and _norm(raw) in _norm(transcript):
		return raw[:80]
	return ""


def _people_names() -> list[str]:
	users = User.query.filter(User.status == "1").order_by(User.name.asc()).all()
	mapped = {
		row.computicket_user_id
		for row in HelpDeskAgentMap.query.all()
	}
	return [user.name.strip() for user in users if user.id in mapped and (user.name or "").strip()]


def _queue_names() -> list[str]:
	try:
		queues = ensure_default_queue()
	except Exception:
		queues = []
	names: list[str] = []
	for item in queues or []:
		if isinstance(item, dict) and (item.get("name") or "").strip():
			names.append(str(item["name"]).strip())
	return names


def _empty_triage(status: str = "pending", error: str = "") -> dict[str, str]:
	return {
		"status": status,
		"error": error,
		"categoria": "",
		"sistema": "",
		"prioridade": "",
		"setor": "",
		"motivo": "",
		"intencao": "",
		"tecnico": "",
	}


def _save_triage(engine_ticket_id: int, triage: dict[str, Any]) -> HelpDeskAiInsight:
	row = HelpDeskAiInsight.query.filter_by(engine_ticket_id=int(engine_ticket_id)).first()
	if row is None:
		row = HelpDeskAiInsight(engine_ticket_id=int(engine_ticket_id), status="ready")
		db.session.add(row)
	row.triage = json.dumps(triage, ensure_ascii=False)
	db.session.commit()
	return row


def parse_triage(raw: str | None) -> dict[str, Any] | None:
	if not raw:
		return None
	try:
		data = json.loads(raw)
	except (TypeError, json.JSONDecodeError):
		return None
	return data if isinstance(data, dict) else None


def run_classify(engine_ticket_id: int) -> dict:
	import time

	started = time.monotonic()
	prompt = f"classify:{engine_ticket_id}"
	_save_triage(engine_ticket_id, _empty_triage("pending"))
	try:
		transcript, _client_name, _external = _transcript_from_engine(engine_ticket_id)
	except Exception as exc:
		triage = _empty_triage("error", str(exc)[:300])
		_save_triage(engine_ticket_id, triage)
		_audit("classify_conversation", prompt, engine_ticket_id, "error", started, "engine_error")
		raise
	if not transcript.strip():
		triage = _empty_triage("error", "Sem mensagens para classificar.")
		_save_triage(engine_ticket_id, triage)
		_audit("classify_conversation", prompt, engine_ticket_id, "error", started, "empty")
		return triage
	queues = _queue_names()
	people = _people_names()
	try:
		data = _generate(
			(
				f"MENSAGENS:\n{transcript[-12000:]}\n\n"
				f"FILAS REAIS:\n{', '.join(queues) or '(nenhuma)'}\n\n"
				f"TÉCNICOS REAIS:\n{', '.join(people) or '(nenhum)'}"
			),
			(
				"Classifique o chamado em português. Não resolva o problema e não invente. "
				"setor só pode ser o nome exato de uma fila real, ou vazio. "
				"tecnico só pode ser o nome exato de um técnico real, ou vazio. "
				"sistema: CLIPP, UniPlus, ARPA, Mais Gestão, ou outro nome que apareça na conversa. "
				"prioridade: baixa, normal ou alta. intencao: consulta ou problema. "
				"Retorne JSON."
			),
			{
				"type": "object",
				"properties": {
					"categoria": {"type": "string"},
					"sistema": {"type": "string"},
					"prioridade": {"type": "string"},
					"setor": {"type": "string"},
					"motivo": {"type": "string"},
					"intencao": {"type": "string"},
					"tecnico": {"type": "string"},
				},
				"required": ["categoria", "sistema", "prioridade", "setor", "motivo", "intencao", "tecnico"],
			},
		)
	except CopilotError as exc:
		triage = _empty_triage("error", str(exc)[:300])
		_save_triage(engine_ticket_id, triage)
		_audit("classify_conversation", prompt, engine_ticket_id, "error", started, exc.code)
		raise
	priority = _norm(str(data.get("prioridade") or ""))
	intent = _norm(str(data.get("intencao") or ""))
	triage = {
		"status": "ready",
		"error": "",
		"categoria": str(data.get("categoria") or "").strip()[:120],
		"sistema": _system_name(str(data.get("sistema") or ""), transcript),
		"prioridade": priority if priority in _PRIORITIES else "normal",
		"setor": match_named(str(data.get("setor") or ""), queues),
		"motivo": str(data.get("motivo") or "").strip()[:300],
		"intencao": intent if intent in _INTENTS else "problema",
		"tecnico": match_named(str(data.get("tecnico") or ""), people),
	}
	_save_triage(engine_ticket_id, triage)
	_audit("classify_conversation", prompt, engine_ticket_id, "success", started)
	return triage


def apply_triage_correction(engine_ticket_id: int, fields: dict[str, Any]) -> dict:
	row = HelpDeskAiInsight.query.filter_by(engine_ticket_id=int(engine_ticket_id)).first()
	current = parse_triage(row.triage if row else None) or _empty_triage("ready")
	queues = _queue_names()
	people = _people_names()
	if "categoria" in fields:
		current["categoria"] = str(fields.get("categoria") or "").strip()[:120]
	if "setor" in fields:
		wanted = str(fields.get("setor") or "").strip()
		current["setor"] = "" if not wanted else match_named(wanted, queues)
		if wanted and not current["setor"]:
			raise ValueError("Fila não encontrada.")
	if "tecnico" in fields:
		wanted = str(fields.get("tecnico") or "").strip()
		current["tecnico"] = "" if not wanted else match_named(wanted, people)
		if wanted and not current["tecnico"]:
			raise ValueError("Técnico não encontrado.")
	current["status"] = "ready"
	current["error"] = ""
	current["corrected"] = True
	_save_triage(engine_ticket_id, current)
	return current
