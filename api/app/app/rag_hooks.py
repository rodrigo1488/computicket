"""Eventos e comando administrativo do índice RAG."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import click
from flask import current_app
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from . import db
from .models import Budget, BudgetItem, KnowledgeArticle, PasswordVault, Ticket

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-index")
_registered = False
_PENDING_KEY = "rag_pending_sources"
_NEW_KEY = "rag_new_sources"


def _queue(session: Session, source_type: str, source_id: int | None = None, obj=None) -> None:
	if source_id is not None:
		session.info.setdefault(_PENDING_KEY, set()).add((source_type, int(source_id)))
	elif obj is not None:
		session.info.setdefault(_NEW_KEY, []).append((source_type, obj))


def _record_pending(session: Session, _flush_context, _instances) -> None:
	for obj in session.new | session.dirty | session.deleted:
		if isinstance(obj, KnowledgeArticle):
			if obj.id is not None:
				_queue(session, "knowledge_article", obj.id)
			elif obj in session.new:
				_queue(session, "knowledge_article", obj=obj)
			continue

		if isinstance(obj, Ticket):
			if obj.id is not None:
				_queue(session, "ticket", obj.id)
			elif obj in session.new:
				_queue(session, "ticket", obj=obj)
			continue

		if isinstance(obj, PasswordVault):
			if obj.id is not None:
				_queue(session, "password_vault", obj.id)
			elif obj in session.new:
				_queue(session, "password_vault", obj=obj)
			continue

		if isinstance(obj, Budget):
			if obj.id is not None:
				_queue(session, "budget", obj.id)
			elif obj in session.new:
				_queue(session, "budget", obj=obj)
			continue

		if isinstance(obj, BudgetItem):
			budget_id = getattr(obj, "budget_id", None)
			if budget_id is not None:
				_queue(session, "budget", budget_id)
			elif getattr(obj, "budget", None) is not None:
				_queue(session, "budget", obj=obj.budget)
			continue

		# Ignora objetos não relevantes; evita reindexar quando só houve flush sem mudança útil.
		if obj in session.dirty and not inspect(obj).modified:
			continue


def _record_new_ids(session: Session, _flush_context) -> None:
	for source_type, obj in session.info.pop(_NEW_KEY, []):
		if obj is not None and getattr(obj, "id", None) is not None:
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
	session.info.pop(_NEW_KEY, None)


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
		"""Reindexa artigos, tickets, cofre (metadados) e orçamentos."""
		from .services.rag import reindex_all

		click.echo("Iniciando reindexação RAG…", err=True)

		def _progress(index: int, total: int, source_type: str, source_id: int) -> None:
			click.echo(f"[{index}/{total}] {source_type} #{source_id}", err=True)

		result = reindex_all(remove_stale=not keep_stale, progress=_progress)
		click.echo(
			f"RAG atualizado: {result['sources']} fontes, "
			f"{result['chunks']} chunks, {result['removed']} obsoletos removidos."
		)
