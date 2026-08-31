"""Criação e entrega centralizada de notificações do Computicket."""

import base64
import json
import os
import threading
from pathlib import Path
from typing import Iterable

from flask import current_app
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from datetime import timedelta

from . import db, socketio
from .models import AppNotification, PushSubscription, User
from .timezone_utils import get_brasilia_now

_vapid_lock = threading.Lock()


def _base64url(value: bytes) -> str:
	return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def ensure_vapid_keys() -> tuple[str, str]:
	"""Obtém as chaves do ambiente ou gera um par persistente no volume instance."""
	public_env = (os.environ.get("VAPID_PUBLIC_KEY") or "").strip()
	private_env = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip()
	if public_env and private_env:
		return public_env, private_env.replace("\\n", "\n")

	instance_dir = Path(current_app.instance_path)
	private_path = instance_dir / "vapid_private.pem"
	public_path = instance_dir / "vapid_public.txt"

	with _vapid_lock:
		instance_dir.mkdir(parents=True, exist_ok=True)
		if private_path.is_file() and public_path.is_file():
			return public_path.read_text(encoding="utf-8").strip(), str(private_path)

		private_key = ec.generate_private_key(ec.SECP256R1())
		private_pem = private_key.private_bytes(
			encoding=serialization.Encoding.PEM,
			format=serialization.PrivateFormat.PKCS8,
			encryption_algorithm=serialization.NoEncryption(),
		)
		public_key = private_key.public_key().public_bytes(
			encoding=serialization.Encoding.X962,
			format=serialization.PublicFormat.UncompressedPoint,
		)

		private_tmp = private_path.with_suffix(".tmp")
		public_tmp = public_path.with_suffix(".tmp")
		private_tmp.write_bytes(private_pem)
		public_tmp.write_text(_base64url(public_key), encoding="utf-8")
		private_tmp.replace(private_path)
		private_path.chmod(0o600)
		public_tmp.replace(public_path)
		current_app.logger.info("Chaves VAPID geradas automaticamente no volume instance.")
		return public_path.read_text(encoding="utf-8").strip(), str(private_path)


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
	send_push: bool = True,
) -> list[AppNotification]:
	"""Cria notificações com dedupe por (user_id, entity_type, entity_id)."""
	entity_key = str(entity_id) if entity_id is not None else None
	created: list[AppNotification] = []

	for user_id in _unique_user_ids(user_ids):
		if entity_type and entity_key:
			existing = AppNotification.query.filter_by(
				user_id=user_id,
				entity_type=entity_type,
				entity_id=entity_key,
			).first()
			if existing:
				continue
		if notification_type == "message" and _recent_message_duplicate(user_id, url, message):
			continue
		notification = AppNotification(
			user_id=user_id,
			notification_type=notification_type,
			title=title,
			message=message,
			url=url,
			entity_type=entity_type,
			entity_id=entity_key,
		)
		db.session.add(notification)
		created.append(notification)

	if not created:
		return []

	db.session.commit()

	for notification in created:
		payload = notification.to_dict()
		room = f"agent_{notification.user_id}"
		socketio.emit("app_notification", payload, room=room)
		# Evita toast in-app + push do SO ao mesmo tempo quando o usuário está online.
		if send_push and not _user_has_active_socket(room):
			_send_web_push(notification.user_id, payload)
	return created


def _recent_message_duplicate(user_id: int, url: str | None, message: str) -> bool:
	"""Baileys pode persistir o mesmo inbound com ids diferentes em poucos segundos."""
	now = get_brasilia_now()
	if getattr(now, "tzinfo", None) is not None:
		now = now.replace(tzinfo=None)
	cutoff = now - timedelta(seconds=15)
	body = (message or "").replace("\r\n", "\n").strip()[:1000]
	q = AppNotification.query.filter(
		AppNotification.user_id == user_id,
		AppNotification.notification_type == "message",
		AppNotification.created_at >= cutoff,
	)
	if url:
		q = q.filter(AppNotification.url == url)
	for row in q.limit(8).all():
		if (row.message or "").replace("\r\n", "\n").strip()[:1000] == body:
			return True
	return False


def _user_has_active_socket(room: str) -> bool:
	"""True se há cliente Socket.IO na room (aba aberta)."""
	try:
		manager = getattr(socketio.server, "manager", None)
		if manager is None:
			return False
		rooms = getattr(manager, "rooms", None)
		if isinstance(rooms, dict):
			namespace_rooms = rooms.get("/") or rooms.get("") or {}
			occupants = namespace_rooms.get(room) if isinstance(namespace_rooms, dict) else None
			if occupants:
				return True
		participants = manager.get_participants("/", room)
		for _ in participants:
			return True
	except Exception:
		return False
	return False


def _send_web_push(user_id: int, payload: dict) -> None:
	_, private_key = ensure_vapid_keys()
	contact = (os.environ.get("VAPID_CONTACT") or "mailto:admin@computicket.local").strip()

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
