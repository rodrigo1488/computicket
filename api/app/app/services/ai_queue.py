"""Fila durável de IA da API, no Redis que já sobe com o CRM.

Cada job declara o que lê e o que grava. Falha do Gemini recoloca o job
até três vezes e não derruba o atendimento.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)

QUEUE_KEY = "computicket:ai:jobs"
MAX_ATTEMPTS = 3

# Ferramentas fechadas: o worker só executa estes tipos.
JOB_TOOLS: dict[str, dict[str, list[str]]] = {
	"summarize_conversation": {
		"reads": ["engine_messages", "knowledge"],
		"writes": ["helpdesk_ai_insight", "knowledge_chunk", "internal_note"],
	},
	"index_conversation": {
		"reads": ["helpdesk_ai_insight"],
		"writes": ["knowledge_chunk"],
	},
	"classify_conversation": {
		"reads": ["engine_messages", "queues", "technicians"],
		"writes": ["helpdesk_ai_insight"],
	},
}

_worker_started = False
_worker_lock = threading.Lock()


def redis_url() -> str:
	return (os.environ.get("REDIS_URL") or os.environ.get("REDIS_URI") or "redis://redis:6379").strip()


def _client():
	import redis

	return redis.Redis.from_url(redis_url(), socket_connect_timeout=1, socket_timeout=5)


def enqueue_ai_job(kind: str, payload: dict[str, Any] | None = None) -> bool:
	"""Enfileira. Se o Redis não responder, devolve False sem derrubar a requisição."""
	if kind not in JOB_TOOLS:
		raise ValueError("Tipo de job de IA não permitido.")
	body = {
		"kind": kind,
		"attempt": 0,
		"tools": JOB_TOOLS[kind],
		"payload": payload or {},
	}
	try:
		_client().lpush(QUEUE_KEY, json.dumps(body, ensure_ascii=False))
		return True
	except Exception as exc:
		logger.warning("Fila de IA indisponível (%s). Job %s não enfileirado.", exc, kind)
		return False


def process_ai_job(job: dict[str, Any]) -> None:
	kind = job.get("kind")
	payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
	if kind not in JOB_TOOLS:
		raise ValueError("Tipo de job de IA não permitido.")
	engine_ticket_id = int(payload.get("engine_ticket_id") or 0)
	if engine_ticket_id <= 0:
		raise ValueError("engine_ticket_id ausente.")
	if kind == "summarize_conversation":
		from .conversation_summary import run_summarize

		run_summarize(engine_ticket_id, post_note=bool(payload.get("post_note", True)))
		return
	if kind == "index_conversation":
		from .rag import index_source

		index_source("helpdesk_conversation", engine_ticket_id)
		return
	if kind == "classify_conversation":
		from .conversation_triage import run_classify

		run_classify(engine_ticket_id)
		return
	raise ValueError("Tipo de job de IA não permitido.")


def _requeue(job: dict[str, Any]) -> None:
	attempt = int(job.get("attempt") or 0) + 1
	if attempt >= MAX_ATTEMPTS:
		_mark_failed(job, "Esgotou as tentativas.")
		return
	job["attempt"] = attempt
	try:
		_client().lpush(QUEUE_KEY, json.dumps(job, ensure_ascii=False))
	except Exception as exc:
		logger.warning("Não foi possível recolocar o job de IA: %s", exc)
		_mark_failed(job, str(exc))


def _mark_failed(job: dict[str, Any], message: str) -> None:
	payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
	engine_ticket_id = payload.get("engine_ticket_id")
	if job.get("kind") != "summarize_conversation" or not engine_ticket_id:
		return
	try:
		from .. import db
		from ..models import HelpDeskAiInsight

		row = HelpDeskAiInsight.query.filter_by(engine_ticket_id=int(engine_ticket_id)).first()
		if row is None:
			return
		row.status = "error"
		row.error_message = (message or "Falha na IA")[:300]
		db.session.commit()
	except Exception:
		logger.exception("Falha ao gravar erro do resumo %s", engine_ticket_id)


def _loop(app) -> None:
	from .conversation_summary import CopilotError

	client = _client()
	while True:
		try:
			item = client.brpop(QUEUE_KEY, timeout=5)
		except Exception as exc:
			logger.warning("Fila de IA sem Redis (%s). Nova tentativa em seguida.", exc)
			try:
				client = _client()
			except Exception:
				pass
			continue
		if not item:
			continue
		_key, raw = item
		try:
			job = json.loads(raw)
		except (TypeError, json.JSONDecodeError):
			continue
		with app.app_context():
			try:
				process_ai_job(job)
			except CopilotError:
				_requeue(job)
			except Exception:
				app.logger.exception("Job de IA falhou: %s", job.get("kind"))
				_requeue(job)


def start_ai_queue(app) -> None:
	global _worker_started
	with _worker_lock:
		if _worker_started:
			return
		try:
			_client().ping()
		except Exception as exc:
			app.logger.warning("Fila de IA não iniciada: Redis indisponível (%s).", exc)
			return
		thread = threading.Thread(target=_loop, args=(app,), name="ai-queue", daemon=True)
		thread.start()
		_worker_started = True
		app.logger.info("Fila de IA escutando %s.", QUEUE_KEY)
