"""Link público do chamado e aviso ao técnico atribuído (WhatsApp + e-mail)."""
from __future__ import annotations

import logging
import os
import secrets
from threading import Thread
from urllib.parse import urlparse

from . import db
from .models import Service, Ticket, User

_PRODUCTION_SITE = "https://www.computicket.space"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
logger = logging.getLogger(__name__)


def public_site_origin() -> str:
	raw = (os.environ.get("COMPUTICKET_PUBLIC_URL") or "").strip().rstrip("/")
	if raw:
		parsed = urlparse(raw if "://" in raw else f"https://{raw}")
		host = (parsed.hostname or "").lower()
		if host and host not in _LOCAL_HOSTS:
			if host in {"computicket.space", "www.computicket.space"}:
				return _PRODUCTION_SITE
			scheme = (parsed.scheme or "https").lower()
			if scheme != "https" and "." in host:
				scheme = "https"
			if parsed.port and parsed.port not in (80, 443, 3000):
				return f"{scheme}://{host}:{parsed.port}"
			return f"{scheme}://{host}"
	return _PRODUCTION_SITE


def ensure_ticket_public_token(ticket: Ticket) -> str:
	if ticket.public_token:
		return ticket.public_token
	for _ in range(5):
		token = secrets.token_urlsafe(32)
		if not Ticket.query.filter_by(public_token=token).first():
			ticket.public_token = token
			return token
	raise RuntimeError("Não foi possível gerar o token público do chamado.")


def ticket_public_url(ticket: Ticket) -> str:
	token = ensure_ticket_public_token(ticket)
	return f"{public_site_origin()}/chamados/publico/{token}"


def serialize_public_ticket(ticket: Ticket) -> dict:
	tech = ticket.assigned_to_user
	service = ticket.service
	return {
		"id": ticket.id,
		"code": f"{ticket.id:05d}",
		"title": ticket.title,
		"description": ticket.description or "",
		"status": ticket.status,
		"client_name": ticket.display_client_name() or "",
		"solicitante": ticket.solicitante or "",
		"service_name": service.name if service else "",
		"assigned_to_name": tech.name if tech else "",
		"created_at": ticket.created_at.isoformat() if ticket.created_at else None,
	}


def _technician_message(ticket: Ticket, public_url: str) -> str:
	client = ticket.display_client_name() or "Cliente não informado"
	solicitante = (ticket.solicitante or "").strip()
	desc = (ticket.description or "").strip()
	if len(desc) > 400:
		desc = desc[:397] + "…"
	lines = [
		f"Novo chamado #{ticket.id} atribuído a você.",
		"",
		f"Cliente: {client}",
	]
	if solicitante:
		lines.append(f"Solicitante: {solicitante}")
	lines.append(f"Título: {ticket.title}")
	if desc:
		lines.extend(["", desc])
	lines.extend(["", "Abra o chamado (sem login):", public_url])
	return "\n".join(lines)


def _send_technician_channels(app, ticket_id: int) -> None:
	with app.app_context():
		ticket = Ticket.query.get(ticket_id)
		if not ticket or not ticket.assigned_to_id:
			return
		user = User.query.get(ticket.assigned_to_id)
		if not user:
			return
		try:
			public_url = ticket_public_url(ticket)
			db.session.commit()
		except Exception:
			logger.exception("Falha ao gerar link público do chamado %s", ticket_id)
			return

		if user.phone:
			try:
				from .whatsapp_notify import send_whatsapp_text
				status = send_whatsapp_text(user.phone, _technician_message(ticket, public_url))
				logger.info("WhatsApp do chamado %s para técnico %s: %s", ticket_id, user.id, status)
			except Exception:
				logger.exception("Falha no WhatsApp do chamado %s", ticket_id)

		if user.email:
			try:
				from .blueprints.utils import send_ticket_notification_email
				service = Service.query.get(ticket.service_id) if ticket.service_id else None
				send_ticket_notification_email(
					technician_email=user.email,
					technician_name=user.name,
					ticket_data={
						"id": ticket.id,
						"title": ticket.title,
						"description": ticket.description,
						"client_name": ticket.display_client_name(),
						"priority": "media",
						"service_name": service.name if service else None,
						"created_at": ticket.created_at,
						"public_url": public_url,
					},
				)
			except Exception:
				logger.exception("Falha no e-mail do chamado %s", ticket_id)


def notify_assigned_technician(ticket: Ticket) -> None:
	"""Dispara WhatsApp e e-mail ao técnico, sem atrasar a abertura do chamado."""
	if not ticket or not ticket.id or not ticket.assigned_to_id:
		return
	try:
		ensure_ticket_public_token(ticket)
		db.session.commit()
	except Exception:
		logger.exception("Falha ao gravar token público do chamado %s", ticket.id)
		return
	from flask import current_app
	app = current_app._get_current_object()
	Thread(
		target=_send_technician_channels,
		args=(app, ticket.id),
		daemon=True,
	).start()
