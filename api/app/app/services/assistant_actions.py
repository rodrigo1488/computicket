"""Ações do assistente do dashboard: agenda e conhecimento. Exigem usuário logado."""

from __future__ import annotations

import contextvars
import os
import uuid
from datetime import datetime, timedelta, timezone

from flask import current_app
from flask_login import current_user

from ..blueprints.agenda import (
	_resolve_agenda_technician,
	_resolve_staff_client,
	enviar_email_confirmacao,
	notify_appointment_whatsapp,
)
from ..models import Appointment, KnowledgeArticle, KnowledgeAttachment, KnowledgeCategory, db
from .rag import index_source, sanitize_for_rag

_SUPPORT_CATEGORY = "Suporte"
_BRASILIA = timezone(timedelta(hours=-3))
_IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
_chat_image: contextvars.ContextVar[tuple[bytes, str] | None] = contextvars.ContextVar(
	"assistant_chat_image", default=None
)
_saved_article: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
	"assistant_saved_article", default=None
)


def remember_chat_image(image: tuple[bytes, str] | None) -> None:
	"""Print da mensagem atual. A gravação do conhecimento anexa este arquivo."""
	_chat_image.set(image)


def begin_saved_article() -> None:
	_saved_article.set(None)


def last_saved_article() -> dict | None:
	return _saved_article.get()


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
	category_id = int(category.id)
	heading = (title or problem.splitlines()[0])[:180]
	content = f"Problema\n{problem}\n\nSolução\n{solution}"
	article = KnowledgeArticle(
		title=heading,
		content=content,
		summary=problem[:300],
		tags="suporte, solução",
		category_id=category_id,
		status="published",
		created_by_id=actor_id,
	)
	db.session.add(article)
	db.session.commit()
	article_id = int(article.id)
	try:
		attached = _attach_chat_image(article_id, actor_id)
	except Exception:
		db.session.rollback()
		attached = False
	if attached:
		content = f"{content}\n\nO print do erro está anexado neste artigo."
		article.content = content
		db.session.commit()
	try:
		index_source("knowledge_article", article_id)
	except Exception:
		db.session.rollback()
	payload = {
		"ok": True,
		"article_id": article_id,
		"title": heading,
		"category_id": category_id,
		"attachment": attached,
		"message": (
			f"Salvei no conhecimento, com o print anexado: {heading}."
			if attached
			else f"Salvei no conhecimento, categoria Suporte: {heading}."
		),
	}
	_saved_article.set(
		{"article_id": article_id, "title": heading, "category_id": category_id}
	)
	return payload


def _attach_chat_image(article_id: int, user_id: int) -> bool:
	image = _chat_image.get()
	if not image:
		return False
	data, mime = image
	if not data:
		return False
	ext = _IMAGE_EXT.get(mime, "png")
	folder = os.path.join(current_app.instance_path, "knowledge_uploads")
	os.makedirs(folder, exist_ok=True)
	unique = f"{uuid.uuid4()}_print-do-erro.{ext}"
	path = os.path.join(folder, unique)
	with open(path, "wb") as handle:
		handle.write(data)
	db.session.add(
		KnowledgeAttachment(
			article_id=article_id,
			filename=unique,
			original_filename=f"print-do-erro.{ext}",
			file_path=unique,
			file_size=len(data),
			file_type=mime,
			description="Print enviado no assistente",
			created_by_id=user_id,
		)
	)
	db.session.commit()
	return True
