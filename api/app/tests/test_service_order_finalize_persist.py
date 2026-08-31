"""Garante que falha/conflito de PS não impede persistir a OS no SQLite (listagem)."""
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

from flask import Flask
from flask_login import LoginManager

from app import db
from app.blueprints.printer import PS_DOCUMENT_CONFLICT
from app.blueprints.service_orders import bp as service_orders_bp
from app.models import ServiceOrder, User


class ServiceOrderFinalizePersistTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(self.app)
		login_manager = LoginManager()
		login_manager.init_app(self.app)

		@login_manager.user_loader
		def load_user(user_id):
			return db.session.get(User, int(user_id))

		self.app.register_blueprint(service_orders_bp, url_prefix="/ordens-servico")
		self.ctx = self.app.app_context()
		self.ctx.push()
		db.create_all()
		self.user = User(name="Técnico Teste", email="os@example.invalid", password_hash="x")
		db.session.add(self.user)
		db.session.commit()

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.ctx.pop()

	def _pg_conn(self, os_row, client_row=None):
		cursor = MagicMock()
		# 1ª fetchone: OS; 2ª: cliente (se houver)
		cursor.fetchone.side_effect = [os_row, client_row]
		conn = MagicMock()
		conn.cursor.return_value = cursor
		conn.closed = False
		conn.autocommit = True
		return conn, cursor

	def test_ps_conflict_still_saves_service_order_as_json(self):
		os_row = (
			9001,
			10,
			datetime(2026, 8, 1, 10, 0),
			"Notebook",
			"Não liga",
			"",
			1,
			150.0,
			"",
		)
		client_row = (10, "Cliente Z", "123", "999", None, "Rua A", "1", None, None)
		conn, _cursor = self._pg_conn(os_row, client_row)

		with (
			self.app.test_request_context(
				"/ordens-servico/processar-finalizacao",
				method="POST",
				json={
					"codigo": 9001,
					"servico_executado": "Troca de fonte",
					"valor": 150,
					"produtos": [],
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.blueprints.service_orders.agent_enabled", return_value=False, create=True),
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.service_orders.validate_products", return_value=([], None)),
			patch("app.models.SystemConfig.get", return_value="false"),
			patch(
				"app.blueprints.service_orders.insert_ps_with_transaction_control",
				return_value=(False, f"{PS_DOCUMENT_CONFLICT}PS/OS-9001"),
			),
			patch(
				"app.blueprints.service_orders.generateCombinedPSAndDeliveryReceipt",
				return_value=(True, "ps-recibo-9001.pdf"),
			),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import process_finalization

			response = process_finalization()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertIn("finalizada com sucesso", payload["message"].lower())
		self.assertEqual(payload["ps_number"], "PS/OS-9001")
		saved = ServiceOrder.query.filter_by(codigo="9001").first()
		self.assertIsNotNone(saved)
		self.assertEqual(saved.client_name, "Cliente Z")
		self.assertEqual(saved.status, 5)
		self.assertEqual(saved.ps_number, "PS/OS-9001")
		self.assertTrue(saved.ps_generated)

	def test_ps_hard_failure_still_saves_without_redirect(self):
		os_row = (
			9002,
			10,
			datetime(2026, 8, 1, 10, 0),
			"PC",
			"Lento",
			"Limpeza",
			1,
			80.0,
			"",
		)
		client_row = (10, "Cliente Y", "456", None, None, None, None, None, None)
		conn, _cursor = self._pg_conn(os_row, client_row)

		with (
			self.app.test_request_context(
				"/ordens-servico/processar-finalizacao",
				method="POST",
				json={
					"codigo": "9002",
					"servico_executado": "Limpeza",
					"valor": 80,
					"produtos": [],
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.service_orders.validate_products", return_value=([], None)),
			patch("app.models.SystemConfig.get", return_value="false"),
			patch(
				"app.blueprints.service_orders.insert_ps_with_transaction_control",
				return_value=(False, "Erro ao registrar PS no PostgreSQL/Unico: down"),
			),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import process_finalization

			response = process_finalization()

		# Antes do fix: redirect HTML (302) e zero linhas no SQLite
		self.assertEqual(response.status_code, 200)
		self.assertFalse(hasattr(response, "location") and response.location)
		payload = response.get_json()
		self.assertIsNotNone(payload)
		self.assertIn("ps_warning", payload)
		saved = ServiceOrder.query.filter_by(codigo="9002").first()
		self.assertIsNotNone(saved)
		self.assertEqual(saved.value, 80.0)
		self.assertFalse(saved.ps_generated)


if __name__ == "__main__":
	unittest.main()
