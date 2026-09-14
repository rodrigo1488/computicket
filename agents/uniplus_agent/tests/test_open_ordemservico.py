import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

from unico_handler import UniplusPermanentError, _open_ordemservico


class OpenOrdemservicoTest(unittest.TestCase):
	def _connection(self, client=(10, "Cliente Z", "123"), next_ids=(17659, 17390), returning=(17659, 17390)):
		cursor = MagicMock()
		cursor.fetchone.side_effect = [client, next_ids, returning]
		conn = MagicMock()
		conn.cursor.return_value.__enter__.return_value = cursor
		return conn, cursor

	def test_inserts_open_os_with_status_2(self):
		conn, cursor = self._connection()
		now = datetime(2026, 9, 14, 16, 7, 0)

		with patch("unico_handler._connect", return_value=conn):
			result = _open_ordemservico({
				"client_id": 10,
				"descricaoitem": "Notebook Acer",
				"problemadescrito": "Não liga",
				"solicitante": "Willian",
				"numerofabricacao": "SN123",
				"external_user_id": 51,
				"external_rep_id": 1489,
				"now": now,
			})

		self.assertTrue(result["ok"])
		self.assertEqual(result["codigo"], 17390)
		self.assertEqual(result["status"], 2)
		self.assertEqual(result["nomecliente"], "Cliente Z")

		insert_sql = cursor.execute.call_args_list[-1].args[0]
		params = cursor.execute.call_args_list[-1].args[1]
		self.assertIn("INSERT INTO ordemservico", insert_sql)
		self.assertEqual(params[1], 10)
		self.assertEqual(params[3], "Notebook Acer")
		self.assertEqual(params[4], "Não liga")
		self.assertEqual(params[10], 2)
		self.assertEqual(params[12], 17390)
		self.assertEqual(params[23], "Willian")
		self.assertEqual(params[35], "SN123")
		self.assertEqual(params[79], "Inicialização")
		self.assertEqual(params[81], "Ordem de serviço 17390 iniciada")
		conn.commit.assert_called_once()

	def test_requires_equipment_and_problem(self):
		with self.assertRaisesRegex(UniplusPermanentError, "Equipamento"):
			_open_ordemservico({"client_id": 10, "problemadescrito": "X"})
		with self.assertRaisesRegex(UniplusPermanentError, "Problema"):
			_open_ordemservico({"client_id": 10, "descricaoitem": "PC"})

	def test_missing_client_is_permanent(self):
		conn, _cursor = self._connection(client=None)
		with (
			patch("unico_handler._connect", return_value=conn),
			self.assertRaisesRegex(UniplusPermanentError, "Cliente não encontrado"),
		):
			_open_ordemservico({
				"client_id": 99,
				"descricaoitem": "PC",
				"problemadescrito": "Travando",
			})


if __name__ == "__main__":
	unittest.main()
