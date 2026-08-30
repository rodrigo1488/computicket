"""Criação e entrega centralizada de notificações do Computicket."""

import json
import os
from typing import Iterable

from flask import current_app

from . import db, socketio
from .models import AppNotification, PushSubscription, User


def _unique_user_ids(user_ids: Iterable[int | None]) -> list[int]:
	return list(dict.fromkeys(int(user_id) for user_id in user_ids if user_id))


def ticket_recipient_ids(assigned_to_id: int | None) -> list[int]:
	"""Ticket atribuído vai ao responsável; sem responsável vai à equipe ativa."""
	if assigned_to_id:
		return [int(assigned_to_id)]
	return [
		user.id
		for user in User.query.filter(
			User.status == "1",
			User.role.in_(["admin", "administrador", "tecnico"]),
		).all()
	]


def create_notifications(
	user_ids: Iterable[int | None],
	*,
	notification_type: str,
	title: str,
	message: str,
	url: str | None = None,
	entity_type: str | None = None,
	entity_id: str | int | None = None,
) -> list[AppNotification]:
	notifications = [
		AppNotification(
			user_id=user_id,
			notification_type=notification_type,
			title=title,
			message=message,
			url=url,
			entity_type=entity_type,
			entity_id=str(entity_id) if entity_id is not None else None,
		)
		for user_id in _unique_user_ids(user_ids)
	]
	if not notifications:
		return []

	db.session.add_all(notifications)
	db.session.commit()

	for notification in notifications:
		payload = notification.to_dict()
		socketio.emit("app_notification", payload, room=f"agent_{notification.user_id}")
		_send_web_push(notification.user_id, payload)
	return notifications


def _send_web_push(user_id: int, payload: dict) -> None:
	private_key = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip()
	contact = (os.environ.get("VAPID_CONTACT") or "mailto:admin@computicket.local").strip()
	if not private_key:
		return
	private_key = private_key.replace("\\n", "\n")

	try:
		from pywebpush import WebPushException, webpush
	except ImportError:
		current_app.logger.warning("pywebpush não instalado; Web Push desativado.")
		return

	expired: list[PushSubscription] = []
	for subscription in PushSubscription.query.filter_by(user_id=user_id).all():
		try:
			webpush(
				subscription_info=subscription.subscription_info(),
				data=json.dumps(payload, ensure_ascii=False),
				vapid_private_key=private_key,
				vapid_claims={"sub": contact},
				ttl=300,
			)
		except WebPushException as exc:
			status = getattr(getattr(exc, "response", None), "status_code", None)
			if status in (404, 410):
				expired.append(subscription)
			else:
				current_app.logger.warning("Falha ao enviar Web Push: %s", exc)
		except Exception as exc:
			current_app.logger.warning("Falha ao enviar Web Push: %s", exc)

	if expired:
		for subscription in expired:
			db.session.delete(subscription)
		db.session.commit()
