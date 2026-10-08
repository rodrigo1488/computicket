"""Cancelamento de OS: exclui a movimentação financeira (PS) no Unico e no Computicket."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from app import db, login_manager
from app.blueprints import service_orders as os_module
from app.blueprints.service_orders import api_cancel_service_order
from app.models import ServiceOrder, User
from app.services import unico_finance
from app.services.unico_finance import UnicoFinanceBlocked


class CancelServiceOrderTest(unittest.TestCase):
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
		db.session.commit()
		self.user_id = user.id
		self.admin = SimpleNamespace(id=user.id, name="Administrador", has_role=lambda role: role == "admin")
		self.tech = SimpleNamespace(id=user.id, name="Técnico", has_role=lambda role: False)

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def make_os(self, order_id=1, codigo="1001", status=5, value=150.0, ps_number="PS/OS-1001", **extra):
		db.session.add(ServiceOrder(
			id=order_id,
			codigo=codigo,
			client_name="Cliente X",
			service_executed="Troca de fonte",
			status=status,
			value=value,
			ps_number=ps_number,
			ps_generated=bool(ps_number),
			technician_name="Fulano",
			**extra,
		))
		db.session.commit()

	def invoke(self, order_id=1, payload=None, user=None, check=None, delete=None):
		payload = {"reason": "Lançada por engano"} if payload is None else payload
		with self.app.test_request_context(json=payload):
			with (
				patch.object(os_module, "current_user", user or self.admin),
				patch.object(os_module, "check_finance_ps_deletable", check or MagicMock(return_value=1)) as chk,
				patch.object(os_module, "delete_finance_ps", delete or MagicMock(return_value=1)) as dele,
			):
				result = api_cancel_service_order.__wrapped__(order_id)
		self.check, self.delete = chk, dele
		return result

	def reload(self, order_id=1):
		db.session.expire_all()
		return db.session.get(ServiceOrder, order_id)

	# --- sucesso -----------------------------------------------------------------
	def test_success_deletes_unico_and_local_with_audit(self):
		self.make_os()
		response = self.invoke()
		self.assertEqual(response.status_code, 200)
		body = response.get_json()
		self.assertTrue(body["success"])
		self.assertEqual(body["service_order"]["unico_deleted"], 1)
		self.check.assert_called_once_with("PS/OS-1001")
		self.delete.assert_called_once_with("PS/OS-1001")
		order = self.reload()
		self.assertTrue(order.is_cancelled())
		self.assertEqual(order.status, ServiceOrder.OS_STATUS_CANCELADA)
		self.assertEqual(order.status_text(), "Cancelada")
		# movimentação local removida das listagens/relatórios
		self.assertIsNone(order.ps_number)
		self.assertFalse(order.ps_generated)
		self.assertEqual(order.value, 0.0)
		# auditoria
		self.assertEqual(order.cancelled_by_id, self.user_id)
		self.assertIsNotNone(order.cancelled_at)
		self.assertEqual(order.cancellation_reason, "Lançada por engano")
		self.assertEqual(order.cancelled_prev_status, 5)
		self.assertEqual(order.cancelled_ps_number, "PS/OS-1001")
		self.assertEqual(order.cancelled_value, 150.0)
		self.assertEqual(order.cancelled_unico_deleted, 1)

	def test_unico_called_after_local_flush_and_before_commit(self):
		"""A exclusão no Unico ocorre com o cancelamento local já aplicado (sessão) mas não commitado."""
		self.make_os()
		seen = {}

		def fake_delete(ps):
			seen["status_in_session"] = db.session.get(ServiceOrder, 1).status
			return 1

		self.invoke(delete=MagicMock(side_effect=fake_delete))
		self.assertEqual(seen["status_in_session"], ServiceOrder.OS_STATUS_CANCELADA)

	# --- falha no Unico ------------------------------------------------------------
	def test_unico_delete_failure_returns_502_and_changes_nothing_locally(self):
		self.make_os()
		response, status = self.invoke(delete=MagicMock(side_effect=RuntimeError("offline")))
		self.assertEqual(status, 502)
		self.assertIn("offline", response.get_json()["error"])
		order = self.reload()
		self.assertEqual(order.status, 5)
		self.assertEqual(order.ps_number, "PS/OS-1001")
		self.assertTrue(order.ps_generated)
		self.assertEqual(order.value, 150.0)
		self.assertIsNone(order.cancelled_at)
		self.assertIsNone(order.cancelled_by_id)
		self.assertIsNone(order.cancellation_reason)
		self.assertIsNone(order.cancelled_ps_number)

	def test_unico_check_failure_returns_502_and_does_not_delete(self):
		self.make_os()
		response, status = self.invoke(check=MagicMock(side_effect=RuntimeError("sem conexão")))
		self.assertEqual(status, 502)
		self.delete.assert_not_called()
		self.assertEqual(self.reload().status, 5)

	def test_ps_already_paid_in_unico_returns_409_and_changes_nothing(self):
		self.make_os()
		response, status = self.invoke(check=MagicMock(side_effect=UnicoFinanceBlocked("já foi baixada/paga no Unico")))
		self.assertEqual(status, 409)
		self.assertIn("baixada", response.get_json()["error"])
		self.delete.assert_not_called()
		order = self.reload()
		self.assertEqual(order.status, 5)
		self.assertIsNone(order.cancelled_at)

	# --- idempotência / sem movimentação ---------------------------------------------
	def test_ps_not_found_in_unico_is_success(self):
		self.make_os()
		response = self.invoke(check=MagicMock(return_value=0), delete=MagicMock(return_value=0))
		self.assertEqual(response.status_code, 200)
		self.assertIn("já não existia no Unico", response.get_json()["message"])
		order = self.reload()
		self.assertTrue(order.is_cancelled())
		self.assertIsNone(order.ps_number)
		self.assertEqual(order.cancelled_unico_deleted, 0)

	def test_order_without_financial_movement_skips_unico(self):
		self.make_os(ps_number=None, value=0.0, status=3)
		response = self.invoke()
		self.assertEqual(response.status_code, 200)
		self.check.assert_not_called()
		self.delete.assert_not_called()
		order = self.reload()
		self.assertTrue(order.is_cancelled())
		self.assertEqual(order.cancelled_prev_status, 3)
		self.assertIsNone(order.cancelled_ps_number)
		self.assertIsNone(order.cancelled_unico_deleted)
		self.assertIn("não tinha movimentação financeira", response.get_json()["message"])

	# --- validações / autorização --------------------------------------------------
	def test_nonexistent_order_returns_404(self):
		response, status = self.invoke(order_id=999)
		self.assertEqual(status, 404)
		self.delete.assert_not_called()

	def test_already_cancelled_returns_409_without_touching_unico(self):
		self.make_os(status=ServiceOrder.OS_STATUS_CANCELADA, ps_number=None, value=0.0)
		response, status = self.invoke()
		self.assertEqual(status, 409)
		self.assertIn("já está cancelada", response.get_json()["error"])
		self.check.assert_not_called()
		self.delete.assert_not_called()

	def test_non_cancellable_status_returns_409(self):
		self.make_os(status=2, ps_number=None)
		response, status = self.invoke()
		self.assertEqual(status, 409)
		self.assertEqual(self.reload().status, 2)

	def test_missing_reason_returns_400(self):
		self.make_os()
		for payload in ({}, {"reason": "   "}):
			response, status = self.invoke(payload=payload)
			self.assertEqual(status, 400)
		self.delete.assert_not_called()
		self.assertEqual(self.reload().status, 5)

	def test_non_admin_is_forbidden_and_nothing_changes(self):
		self.make_os()
		response, status = self.invoke(user=self.tech)
		self.assertEqual(status, 403)
		self.check.assert_not_called()
		self.delete.assert_not_called()
		self.assertEqual(self.reload().status, 5)

	def test_unauthenticated_is_refused_with_401(self):
		self.app.register_blueprint(os_module.bp, url_prefix="/ordens-servico")
		with patch.object(login_manager, "login_view", None):
			login_manager.init_app(self.app)
			resp = self.app.test_client().post("/ordens-servico/1/cancel", json={"reason": "x"})
		self.assertEqual(resp.status_code, 401)

	def test_cancelled_order_is_detected_by_codigo_and_serialized(self):
		"""A OS cancelada continua existindo localmente (bloqueia re-importação) e expõe auditoria na API web."""
		self.make_os()
		self.invoke()
		self.assertTrue(os_module._local_os_by_codigo("1001").is_cancelled())
		from app.blueprints.web_api import _os_json
		payload = _os_json(self.reload())
		self.assertTrue(payload["cancelled"])
		self.assertEqual(payload["status_text"], "Cancelada")
		self.assertEqual(payload["cancelled_by_name"], "Admin")
		self.assertEqual(payload["cancellation_reason"], "Lançada por engano")
		self.assertEqual(payload["cancelled_ps_number"], "PS/OS-1001")
		self.assertEqual(payload["cancelled_value"], 150.0)
		self.assertIsNotNone(payload["cancelled_at"])


class UnicoFinanceServiceTest(unittest.TestCase):
	def _conn(self, rows=None, rowcount=1):
		cursor = MagicMock()
		cursor.fetchall.return_value = rows or []
		cursor.rowcount = rowcount
		conn = MagicMock()
		conn.cursor.return_value = cursor
		return conn, cursor

	def test_check_not_found_returns_zero(self):
		conn, _ = self._conn(rows=[])
		with patch.object(unico_finance, "connect_postgres", return_value=conn):
			self.assertEqual(unico_finance.check_finance_ps_deletable("PS/OS-1"), 0)

	def test_check_open_entry_is_deletable(self):
		conn, _ = self._conn(rows=[("A", 100.0, 100.0)])
		with patch.object(unico_finance, "connect_postgres", return_value=conn):
			self.assertEqual(unico_finance.check_finance_ps_deletable("PS/OS-1"), 1)

	def test_check_paid_or_partial_entry_is_blocked(self):
		for row in (("Q", 100.0, 0.0), ("A", 100.0, 40.0)):
			conn, _ = self._conn(rows=[row])
			with patch.object(unico_finance, "connect_postgres", return_value=conn):
				with self.assertRaises(UnicoFinanceBlocked):
					unico_finance.check_finance_ps_deletable("PS/OS-1")

	def test_check_without_connection_returns_none(self):
		with patch.object(unico_finance, "connect_postgres", return_value=None):
			self.assertIsNone(unico_finance.check_finance_ps_deletable("PS/OS-1"))

	def test_delete_direct_commits_and_returns_rowcount(self):
		conn, cursor = self._conn(rowcount=1)
		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch.object(unico_finance, "connect_postgres", return_value=conn),
		):
			self.assertEqual(unico_finance.delete_finance_ps("PS/OS-1"), 1)
		cursor.execute.assert_called_once_with("DELETE FROM financeiro WHERE documento = %s", ("PS/OS-1",))
		conn.commit.assert_called_once()

	def test_delete_direct_not_found_is_zero_not_error(self):
		conn, _ = self._conn(rowcount=0)
		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch.object(unico_finance, "connect_postgres", return_value=conn),
		):
			self.assertEqual(unico_finance.delete_finance_ps("PS/OS-1"), 0)

	def test_delete_direct_error_rolls_back_and_raises(self):
		conn, cursor = self._conn()
		cursor.execute.side_effect = RuntimeError("falha sql")
		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=False),
			patch.object(unico_finance, "connect_postgres", return_value=conn),
		):
			with self.assertRaises(RuntimeError):
				unico_finance.delete_finance_ps("PS/OS-1")
		conn.rollback.assert_called_once()

	def test_delete_via_agent_uses_delete_finance_ps_job(self):
		with (
			patch("app.uniplus_jobs.agent_enabled", return_value=True),
			patch("app.uniplus_jobs.enqueue_and_wait", return_value={"deleted": 0}) as enqueue,
		):
			self.assertEqual(unico_finance.delete_finance_ps("PS/OS-1"), 0)
		enqueue.assert_called_once_with("delete_finance_ps", {"document": "PS/OS-1", "ps_number": "PS/OS-1"})


if __name__ == "__main__":
	unittest.main()
