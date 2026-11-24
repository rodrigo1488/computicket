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

	def _search_os_row(self, codigo, status, fimservico=None, tech=""):
		return (
			codigo,
			10,
			datetime(2026, 7, 1, 9, 0),
			"Notebook",
			"Não liga",
			"Troca de fonte",
			status,
			200.0,
			"",
			fimservico,
			tech,
			"Cliente Z",
		)

	def _search_conn(self, open_rows=None, exact_row=None, client_row=None, ps_row=None):
		cursor = MagicMock()
		cursor.fetchall.return_value = open_rows or []
		fetches = []
		if exact_row is not None:
			fetches.append(exact_row)
		if client_row is not None:
			fetches.append(client_row)
		fetches.append(ps_row)
		fetches.append(None)
		cursor.fetchone.side_effect = fetches
		conn = MagicMock()
		conn.cursor.return_value = cursor
		conn.closed = False
		conn.autocommit = True
		return conn, cursor

	def test_search_orphan_by_exact_code(self):
		fim = datetime(2026, 7, 15, 14, 30)
		exact = self._search_os_row(8801, 5, fimservico=fim, tech="João Silva")
		client_row = (10, "Cliente Z", "123", "999", None, "Rua A", "1", None, None)
		conn, _cursor = self._search_conn(exact_row=exact, client_row=client_row, ps_row=("PS/OS-8801",))

		with (
			self.app.test_request_context("/ordens-servico/search?q=8801"),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import search_service_orders

			response = search_service_orders()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertFalse(payload.get("already_in_computicket"))
		self.assertEqual(len(payload["results"]), 1)
		item = payload["results"][0]
		self.assertTrue(item["orphan"])
		self.assertEqual(item["codigo"], "8801")
		self.assertEqual(item["tecnico"], "João Silva")
		self.assertEqual(item["data_conclusao"], "15/07/2026 14:30")
		self.assertEqual(item["ps_number"], "PS/OS-8801")

	def test_search_already_in_computicket(self):
		db.session.add(ServiceOrder(
			codigo="8802",
			client_name="Cliente Z",
			service_executed="Ok",
			status=5,
			technician_name="Técnico Teste",
			value=10,
		))
		db.session.commit()
		exact = self._search_os_row(8802, 5, fimservico=datetime(2026, 7, 15, 14, 30), tech="João")
		conn, _cursor = self._search_conn(exact_row=exact)

		with (
			self.app.test_request_context("/ordens-servico/search?q=8802"),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import search_service_orders

			response = search_service_orders()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertEqual(payload["results"], [])
		self.assertTrue(payload.get("already_in_computicket"))

	def test_search_skips_local_status_3(self):
		db.session.add(ServiceOrder(
			codigo="8803",
			client_name="Cliente Z",
			service_executed="Ok",
			status=3,
			technician_name="Técnico Teste",
			value=0,
		))
		db.session.commit()
		open_row = self._search_os_row(8803, 3, fimservico=datetime(2026, 7, 10, 11, 0), tech="João")
		conn, _cursor = self._search_conn(open_rows=[open_row])

		with (
			self.app.test_request_context("/ordens-servico/search?q=8803"),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import search_service_orders

			response = search_service_orders()

		payload = response.get_json()
		self.assertEqual(payload["results"], [])
		self.assertTrue(payload.get("already_in_computicket"))

	def test_sync_orphan_does_not_update_unico(self):
		joao = User(name="João Silva", email="joao@example.invalid", password_hash="x")
		db.session.add(joao)
		db.session.commit()
		fim = datetime(2026, 7, 15, 14, 30)
		os_row = (
			8801,
			10,
			datetime(2026, 7, 1, 9, 0),
			"Notebook",
			"Não liga",
			"Troca de fonte",
			5,
			200.0,
			"",
			fim,
			"João Silva",
		)
		client_row = (10, "Cliente Z", "123", "999", None, "Rua A", "1", "Contrato X", None)
		conn, cursor = self._pg_conn(os_row, client_row)
		cursor.fetchone.side_effect = [os_row, client_row, ("PS/OS-8801",), None]

		with (
			self.app.test_request_context(
				"/ordens-servico/processar-finalizacao",
				method="POST",
				json={
					"codigo": "8801",
					"servico_executado": "Troca de fonte",
					"valor": 999,
					"produtos": [],
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.service_orders.insert_ps_with_transaction_control") as insert_ps,
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import process_finalization

			response = process_finalization()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertTrue(payload.get("orphan_synced"))
		insert_ps.assert_not_called()
		update_calls = [
			str(c.args[0])
			for c in cursor.execute.call_args_list
			if c.args and "UPDATE ordemservico" in str(c.args[0])
		]
		self.assertEqual(update_calls, [])
		saved = ServiceOrder.query.filter_by(codigo="8801").first()
		self.assertIsNotNone(saved)
		self.assertEqual(saved.value, 200.0)
		self.assertEqual(saved.status, 5)
		self.assertEqual(saved.completion_date, fim)
		self.assertEqual(saved.technician_name, "João Silva")
		self.assertEqual(saved.technician_id, joao.id)
		self.assertEqual(saved.ps_number, "PS/OS-8801")
		self.assertTrue(saved.has_contract)

	def test_sync_orphan_already_local_returns_409(self):
		db.session.add(ServiceOrder(
			codigo="8801",
			client_name="Cliente Z",
			service_executed="Ok",
			status=5,
			technician_name="Técnico Teste",
			value=200,
		))
		db.session.commit()
		os_row = (
			8801, 10, datetime(2026, 7, 1, 9, 0),
			"Notebook", "Não liga", "Troca de fonte",
			5, 200.0, "", datetime(2026, 7, 15, 14, 30), "João",
		)
		client_row = (10, "Cliente Z", "123", None, None, None, None, None, None)
		conn, _cursor = self._pg_conn(os_row, client_row)

		with (
			self.app.test_request_context(
				"/ordens-servico/processar-finalizacao",
				method="POST",
				json={"codigo": "8801", "servico_executado": "Troca de fonte", "valor": 200, "produtos": []},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import process_finalization

			response = process_finalization()

		if isinstance(response, tuple):
			response, status = response
		else:
			status = response.status_code
		self.assertEqual(status, 409)
		self.assertTrue(response.get_json().get("already_in_computicket"))
		self.assertEqual(ServiceOrder.query.filter_by(codigo="8801").count(), 1)

	def test_mensalista_with_products_registers_receivable_and_generates_separate_pdfs(self):
		os_row = (
			9501,
			25,
			datetime(2026, 9, 10, 9, 0),
			"Servidor Dell",
			"Troca de SSD",
			"",
			2,
			0.0,
			"",
		)
		# extra9="MENSAL OURO", extra10=1 (mensalista / não cobra atendimento)
		client_row = (25, "Empresa Mensalista", "12.345.678/0001-99", "34999990000", None, "Av. Brasil", "100", "MENSAL OURO", 1)
		conn, cursor = self._pg_conn(os_row, client_row)
		products_validated = [
			{
				"id": 77,
				"codigo": "SSD480",
				"nome": "SSD Kingston 480GB",
				"unidademedida": "UN",
				"preco": 250.0,
				"quantidade": 2.0,
				"estoque": 10.0,
			}
		]

		with (
			self.app.test_request_context(
				"/ordens-servico/processar-finalizacao",
				method="POST",
				json={
					"codigo": 9501,
					"servico_executado": "Instalação de 2 SSDs em RAID",
					"valor": 0,
					"produtos": [{"id": 77, "quantidade": 2}],
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.service_orders.validate_products", return_value=(products_validated, None)),
			patch("app.blueprints.service_orders.create_dav", return_value=(501, 3001)) as create_dav_mock,
			patch("app.models.SystemConfig.get", return_value="false"),
			patch(
				"app.blueprints.service_orders.insert_ps_with_transaction_control",
				return_value=(True, ("PS/OS-9501", "9501")),
			) as insert_fin_mock,
			patch(
				"app.blueprints.service_orders.generateBillingOrderPDF",
				return_value=(True, "pedido-faturamento-os-9501.pdf"),
			) as billing_pdf_mock,
			patch(
				"app.blueprints.service_orders.generateDeliveryReceipt",
				return_value=(True, "recibo-entrega-9501.pdf"),
			) as receipt_pdf_mock,
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import process_finalization

			response = process_finalization()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		self.assertTrue(payload["no_charge"])
		self.assertEqual(payload["final_status"], 3)
		self.assertEqual(payload["dav_id"], 501)
		self.assertEqual(payload["dav_codigo"], 3001)
		self.assertEqual(payload["products_value"], 500.0)
		self.assertTrue(payload["ps_generated"])
		self.assertTrue(payload["billing_order_generated"])
		self.assertEqual(payload["ps_number"], "PS/OS-9501")
		self.assertEqual(payload["ps_file"], "pedido-faturamento-os-9501.pdf")
		self.assertTrue(payload["delivery_generated"])
		self.assertEqual(payload["delivery_file"], "recibo-entrega-9501.pdf")

		create_dav_mock.assert_called_once()
		insert_fin_mock.assert_called_once()
		self.assertEqual(insert_fin_mock.call_args.args[0], 25)
		self.assertEqual(insert_fin_mock.call_args.args[2], 500.0)
		self.assertIn("Pedido de Faturamento #3001", insert_fin_mock.call_args.args[5])
		billing_pdf_mock.assert_called_once()
		receipt_pdf_mock.assert_called_once()

		# Confere geroufinanceiro=1 no UPDATE ordemservico
		update_params = [
			c.args[1]
			for c in cursor.execute.call_args_list
			if len(c.args) >= 2 and "UPDATE ordemservico" in str(c.args[0])
		]
		self.assertEqual(len(update_params), 1)
		self.assertEqual(update_params[0][2], 3)  # status 3 (mensalista)
		self.assertEqual(update_params[0][4], 1)  # geroufinanceiro = 1

		saved = ServiceOrder.query.filter_by(codigo="9501").first()
		self.assertIsNotNone(saved)
		self.assertEqual(saved.value, 0.0)
		self.assertEqual(saved.products_value, 500.0)
		self.assertEqual(saved.dav_id, 501)
		self.assertEqual(saved.dav_codigo, 3001)
		self.assertEqual(saved.ps_number, "PS/OS-9501")
		self.assertEqual(saved.ps_file, "pedido-faturamento-os-9501.pdf")
		self.assertEqual(saved.delivery_file, "recibo-entrega-9501.pdf")

	def test_mensalista_without_products_generates_only_delivery_receipt(self):
		os_row = (
			9502,
			25,
			datetime(2026, 9, 10, 10, 0),
			"PC Recepção",
			"Formatação",
			"",
			2,
			0.0,
			"",
		)
		client_row = (25, "Empresa Mensalista", "12.345.678/0001-99", None, None, None, None, "MENSAL OURO", 1)
		conn, _cursor = self._pg_conn(os_row, client_row)

		with (
			self.app.test_request_context(
				"/ordens-servico/processar-finalizacao",
				method="POST",
				json={
					"codigo": 9502,
					"servico_executado": "Formatação padrão",
					"valor": 0,
					"produtos": [],
				},
			),
			patch("app.blueprints.service_orders.connect_postgres", return_value=conn),
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.service_orders.validate_products", return_value=([], None)),
			patch("app.models.SystemConfig.get", return_value="false"),
			patch("app.blueprints.service_orders.insert_ps_with_transaction_control") as insert_fin_mock,
			patch(
				"app.blueprints.service_orders.generateDeliveryReceipt",
				return_value=(True, "recibo-entrega-9502.pdf"),
			) as receipt_pdf_mock,
			patch("flask_login.utils._get_user", return_value=self.user),
		):
			from app.blueprints.service_orders import process_finalization

			response = process_finalization()

		self.assertEqual(response.status_code, 200)
		payload = response.get_json()
		insert_fin_mock.assert_not_called()
		receipt_pdf_mock.assert_called_once()
		self.assertFalse(payload["ps_generated"])
		self.assertFalse(payload["billing_order_generated"])
		self.assertIsNone(payload["ps_file"])
		self.assertEqual(payload["delivery_file"], "recibo-entrega-9502.pdf")


if __name__ == "__main__":
	unittest.main()
