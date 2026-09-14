import unittest
from unittest.mock import patch

from flask import Flask

from app import db
from app.blueprints.tickets import bp as tickets_bp
from app.models import Ticket, User
from app.ticket_notify import (
	ensure_ticket_public_token,
	notify_assigned_technician,
	serialize_public_ticket,
	ticket_public_url,
)


class TicketPublicNotifyTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(self.app)
		self.app.register_blueprint(tickets_bp, url_prefix="/tickets")
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		self.user = User(
			name="Técnico",
			email="tech@example.invalid",
			password_hash="x",
			phone="34999998888",
		)
		db.session.add(self.user)
		db.session.commit()
		self.client = self.app.test_client()

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def _ticket(self, assigned=True):
		ticket = Ticket(
			title="Impressora parada",
			description="Não liga",
			solicitante="Cleide",
			external_client_name="Padaria Maisa",
			opened_by_id=self.user.id,
			assigned_to_id=self.user.id if assigned else None,
		)
		db.session.add(ticket)
		db.session.commit()
		return ticket

	def test_token_is_stable_after_first_generation(self):
		ticket = self._ticket()
		first = ensure_ticket_public_token(ticket)
		db.session.commit()
		second = ensure_ticket_public_token(ticket)
		self.assertEqual(first, second)
		self.assertTrue(len(first) > 20)

	def test_public_url_uses_token(self):
		ticket = self._ticket()
		url = ticket_public_url(ticket)
		self.assertIn(ticket.public_token, url)
		self.assertIn("/chamados/publico/", url)

	def test_public_api_does_not_require_login(self):
		ticket = self._ticket()
		token = ensure_ticket_public_token(ticket)
		db.session.commit()
		res = self.client.get(f"/tickets/api/publico/{token}")
		self.assertEqual(res.status_code, 200)
		payload = res.get_json()
		self.assertEqual(payload["id"], ticket.id)
		self.assertEqual(payload["title"], "Impressora parada")
		self.assertEqual(payload["client_name"], "Padaria Maisa")
		self.assertNotIn("public_token", payload)

	def test_public_api_unknown_token_is_404(self):
		res = self.client.get("/tickets/api/publico/token-inexistente")
		self.assertEqual(res.status_code, 404)

	def test_notify_sends_whatsapp_when_assigned(self):
		ticket = self._ticket()
		with patch("app.ticket_notify.Thread") as thread_cls:
			notify_assigned_technician(ticket)
			thread_cls.assert_called_once()
		self.assertTrue(ticket.public_token)

	def test_notify_skips_unassigned_ticket(self):
		ticket = self._ticket(assigned=False)
		with patch("app.ticket_notify.Thread") as thread_cls:
			notify_assigned_technician(ticket)
			thread_cls.assert_not_called()

	def test_serialize_public_ticket_is_minimal(self):
		ticket = self._ticket()
		data = serialize_public_ticket(ticket)
		self.assertEqual(data["solicitante"], "Cleide")
		self.assertEqual(set(data), {
			"id",
			"code",
			"title",
			"description",
			"status",
			"client_name",
			"solicitante",
			"service_name",
			"assigned_to_name",
			"created_at",
		})


if __name__ == "__main__":
	unittest.main()
