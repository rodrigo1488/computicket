import unittest
from unittest.mock import MagicMock, patch

from unico_handler import UniplusPermanentError, _insert_finance_ps


class FinancePsIdempotencyTest(unittest.TestCase):
	def setUp(self):
		self.operation_key = "c4d32586-3a08-4b26-b02c-405f25e1cfee"
		self.payload = {
			"id_entidade": 10,
			"document": "PS/TICKET-2983-C4D32586",
			"description_service": "Atendimento",
			"total": 125.5,
			"operation_key": self.operation_key,
		}

	def _connection(self, existing=None):
		cursor = MagicMock()
		cursor.fetchone.return_value = existing
		conn = MagicMock()
		conn.cursor.return_value.__enter__.return_value = cursor
		return conn, cursor

	def test_replay_of_same_operation_is_successful(self):
		conn, cursor = self._connection((f"Avulso|PSOP:{self.operation_key}",))

		with patch("unico_handler._connect", return_value=conn):
			result = _insert_finance_ps(self.payload)

		self.assertTrue(result["ok"])
		self.assertTrue(result["replayed"])
		self.assertEqual(cursor.execute.call_count, 1)
		conn.commit.assert_not_called()

	def test_historical_collision_is_permanent(self):
		conn, _cursor = self._connection(("Avulso",))

		with (
			patch("unico_handler._connect", return_value=conn),
			self.assertRaisesRegex(UniplusPermanentError, "PS_DOCUMENT_CONFLICT"),
		):
			_insert_finance_ps(self.payload)

	def test_new_operation_persists_idempotency_marker(self):
		conn, cursor = self._connection(None)

		with patch("unico_handler._connect", return_value=conn):
			result = _insert_finance_ps(self.payload)

		self.assertTrue(result["ok"])
		insert_args = cursor.execute.call_args_list[-1].args[1]
		self.assertEqual(insert_args[-1], f"Avulso|PSOP:{self.operation_key}")
		conn.commit.assert_called_once()


if __name__ == "__main__":
	unittest.main()
