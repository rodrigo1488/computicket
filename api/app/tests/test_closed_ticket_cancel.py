import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from app import db
from app.blueprints.tickets import api_cancel_ticket
from app.models import Ticket, User


class ClosedTicketCancelTest(unittest.TestCase):
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
		user = User(name="Técnico", email="tech@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.flush()
		self.user_id = user.id
		db.session.add(Ticket(
			id=42,
			title="Atendimento",
			status="fechado",
			opened_by_id=user.id,
			total_cost=250.0,
			ps_printed=True,
			ps_number="PS/TICKET-42",
			ps_file="ps-42.pdf",
			ps_operation_key="c4d32586-3a08-4b26-b02c-405f25e1cfee",
		))
		db.session.commit()
		self.admin = SimpleNamespace(
			id=self.user_id,
			name="Administrador",
			email="admin@example.invalid",
			has_role=lambda role: role == "admin",
		)

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def invoke(self, payload=None):
		with self.app.test_request_context(json=payload or {}):
			with (
				patch("app.blueprints.tickets.current_user", self.admin),
				patch("app.blueprints.tickets._serialize_ticket_detail", return_value={"id": 42}),
				patch("app.blueprints.tickets.notify_helpdesk_ticket"),
			):
				return api_cancel_ticket.__wrapped__(42)

	def test_cancels_closed_ticket_and_ps_without_erasing_audit_value(self):
		with patch("app.blueprints.tickets._delete_ticket_ps_from_unico") as remove_ps:
			response = self.invoke({"reason": "Cobrança indevida"})

		self.assertEqual(response.status_code, 200)
		remove_ps.assert_called_once_with("PS/TICKET-42")
		ticket = db.session.get(Ticket, 42)
		self.assertEqual(ticket.status, "cancelado")
		self.assertEqual(ticket.total_cost, 250.0)
		self.assertFalse(ticket.ps_printed)
		self.assertIsNone(ticket.ps_number)
		self.assertEqual(ticket.cancellation_reason, "Cobrança indevida")
		self.assertEqual(ticket.cancelled_by_id, self.user_id)
		self.assertIsNotNone(ticket.cancelled_at)

	def test_keeps_local_ticket_unchanged_when_unico_fails(self):
		with patch(
			"app.blueprints.tickets._delete_ticket_ps_from_unico",
			side_effect=RuntimeError("offline"),
		):
			response, status = self.invoke()

		self.assertEqual(status, 502)
		self.assertIn("offline", response.get_json()["error"])
		db.session.expire_all()
		ticket = db.session.get(Ticket, 42)
		self.assertEqual(ticket.status, "fechado")
		self.assertEqual(ticket.ps_number, "PS/TICKET-42")
		self.assertEqual(ticket.total_cost, 250.0)

	def test_cancels_open_ticket_without_unico(self):
		ticket = db.session.get(Ticket, 42)
		ticket.status = "aberto"
		ticket.ps_printed = False
		ticket.ps_number = None
		ticket.ps_file = None
		ticket.assigned_to_id = self.user_id
		db.session.commit()

		with patch("app.blueprints.tickets._delete_ticket_ps_from_unico") as remove_ps:
			response = self.invoke({"reason": "Cliente desistiu"})

		self.assertEqual(response.status_code, 200)
		remove_ps.assert_not_called()
		ticket = db.session.get(Ticket, 42)
		self.assertEqual(ticket.status, "cancelado")
		self.assertEqual(ticket.cancellation_reason, "Cliente desistiu")
		self.assertIsNone(ticket.in_progress_started_at)

	def test_open_ticket_forbidden_for_other_user(self):
		ticket = db.session.get(Ticket, 42)
		ticket.status = "em_andamento"
		ticket.ps_number = None
		ticket.assigned_to_id = self.user_id + 99
		ticket.opened_by_id = self.user_id + 99
		db.session.commit()
		other = SimpleNamespace(
			id=self.user_id + 1,
			name="Outro",
			email="other@example.invalid",
			has_role=lambda role: False,
		)
		with self.app.test_request_context(json={}):
			with (
				patch("app.blueprints.tickets.current_user", other),
				patch("app.blueprints.tickets._serialize_ticket_detail", return_value={"id": 42}),
				patch("app.blueprints.tickets.notify_helpdesk_ticket"),
			):
				response, status = api_cancel_ticket.__wrapped__(42)

		self.assertEqual(status, 403)
		ticket = db.session.get(Ticket, 42)
		self.assertEqual(ticket.status, "em_andamento")

	def test_repeated_cancel_is_idempotent(self):
		ticket = db.session.get(Ticket, 42)
		ticket.status = "cancelado"
		ticket.ps_printed = False
		ticket.ps_number = None
		db.session.commit()

		response = self.invoke()

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.get_json()["already_cancelled"])


if __name__ == "__main__":
	unittest.main()
