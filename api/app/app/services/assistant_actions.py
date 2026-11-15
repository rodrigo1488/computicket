"""Ações do assistente do dashboard: agenda e conhecimento. Exigem usuário logado."""

from __future__ import annotations

import html
from datetime import datetime, timedelta, timezone

from flask_login import current_user

from ..blueprints.agenda import (
	_resolve_agenda_technician,
	_resolve_staff_client,
	enviar_email_confirmacao,
	notify_appointment_whatsapp,
)
from ..models import Appointment, KnowledgeArticle, KnowledgeCategory, db
from .rag import index_source, sanitize_for_rag

_SUPPORT_CATEGORY = "Suporte"
_BRASILIA = timezone(timedelta(hours=-3))


def _user_id(explicit: int | None) -> int | None:
	if explicit:
		return int(explicit)
	user_id = getattr(current_user, "id", None)
	return int(user_id) if user_id else None


def create_appointment(args: dict, user_id: int | None = None) -> dict:
	"""Cria uma visita. Sem cliente, data ou horário, devolve o que falta e não grava."""
	actor_id = _user_id(user_id)
	if not actor_id:
		return {"ok": False, "message": "É preciso estar logado para agendar."}
	title = str(args.get("title") or "").strip()
	raw_date = str(args.get("appointment_date") or args.get("data") or "").strip()
	has_clock = "T" in raw_date or " " in raw_date
	cliente = str(args.get("cliente") or args.get("client_name") or "").strip()
	tecnico = str(args.get("tecnico") or "").strip()
	description = str(args.get("description") or "").strip()
	if len(title) < 3:
		return {"ok": False, "message": "Falta o título da visita. Pergunte antes de agendar."}
	if len(raw_date) <= 10 or not has_clock:
		return {"ok": False, "message": "Falta a data com horário. Pergunte antes de agendar."}
	link, client_error = _resolve_staff_client({"cliente": cliente})
	if not link:
		return {"ok": False, "message": client_error or "Não encontrei o cliente."}
	technician = _resolve_agenda_technician(None, tecnico) if tecnico else _resolve_agenda_technician(actor_id, None)
	if not technician:
		return {"ok": False, "message": "Não encontrei esse técnico. Informe o nome de um técnico ativo."}
	try:
		appointment_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00").replace(" ", "T"))
	except ValueError:
		return {"ok": False, "message": "Data inválida. Use ano, mês, dia e horário."}
	if appointment_date.tzinfo is not None:
		appointment_date = appointment_date.astimezone(_BRASILIA).replace(tzinfo=None)
	appointment = Appointment(
		title=title[:200],
		description=description[:2000],
		appointment_date=appointment_date,
		client_id=link.external_client_id,
		user_id=technician.id,
		created_by=actor_id,
	)
	db.session.add(appointment)
	db.session.commit()
	when = appointment.get_formatted_date()
	try:
		from ..notification_service import create_notifications

		create_notifications(
			[appointment.user_id],
			notification_type="appointment",
			title="Novo agendamento",
			message=f"{appointment.title} · {when}",
			url="/agenda",
			entity_type="appointment",
			entity_id=appointment.id,
		)
	except Exception:
		db.session.rollback()
	try:
		enviar_email_confirmacao(appointment)
	except Exception:
		pass
	try:
		notify_appointment_whatsapp(appointment)
	except Exception:
		pass
	return {
		"ok": True,
		"appointment_id": appointment.id,
		"message": (
			f"Agendamento confirmado: {appointment.title} em {when} "
			f"com {technician.name}, cliente {link.external_client_name}."
		),
	}


def _support_category(user_id: int) -> KnowledgeCategory:
	category = KnowledgeCategory.query.filter(
		db.func.lower(KnowledgeCategory.name) == _SUPPORT_CATEGORY.lower()
	).first()
	if category:
		return category
	category = KnowledgeCategory(
		name=_SUPPORT_CATEGORY,
		description="Problemas e soluções registrados pelo assistente.",
		created_by_id=user_id,
	)
	db.session.add(category)
	db.session.flush()
	return category


def save_support_solution(args: dict, user_id: int | None = None) -> dict:
	"""Grava problema e solução no conhecimento. Os dois lados são obrigatórios."""
	actor_id = _user_id(user_id)
	if not actor_id:
		return {"ok": False, "message": "É preciso estar logado para salvar no conhecimento."}
	problem = sanitize_for_rag(str(args.get("problem") or args.get("problema") or ""))
	solution = sanitize_for_rag(str(args.get("solution") or args.get("solucao") or ""))
	title = sanitize_for_rag(str(args.get("title") or ""))
	if len(problem) < 12:
		return {"ok": False, "message": "Descreva o problema ou o erro do print. Ainda não salvei."}
	if len(solution) < 12:
		return {
			"ok": False,
			"message": "Falta a solução. Pergunte como foi resolvido e só salve quando a pessoa responder.",
		}
	category = _support_category(actor_id)
	heading = (title or problem.splitlines()[0])[:180]
	content = (
		"<p><strong>Problema</strong></p>"
		f"<p>{html.escape(problem).replace(chr(10), '<br>')}</p>"
		"<p><strong>Solução</strong></p>"
		f"<p>{html.escape(solution).replace(chr(10), '<br>')}</p>"
	)
	article = KnowledgeArticle(
		title=heading,
		content=content,
		summary=problem[:300],
		tags="suporte, solução",
		category_id=category.id,
		status="published",
		created_by_id=actor_id,
	)
	db.session.add(article)
	db.session.commit()
	try:
		index_source("knowledge_article", article.id)
	except Exception:
		pass
	return {
		"ok": True,
		"article_id": article.id,
		"title": article.title,
		"message": f"Salvei no conhecimento, categoria Suporte: {article.title}.",
	}
