import unittest
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from app.blueprints.ps import list_files, merge_ps_records
from app.blueprints.printer import (
	build_ps_document,
	insert_ps_with_transaction_control,
	insert_service_sqlserver,
)
from app.external_pg import fetch_ps_financial_records
from app.blueprints.utils import LegacySqlServerDisabledError, connect_sql_server


class PsPostgresFlowTest(unittest.TestCase):
	def test_builds_stable_documents_for_ticket_and_service_order(self):
		self.assertEqual(build_ps_document(42, "Ticket #42"), "PS/TICKET-42")
		self.assertEqual(build_ps_document("OS 10/2", "OS #10"), "PS/OS-OS-10-2")

	def test_registers_ps_only_in_postgres_unico(self):
		cursor = MagicMock()
		cursor.fetchone.return_value = (0,)
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
		):
			response = list_files.__wrapped__()

		payload = response.get_json()
		self.assertEqual(response.status_code, 200)
		self.assertEqual(payload["total"], 1)
		self.assertEqual(payload["items"][0]["ps_number"], "PS/TICKET-42")
		self.assertEqual(payload["items"][0]["source"], "Ticket")


if __name__ == "__main__":
	unittest.main()
