"""Abertura de OS no Uniplus (inverso da finalização)."""
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask
from flask_login import LoginManager

from app import db
from app.blueprints.service_orders import bp as service_orders_bp
from app.models import User


class ServiceOrderOpenTest(unittest.TestCase):
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

	def _pg_conn(self, client_row=(10, "Cliente Z", "123"), next_ids=(17659, 17390), returning=(17659, 17390)):
		cursor = MagicMock()
		cursor.fetchone.side_effect = [client_row, next_ids, returning]
		conn = MagicMock()
		conn.cursor.return_value = cursor
		conn.closed = False
		conn.autocommit = True
		return conn, cursor

	def test_validation_requires_client_and_fields(self):
		with (
			self.app.test_request_context(
				"/ordens-servico/abrir",
				method="POST",
				json={"descricaoitem": "PC", "problemadescrito": "Travando"},
			),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import open_service_order

			response = open_service_order()
		if isinstance(response, tuple):
			response, status = response
		else:
			status = response.status_code
		self.assertEqual(status, 400)
		self.assertIn("Cliente", response.get_json()["error"])

	def test_opens_via_uniplus_agent(self):
		conn, cursor = self._pg_conn()
		with (
			self.app.test_request_context(
				"/ordens-servico/abrir",
				method="POST",
				json={
					"client_id": 10,
					"descricaoitem": "Notebook Acer",
					"problemadescrito": "Não liga",
					"solicitante": "Willian",
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.uniplus_jobs.agent_enabled", return_value=True),
			patch("app.uniplus_jobs.enqueue_and_wait", return_value={
				"ok": True,
				"id": 17659,
				"codigo": 17390,
				"status": 2,
				"idcliente": 10,
				"nomecliente": "Cliente Z",
			}) as enqueue,
			patch(
				"app.services.faturamento_products.get_external_user_data",
				return_value=(51, 1489),
			),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import open_service_order

			response = open_service_order()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertEqual(payload["codigo"], 17390)
		self.assertIn("Uniplus", payload["message"])
		enqueue.assert_called_once()
		job_type, job_payload = enqueue.call_args.args[:2]
		self.assertEqual(job_type, "open_ordemservico")
		self.assertEqual(job_payload["client_id"], 10)
		self.assertEqual(job_payload["descricaoitem"], "Notebook Acer")
		self.assertEqual(job_payload["solicitante"], "Willian")
		self.assertEqual(job_payload["external_user_id"], 51)
		insert_calls = [
			str(c.args[0])
			for c in cursor.execute.call_args_list
			if c.args and "INSERT INTO ordemservico" in str(c.args[0])
		]
		self.assertEqual(insert_calls, [])

	def test_legacy_insert_when_agent_disabled(self):
		conn, cursor = self._pg_conn()
		with (
			self.app.test_request_context(
				"/ordens-servico/abrir",
				method="POST",
				json={
					"client_id": 10,
					"equipamento": "Impressora Epson",
					"problema": "Seca",
					"serial": "SN",
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch(
				"app.services.faturamento_products.get_external_user_data",
				return_value=(35, 4322),
			),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import open_service_order

			response = open_service_order()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertEqual(payload["codigo"], 17390)
		insert_sql = [
			c.args[0]
			for c in cursor.execute.call_args_list
			if c.args and "INSERT INTO ordemservico" in str(c.args[0])
		]
		self.assertEqual(len(insert_sql), 1)
		params = [
			c.args[1]
			for c in cursor.execute.call_args_list
			if c.args and "INSERT INTO ordemservico" in str(c.args[0])
		][0]
		self.assertEqual(params[3], "Impressora Epson")
		self.assertEqual(params[4], "Seca")
		self.assertEqual(params[7], 4322)
		self.assertEqual(params[10], 2)
		self.assertEqual(params[35], "SN")
		conn.commit.assert_called()

	def test_print_abertura_requires_codigo(self):
		with (
			self.app.test_request_context(
				"/ordens-servico/imprimir-abertura",
				method="POST",
				json={"formato": "a4"},
			),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import print_open_service_order

			response = print_open_service_order()
		if isinstance(response, tuple):
			response, status = response
		else:
			status = response.status_code
		self.assertEqual(status, 400)

	def test_print_abertura_generates_thermal_and_a4_pdf(self):
		import tempfile
		from pathlib import Path

		from app.blueprints.printer import generateOpenServiceOrderPDF

		with tempfile.TemporaryDirectory() as tmp:
			with patch("app.blueprints.printer._ps_output_dir", return_value=tmp):
				ok_t, thermal = generateOpenServiceOrderPDF(
					os_number="17390",
					client_name="Cliente Z",
					equipment="Notebook Acer",
					problem="Não liga",
					responsible_name="Técnico Teste",
					solicitante="Willian",
					formato="termica",
				)
				ok_a, a4 = generateOpenServiceOrderPDF(
					os_number="17390",
					client_name="Cliente Z",
					equipment="Notebook Acer",
					problem="Não liga",
					responsible_name="Técnico Teste",
					formato="a4",
				)
			self.assertTrue(ok_t)
			self.assertTrue(ok_a)
			self.assertEqual(thermal, "os-abertura-17390-termica.pdf")
			self.assertEqual(a4, "os-abertura-17390-a4.pdf")
			thermal_path = Path(tmp) / thermal
			a4_path = Path(tmp) / a4
			self.assertTrue(thermal_path.is_file())
			self.assertTrue(a4_path.is_file())
			self.assertTrue(thermal_path.read_bytes().startswith(b"%PDF"))
			self.assertTrue(a4_path.read_bytes().startswith(b"%PDF"))

		with tempfile.TemporaryDirectory() as tmp:
			with (
				self.app.test_request_context(
					"/ordens-servico/imprimir-abertura",
					method="POST",
					json={
						"codigo": "17390",
						"formato": "termica",
						"client_name": "Cliente Z",
						"descricaoitem": "Notebook",
						"problemadescrito": "Não liga",
					},
				),
				patch("app.blueprints.printer._ps_output_dir", return_value=tmp),
				patch("flask_login.utils._get_user", return_value=self.user),
			):
				from app.blueprints.service_orders import print_open_service_order

				response = print_open_service_order()
			self.assertEqual(response.status_code, 200)
			payload = response.get_json()
			self.assertEqual(payload["formato"], "termica")
			self.assertEqual(payload["pdf_file"], "os-abertura-17390-termica.pdf")


if __name__ == "__main__":
	unittest.main()
