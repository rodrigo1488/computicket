import os
import unittest
from unittest.mock import patch

from flask import Flask
from werkzeug.security import generate_password_hash

from app import db
from app.blueprints.agenda import agenda_bp
from app.blueprints.helpdesk import helpdesk_bp
from app.models import Appointment, HelpDeskContactClientLink, User


class WhatsappAgentApiTest(unittest.TestCase):
	def setUp(self):
		os.environ["COMPUTICKET_INTERNAL_TOKEN"] = "test-token"
		self.app = Flask(__name__)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(self.app)
		self.app.register_blueprint(helpdesk_bp)
		self.app.register_blueprint(agenda_bp, url_prefix="/agenda")
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		user = User(
			name="Ana Técnica",
			email="ana@example.invalid",
			password_hash=generate_password_hash("secret12"),
			role="admin",
			status="1",
		)
		db.session.add(user)
		db.session.commit()
		self.user_id = user.id
		self.client = self.app.test_client()
		self.headers = {"X-Internal-Token": "test-token"}

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()
		os.environ.pop("COMPUTICKET_INTERNAL_TOKEN", None)

	@patch("app.services.whatsapp_agent.answer_question")
	def test_context_without_sources_has_no_evidence(self, answer):
		answer.return_value = {
			"draft": "Não encontrei evidências suficientes.",
			"sources": [],
		}
		response = self.client.post(
			"/helpdesk/api/internal/agent/context",
			json={"question": "Qual o horário de atendimento?", "history": ""},
			headers=self.headers,
		)
		self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
		body = response.get_json()
		self.assertFalse(body["has_evidence"])
		self.assertEqual(body["draft"], "")
		self.assertEqual(body["technicians"][0]["name"], "Ana Técnica")

	def test_context_rejects_missing_token(self):
		response = self.client.post(
			"/helpdesk/api/internal/agent/context",
			json={"question": "oi"},
		)
		self.assertEqual(response.status_code, 401)

	@patch("app.blueprints.agenda.notify_appointment_whatsapp", return_value={})
	@patch("app.blueprints.agenda.enviar_email_confirmacao", return_value=False)
	@patch("app.notification_service.create_notifications")
	def test_agenda_refuses_contact_without_client(self, _notify, _email, _whatsapp):
		response = self.client.post(
			"/agenda/api/internal/from-whatsapp",
			json={
				"title": "Visita",
				"appointment_date": "2026-11-04T14:00:00",
				"engine_contact_id": 99,
				"tecnico": "Ana Técnica",
			},
			headers=self.headers,
		)
		self.assertEqual(response.status_code, 422, response.get_data(as_text=True))
		self.assertEqual(response.get_json()["code"], "client_unlinked")
		self.assertEqual(Appointment.query.count(), 0)

	@patch("app.blueprints.agenda.notify_appointment_whatsapp", return_value={})
	@patch("app.blueprints.agenda.enviar_email_confirmacao", return_value=False)
	@patch("app.notification_service.create_notifications")
	def test_agenda_creates_visit_for_linked_client(self, _notify, _email, _whatsapp):
		db.session.add(
			HelpDeskContactClientLink(
				engine_contact_id=7,
				contact_number="5511999999999",
				external_client_id=55,
				external_client_name="Padaria",
			)
		)
		db.session.commit()
		response = self.client.post(
			"/agenda/api/internal/from-whatsapp",
			json={
				"title": "Visita",
				"appointment_date": "2026-11-04T14:00:00",
				"engine_contact_id": 7,
				"tecnico": "Ana Técnica",
				"description": "Troca de nobreak",
			},
			headers=self.headers,
		)
		self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
		body = response.get_json()
		self.assertTrue(body["ok"])
		self.assertIn("Ana Técnica", body["message"])
		appointment = Appointment.query.one()
		self.assertEqual(appointment.client_id, 55)
		self.assertEqual(appointment.user_id, self.user_id)
		self.assertEqual(appointment.title, "Visita")
