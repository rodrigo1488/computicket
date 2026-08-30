import unittest

from flask import Flask

from app import db
from app.blueprints.helpdesk import _visible_linked_ticket_id
from app.models import Ticket, User


class HelpdeskTicketLinkVisibilityTest(unittest.TestCase):
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
		user = User(name="Agente", email="agente@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.flush()
		self.user_id = user.id

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def _ticket(self, status="aberto"):
		ticket = Ticket(title="Atendimento", status=status, opened_by_id=self.user_id)
		db.session.add(ticket)
		db.session.commit()
		return ticket

	def test_keeps_open_ticket_on_active_conversation(self):
		ticket = self._ticket("aberto")
		self.assertEqual(_visible_linked_ticket_id(ticket.id, "pending"), ticket.id)

	def test_hides_closed_ticket_when_conversation_reopens(self):
		ticket = self._ticket("fechado")
		self.assertIsNone(_visible_linked_ticket_id(ticket.id, "pending"))
		self.assertIsNone(_visible_linked_ticket_id(ticket.id, "open"))

	def test_keeps_closed_ticket_on_resolved_conversation(self):
		ticket = self._ticket("fechado")
		self.assertEqual(_visible_linked_ticket_id(ticket.id, "closed"), ticket.id)

	def test_hides_cancelled_ticket_on_new_pending_conversation(self):
		ticket = self._ticket("cancelado")
		self.assertIsNone(_visible_linked_ticket_id(ticket.id, "pending"))


if __name__ == "__main__":
	unittest.main()
