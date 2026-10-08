import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from app import db, login_manager
from app.blueprints import tickets as tickets_bp_module
from app.blueprints.tickets import (
	STALE_CANCEL_MIN_AGE_DAYS,
	api_cancel_stale_ticket,
	ticket_exceeds_cancel_age,
)
from app.models import Ticket, User

NOW = datetime(2026, 10, 8, 12, 0, 0)  # "agora" fixo (UTC naive)


class CancelStaleTicketTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(self.app)
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		user = User(name="Admin", email="admin@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.flush()
		self.user_id = user.id
		self.admin = SimpleNamespace(
			id=user.id, name="Administrador", has_role=lambda role: role == "admin",
		)
		self.tech = SimpleNamespace(
			id=user.id, name="Técnico", has_role=lambda role: False,
		)

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def make_ticket(self, ticket_id=1, age=timedelta(days=8), status="aberto", **extra):
		db.session.add(Ticket(
			id=ticket_id,
			title="Atendimento antigo",
			status=status,
			opened_by_id=self.user_id,
			created_at=NOW - age,
			**extra,
		))
		db.session.commit()

	def invoke(self, ticket_id=1, payload=None, user=None):
		with self.app.test_request_context(json=payload or {}):
			with (
				patch.object(tickets_bp_module, "current_user", user or self.admin),
				patch.object(tickets_bp_module, "_utc_now_naive", return_value=NOW),
				patch.object(tickets_bp_module, "_serialize_ticket_detail", return_value={"id": ticket_id}),
				patch.object(tickets_bp_module, "notify_helpdesk_ticket") as notify,
			):
				result = api_cancel_stale_ticket.__wrapped__(ticket_id)
		self.notify = notify
		return result

	def test_limit_constant_is_seven_days(self):
		self.assertEqual(STALE_CANCEL_MIN_AGE_DAYS, 7)

	def test_non_admin_is_forbidden_and_ticket_untouched(self):
		self.make_ticket()
		response, status = self.invoke(user=self.tech)
		self.assertEqual(status, 403)
		self.assertEqual(db.session.get(Ticket, 1).status, "aberto")

	def test_nonexistent_ticket_returns_404(self):
		from werkzeug.exceptions import NotFound
		with self.assertRaises(NotFound):
			self.invoke(ticket_id=999)

	def test_ticket_younger_than_seven_days_is_refused(self):
		self.make_ticket(age=timedelta(days=3))
		response, status = self.invoke()
		self.assertEqual(status, 400)
		self.assertIn("mais de 7 dias", response.get_json()["error"])
		self.assertEqual(db.session.get(Ticket, 1).status, "aberto")

	def test_ticket_exactly_seven_days_is_refused(self):
		self.make_ticket(age=timedelta(days=7))
		response, status = self.invoke()
		self.assertEqual(status, 400)
		self.assertEqual(db.session.get(Ticket, 1).status, "aberto")
		self.assertIsNone(db.session.get(Ticket, 1).cancelled_at)

	def test_ticket_one_second_over_limit_is_cancelled(self):
		self.make_ticket(age=timedelta(days=7, seconds=1))
		response = self.invoke()
		self.assertEqual(response.status_code, 200)
		self.assertEqual(db.session.get(Ticket, 1).status, "cancelado")

	def test_old_ticket_is_cancelled_with_audit(self):
		self.make_ticket(age=timedelta(days=30), status="em_andamento", assigned_to_id=self.user_id)
		response = self.invoke(payload={"reason": "Abandonado pelo cliente"})
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.get_json()["success"])
		ticket = db.session.get(Ticket, 1)
		self.assertEqual(ticket.status, "cancelado")
		self.assertEqual(ticket.cancelled_by_id, self.user_id)
		self.assertIsNotNone(ticket.cancelled_at)
		self.assertEqual(ticket.cancellation_reason, "Abandonado pelo cliente")
		self.assertIsNone(ticket.in_progress_started_at)
		self.notify.assert_called_once()

	def test_old_closed_ticket_with_ps_removes_ps_from_unico(self):
		self.make_ticket(
			status="fechado", total_cost=100.0, ps_printed=True, ps_number="PS/TICKET-1",
		)
		with patch.object(tickets_bp_module, "_delete_ticket_ps_from_unico") as remove_ps:
			response = self.invoke()
		self.assertEqual(response.status_code, 200)
		remove_ps.assert_called_once_with("PS/TICKET-1")
		ticket = db.session.get(Ticket, 1)
		self.assertEqual(ticket.status, "cancelado")
		self.assertIsNone(ticket.ps_number)
		self.assertEqual(ticket.total_cost, 100.0)

	def test_unico_failure_keeps_ticket(self):
		self.make_ticket(status="fechado", ps_printed=True, ps_number="PS/TICKET-1")
		with patch.object(
			tickets_bp_module, "_delete_ticket_ps_from_unico", side_effect=RuntimeError("offline"),
		):
			response, status = self.invoke()
		self.assertEqual(status, 502)
		db.session.expire_all()
		self.assertEqual(db.session.get(Ticket, 1).status, "fechado")

	def test_already_cancelled_returns_409(self):
		self.make_ticket(status="cancelado")
		response, status = self.invoke()
		self.assertEqual(status, 409)
		self.assertIn("já está cancelado", response.get_json()["error"])

	def test_unauthenticated_is_refused_with_401(self):
		# @login_required real (sem o __wrapped__); sem login_view o Flask-Login responde 401.
		self.app.register_blueprint(tickets_bp_module.bp, url_prefix="/tickets")
		with patch.object(login_manager, "login_view", None):
			login_manager.init_app(self.app)
			resp = self.app.test_client().post("/tickets/api/1/cancel-stale", json={})
		self.assertEqual(resp.status_code, 401)

	def test_age_helper_boundary(self):
		ticket = Ticket(title="x", opened_by_id=1, created_at=NOW - timedelta(days=7))
		self.assertFalse(ticket_exceeds_cancel_age(ticket, NOW))
		ticket.created_at = NOW - timedelta(days=7, microseconds=1)
		self.assertTrue(ticket_exceeds_cancel_age(ticket, NOW))
		ticket.created_at = None
		self.assertFalse(ticket_exceeds_cancel_age(ticket, NOW))


if __name__ == "__main__":
	unittest.main()
