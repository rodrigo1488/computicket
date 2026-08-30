"""API de notificações persistentes e assinaturas Web Push."""

import os

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from app import db
from app.models import AppNotification, PushSubscription
from app.notification_service import create_notifications
from app.timezone_utils import get_brasilia_now


notifications_bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


@notifications_bp.route("/count")
@login_required
def get_notification_count():
	count = AppNotification.query.filter_by(user_id=current_user.id, read_at=None).count()
	return jsonify({"success": True, "count": count})


@notifications_bp.route("/list")
@login_required
def get_notifications():
	limit = min(max(request.args.get("limit", 30, type=int), 1), 100)
	items = (
		AppNotification.query.filter_by(user_id=current_user.id)
		.order_by(AppNotification.created_at.desc())
		.limit(limit)
		.all()
	)
	return jsonify({
		"success": True,
		"notifications": [item.to_dict() for item in items],
		"total": len(items),
		"unread": sum(1 for item in items if item.read_at is None),
	})


@notifications_bp.route("/<int:notification_id>/read", methods=["POST"])
@login_required
def mark_notification_read(notification_id: int):
	item = AppNotification.query.filter_by(id=notification_id, user_id=current_user.id).first_or_404()
	if item.read_at is None:
		item.read_at = get_brasilia_now()
		db.session.commit()
	return jsonify(item.to_dict())


@notifications_bp.route("/mark-read", methods=["POST"])
@login_required
def mark_notifications_read():
	(
		AppNotification.query.filter_by(user_id=current_user.id, read_at=None)
		.update({"read_at": get_brasilia_now()}, synchronize_session=False)
	)
	db.session.commit()
	return jsonify({"success": True})


@notifications_bp.route("/push/config")
@login_required
def push_config():
	public_key = (os.environ.get("VAPID_PUBLIC_KEY") or "").strip()
	return jsonify({"enabled": bool(public_key), "publicKey": public_key or None})


@notifications_bp.route("/push/subscribe", methods=["POST"])
@login_required
def subscribe_push():
	data = request.get_json(silent=True) or {}
	endpoint = (data.get("endpoint") or "").strip()
	keys = data.get("keys") or {}
	p256dh = (keys.get("p256dh") or "").strip()
	auth = (keys.get("auth") or "").strip()
	if not endpoint or not p256dh or not auth:
		return jsonify({"error": "Assinatura push inválida."}), 400

	subscription = PushSubscription.query.filter_by(endpoint=endpoint).first()
	if subscription is None:
		subscription = PushSubscription(endpoint=endpoint)
		db.session.add(subscription)
	subscription.user_id = current_user.id
	subscription.p256dh = p256dh
	subscription.auth = auth
	db.session.commit()
	return jsonify({"success": True}), 201


@notifications_bp.route("/push/unsubscribe", methods=["POST"])
@login_required
def unsubscribe_push():
	data = request.get_json(silent=True) or {}
	endpoint = (data.get("endpoint") or "").strip()
	if endpoint:
		PushSubscription.query.filter_by(user_id=current_user.id, endpoint=endpoint).delete()
		db.session.commit()
	return jsonify({"success": True})


@notifications_bp.route("/external-message", methods=["POST"])
@login_required
def record_external_message():
	"""Persiste no usuário a mensagem recebida pelo Socket.IO do motor WhatsApp."""
	data = request.get_json(silent=True) or {}
	external_id = str(data.get("id") or "").strip()
	if not external_id:
		return jsonify({"error": "ID da mensagem é obrigatório."}), 400
	existing = AppNotification.query.filter_by(
		user_id=current_user.id,
		entity_type="message",
		entity_id=external_id,
	).first()
	if existing:
		return jsonify(existing.to_dict())

	items = create_notifications(
		[current_user.id],
		notification_type="message",
		title=(data.get("title") or "Nova mensagem")[:200],
		message=(data.get("message") or "Você recebeu uma nova mensagem.")[:1000],
		url=(data.get("url") or "/helpdesk")[:500],
		entity_type="message",
		entity_id=external_id,
	)
	return jsonify(items[0].to_dict()), 201
