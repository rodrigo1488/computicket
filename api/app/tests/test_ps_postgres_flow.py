import unittest
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from app.blueprints.ps import list_files, merge_ps_records
from app.blueprints.printer import (
	build_ps_document,
	build_collision_ps_document,
	insert_ps_with_transaction_control,
	insert_service_sqlserver,
	PS_DOCUMENT_CONFLICT,
)
from app.external_pg import fetch_ps_financial_records
from app.blueprints.utils import LegacySqlServerDisabledError, connect_sql_server


class PsPostgresFlowTest(unittest.TestCase):
	def test_builds_stable_documents_for_ticket_and_service_order(self):
		self.assertEqual(build_ps_document(42, "Ticket #42"), "PS/TICKET-42")
		self.assertEqual(build_ps_document("OS 10/2", "OS #10"), "PS/OS-OS-10-2")

	def test_registers_ps_only_in_postgres_unico(self):
		cursor = MagicMock()
		cursor.fetchone.return_value = None
		conn = MagicMock()
		conn.cursor.return_value = cursor

		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.printer.connect_postgres", return_value=conn),
		):
			success, result = insert_ps_with_transaction_control(
				10, {}, 125.5, 42, "Ticket #42", "Atendimento"
			)

		self.assertTrue(success)
		self.assertEqual(result, ("PS/TICKET-42", "42"))
		self.assertEqual(conn.commit.call_count, 1)
		sql = cursor.execute.call_args_list[-1].args[0]
		self.assertIn("INSERT INTO financeiro", sql)

	def test_builds_unique_collision_document_from_operation_key(self):
		self.assertEqual(
			build_collision_ps_document(
				"PS/TICKET-2983",
				"c4d32586-3a08-4b26-b02c-405f25e1cfee",
			),
			"PS/TICKET-2983-C4D32586",
		)

	def test_reports_historical_document_collision(self):
		cursor = MagicMock()
		cursor.fetchone.return_value = ("Avulso",)
		conn = MagicMock()
		conn.cursor.return_value = cursor

		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.printer.connect_postgres", return_value=conn),
		):
			success, message = insert_ps_with_transaction_control(
				10,
				{},
				125.5,
				2983,
				"Ticket #2983",
				"Atendimento",
				operation_key="c4d32586-3a08-4b26-b02c-405f25e1cfee",
			)

		self.assertFalse(success)
		self.assertEqual(message, f"{PS_DOCUMENT_CONFLICT}PS/TICKET-2983")
		conn.commit.assert_not_called()

	def test_treats_same_operation_as_idempotent_replay(self):
		operation_key = "c4d32586-3a08-4b26-b02c-405f25e1cfee"
		cursor = MagicMock()
		cursor.fetchone.return_value = (f"Avulso|PSOP:{operation_key}",)
		conn = MagicMock()
		conn.cursor.return_value = cursor

		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch("app.blueprints.printer.connect_postgres", return_value=conn),
		):
			success, result = insert_ps_with_transaction_control(
				10,
				{},
				125.5,
				2983,
				"Ticket #2983",
				"Atendimento",
				document="PS/TICKET-2983-C4D32586",
				operation_key=operation_key,
			)

		self.assertTrue(success)
		self.assertEqual(result, ("PS/TICKET-2983-C4D32586", "2983"))
		self.assertEqual(cursor.execute.call_count, 1)
		conn.commit.assert_not_called()

	def test_print_ps_uses_ticket_value_and_suffixes_historical_collision(self):
		from app import db
		from app.blueprints.printer import service_provision_routes
		from app.models import Ticket, User

		app = Flask(__name__)
		app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(app)
		app.register_blueprint(service_provision_routes)

		with app.app_context():
			db.create_all()
			user = User(name="Teste", email="ps@example.invalid", password_hash="x")
			db.session.add(user)
			db.session.flush()
			ticket = Ticket(
				id=2983,
				title="Atendimento",
				opened_by_id=user.id,
				external_client_id=10,
				external_client_name="Cliente correto",
				total_cost=125.5,
			)
			db.session.add(ticket)
			db.session.commit()

			documents = []

			def register_ps(*args, **kwargs):
				documents.append((args, kwargs))
				document = kwargs["document"]
				if document == "PS/TICKET-2983":
					return False, f"{PS_DOCUMENT_CONFLICT}{document}"
				return True, (document, "2983")

			with (
				patch("app.blueprints.printer.connect_postgres", return_value=None),
				patch("app.blueprints.printer.insert_ps_with_transaction_control", side_effect=register_ps),
				patch("app.blueprints.printer.generateServiceProvisionPDF", return_value=(True, "C:\\tmp\\ps.pdf")),
			):
				response = app.test_client().post("/printers", json={
					"body": {
						"ticket_number": 2983,
						"client_name": "Cliente adulterado",
						"total_amount": 999999,
					},
				})

			self.assertEqual(response.status_code, 200)
			payload = response.get_json()
			self.assertRegex(payload["ps_number"], r"^PS/TICKET-2983-[0-9A-F]{8}$")
			self.assertEqual(documents[0][0][2], 125.5)
			self.assertEqual(documents[0][0][1]["client_name"], "Cliente correto")
			saved = db.session.get(Ticket, 2983)
			self.assertTrue(saved.ps_printed)
			self.assertEqual(saved.ps_registration_status, "completed")
			self.assertEqual(saved.ps_number, payload["ps_number"])

			db.session.remove()
			db.drop_all()

	def test_legacy_sql_server_calls_fail_clearly_without_connecting(self):
		with self.assertRaisesRegex(LegacySqlServerDisabledError, "desativada"):
			connect_sql_server()
		success, message = insert_service_sqlserver(10, {}, 1, 42)
		self.assertFalse(success)
		self.assertIn("desativada", message)

	def test_lists_ps_from_postgres_unico(self):
		cursor = MagicMock()
		cursor.description = [
			("id",), ("documento",), ("identidade",), ("client_name",),
			("emissao",), ("valor",), ("saldo",), ("status",), ("description",),
		]
		cursor.fetchall.return_value = [
			(1, "PS/TICKET-42", 10, "Cliente A", date(2026, 8, 29), 125.5, 125.5, "A", "Atendimento"),
		]
		conn = MagicMock()
		conn.cursor.return_value.__enter__.return_value = cursor

		with patch("app.external_pg._pg_connect", return_value=conn):
			rows = fetch_ps_financial_records()

		self.assertEqual(rows[0]["documento"], "PS/TICKET-42")
		self.assertEqual(rows[0]["client_name"], "Cliente A")
		self.assertIn("FROM financeiro", cursor.execute.call_args.args[0])
		self.assertIn("f.documento ILIKE", cursor.execute.call_args.args[0])
		conn.close.assert_called_once()

	@patch("app.blueprints.ps.find_ps_file_path", return_value=None)
	def test_merges_ticket_os_and_legacy_local_records(self, _find_file):
		ticket = SimpleNamespace(
			id=42,
			ps_number="PS/TICKET-42",
			ps_file="ticket.pdf",
			total_cost=125.5,
			closed_at=datetime(2026, 8, 29, 10, 0),
			created_at=datetime(2026, 8, 28, 10, 0),
			title="Atendimento",
			resolved_ps_filename=lambda: "ticket.pdf",
			display_client_name=lambda: "Cliente A",
		)
		order = SimpleNamespace(
			id=7,
			codigo="OS-7",
			ps_number="12345",
			ps_file="os.pdf",
			client_name="Cliente antigo",
			technician_name="Técnico",
			value=80,
			completion_date=datetime(2026, 8, 28, 9, 0),
			service_executed="Manutenção",
		)
		financial = [{
			"id": 1,
			"documento": "PS/TICKET-42",
			"client_name": "Cliente A",
			"emissao": date(2026, 8, 29),
			"valor": 125.5,
			"saldo": 125.5,
			"status": "A",
			"description": "Atendimento",
		}]

		rows = merge_ps_records(financial, [ticket], [order])

		self.assertEqual(len(rows), 2)
		self.assertEqual(rows[0]["source"], "Ticket")
		self.assertEqual(rows[1]["ps_number"], "12345")
		self.assertEqual(rows[1]["source"], "Ordem de serviço")
		self.assertTrue(rows[1]["id"].startswith("local:"))

	@patch("app.blueprints.ps.find_ps_file_path", return_value=None)
	def test_list_endpoint_returns_unico_and_local_ps(self, _find_file):
		ticket = SimpleNamespace(
			id=42,
			ps_number="PS/TICKET-42",
			ps_file=None,
			total_cost=125.5,
			closed_at=datetime(2026, 8, 29, 10, 0),
			created_at=datetime(2026, 8, 28, 10, 0),
			title="Atendimento",
			resolved_ps_filename=lambda: None,
			display_client_name=lambda: "Cliente A",
		)
		financial = [{
			"id": 1,
			"documento": "PS/TICKET-42",
			"client_name": "Cliente A",
			"emissao": date(2026, 8, 29),
			"valor": 125.5,
			"saldo": 125.5,
			"status": "A",
			"description": "Atendimento",
		}]
		app = Flask(__name__)
		ticket_model = MagicMock()
		ticket_model.query.filter.return_value.all.return_value = [ticket]
		order_model = MagicMock()
		order_model.query.filter.return_value.all.return_value = []

		with (
			app.test_request_context("/ps/api/list?q=cliente&page=1&per_page=25"),
			patch("app.blueprints.ps.fetch_ps_financial_records", return_value=financial),
			patch("app.blueprints.ps.Ticket", ticket_model),
			patch("app.blueprints.ps.ServiceOrder", order_model),
			patch("app.blueprints.ps.or_", return_value=True),
			patch("app.blueprints.ps.build_ps_pdf_index", return_value={"by_name": {}, "by_rel": {}, "files": [], "root": None}),
		):
			response = list_files.__wrapped__()

		payload = response.get_json()
		self.assertEqual(response.status_code, 200)
		self.assertEqual(payload["total"], 1)
		self.assertEqual(payload["items"][0]["ps_number"], "PS/TICKET-42")
		self.assertEqual(payload["items"][0]["source"], "Ticket")

	def test_list_survives_unico_outage_and_lists_subdir_pdfs(self):
		import tempfile
		from pathlib import Path
		from app.blueprints.ps import append_disk_orphan_ps, build_ps_pdf_index
		from app.external_pg import ExternalPgError

		with tempfile.TemporaryDirectory() as tmp:
			root = Path(tmp)
			subdir = root / "ps-do-dia"
			subdir.mkdir()
			(subdir / "PS_TICKET-99.pdf").write_bytes(b"%PDF-1.4")
			nested = root / "2026-08"
			nested.mkdir()
			(nested / "avulso.pdf").write_bytes(b"%PDF-1.4")

			app = Flask(__name__)
			ticket_model = MagicMock()
			ticket_model.query.filter.return_value.all.return_value = []
			order_model = MagicMock()
			order_model.query.filter.return_value.all.return_value = []

			with (
				app.test_request_context("/ps/api/list?q=&page=1&per_page=25"),
				patch("app.blueprints.ps.fetch_ps_financial_records", side_effect=ExternalPgError("down")),
				patch("app.blueprints.ps.Ticket", ticket_model),
				patch("app.blueprints.ps.ServiceOrder", order_model),
				patch("app.blueprints.ps.or_", return_value=True),
				patch("app.blueprints.ps._ps_root", return_value=root),
				patch("app.blueprints.ps.db") as db_mock,
			):
				db_mock.session.rollback = MagicMock()
				response = list_files.__wrapped__()

			payload = response.get_json()
			self.assertEqual(response.status_code, 200)
			self.assertGreaterEqual(payload["total"], 2)
			paths = {item["path"] for item in payload["items"]}
			self.assertIn("ps-do-dia/PS_TICKET-99.pdf", paths)
			self.assertIn("2026-08/avulso.pdf", paths)
			self.assertTrue(payload.get("warnings"))

	def test_append_disk_attaches_path_to_existing_item(self):
		import tempfile
		from pathlib import Path
		from app.blueprints.ps import append_disk_orphan_ps, build_ps_pdf_index

		with tempfile.TemporaryDirectory() as tmp:
			root = Path(tmp)
			(root / "ps-do-dia").mkdir()
			(root / "ps-do-dia" / "PS_TICKET-7.pdf").write_bytes(b"%PDF")
			index = build_ps_pdf_index(root)
			merged = [{
				"id": "unico:1",
				"ps_number": "PS/TICKET-7",
				"name": "PS/TICKET-7",
				"source": "Ticket",
				"path": None,
			}]
			out = append_disk_orphan_ps(merged, pdf_index=index)
			self.assertEqual(len(out), 1)
			self.assertEqual(out[0]["path"], "ps-do-dia/PS_TICKET-7.pdf")

	def test_safe_float_rejects_nan_and_bad_strings(self):
		from app.blueprints.ps import _safe_float
		self.assertEqual(_safe_float("nope"), 0.0)
		self.assertEqual(_safe_float(float("nan")), 0.0)
		self.assertEqual(_safe_float(None, 3), 3.0)
		self.assertEqual(_safe_float(0), 0.0)


if __name__ == "__main__":
	unittest.main()
