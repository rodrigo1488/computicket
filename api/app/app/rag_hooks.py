"""Eventos e comando administrativo do índice RAG."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import click
from flask import current_app
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from . import db
from .models import KnowledgeArticle, Ticket

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-index")
_registered = False
_PENDING_KEY = "rag_pending_sources"


def _record_pending(session: Session, _flush_context, _instances) -> None:
	pending: set[tuple[str, int]] = session.info.setdefault(_PENDING_KEY, set())
	for obj in session.new | session.dirty | session.deleted:
		if isinstance(obj, KnowledgeArticle):
			if obj.id is not None:
				pending.add(("knowledge_article", int(obj.id)))
		elif obj in session.new:
				# Novos objetos recebem o ID durante o flush; after_flush cobre este caso.
				session.info.setdefault("rag_new_sources", []).append(("knowledge_article", obj))
		elif obj in session.deleted:
			continue
		if obj in session.dirty and not inspect(obj).modified:
			continue
		elif isinstance(obj, Ticket) and obj.id is not None:
			state = inspect(obj)
			status_changed = state.attrs.status.history.has_changes()
			if obj.status == "fechado" or status_changed or obj in session.deleted:
				pending.add(("ticket", int(obj.id)))
		elif isinstance(obj, Ticket) and obj in session.new and obj.status == "fechado":
			session.info.setdefault("rag_new_sources", []).append(("ticket", obj))


def _record_new_ids(session: Session, _flush_context) -> None:
	for source_type, obj in session.info.pop("rag_new_sources", []):
		if obj.id is not None:
			session.info.setdefault(_PENDING_KEY, set()).add((source_type, int(obj.id)))


def _run_pending(app, sources: set[tuple[str, int]]) -> None:
	from .services.rag import index_source

	with app.app_context():
		for source_type, source_id in sources:
			try:
				index_source(source_type, source_id)
			except Exception:
				db.session.rollback()
				app.logger.exception("Falha na indexação RAG de %s:%s", source_type, source_id)
		db.session.remove()


def _dispatch_after_commit(session: Session) -> None:
	sources = session.info.pop(_PENDING_KEY, set())
	if not sources:
		return
	try:
		app = current_app._get_current_object()
	except RuntimeError:
		return
	_executor.submit(_run_pending, app, set(sources))


def _clear_after_rollback(session: Session) -> None:
	session.info.pop(_PENDING_KEY, None)
	session.info.pop("rag_new_sources", None)


def register_rag(app) -> None:
	global _registered
	if not _registered:
		event.listen(Session, "before_flush", _record_pending)
		event.listen(Session, "after_flush", _record_new_ids)
		event.listen(Session, "after_commit", _dispatch_after_commit)
		event.listen(Session, "after_rollback", _clear_after_rollback)
		_registered = True

	@app.cli.command("rag-reindex")
	@click.option("--keep-stale", is_flag=True, help="Não remove chunks de fontes obsoletas.")
	def rag_reindex(keep_stale: bool) -> None:
		"""Reindexa artigos publicados e tickets fechados."""
		from .services.rag import reindex_all

		result = reindex_all(remove_stale=not keep_stale)
		click.echo(
			f"RAG atualizado: {result['sources']} fontes, "
			f"{result['chunks']} chunks, {result['removed']} obsoletos removidos."
		)
