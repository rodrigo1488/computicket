import unittest

from guard import SqlRejected, present_cell, validate_readonly_sql


class GuardTest(unittest.TestCase):
	def test_select_is_kept(self):
		self.assertEqual(validate_readonly_sql("SELECT id FROM ticket;"), "SELECT id FROM ticket")

	def test_with_is_allowed(self):
		sql = "WITH abertos AS (SELECT id FROM ticket WHERE status = 'aberto') SELECT * FROM abertos"
		self.assertTrue(validate_readonly_sql(sql).lower().startswith("with"))

	def test_write_is_rejected(self):
		for statement in (
			"DELETE FROM ticket",
			"UPDATE ticket SET status = 'fechado'",
			"DROP TABLE ticket",
			"SELECT 1; DELETE FROM ticket",
			"SELECT pg_read_file('/etc/passwd')",
			"SELECT id INTO copia FROM ticket",
		):
			with self.subTest(statement=statement):
				with self.assertRaises(SqlRejected):
					validate_readonly_sql(statement)

	def test_query_rejects_write_before_connecting(self):
		import dbtools

		payload = dbtools.query("DELETE FROM ticket")
		self.assertIn("Só consulta", payload)
		self.assertNotIn("connection", payload.lower())

	def test_secrets_and_embeddings_are_hidden(self):
		self.assertEqual(present_cell("password", "segredo"), "[redigido]")
		self.assertEqual(present_cell("password_hash", "abc"), "[redigido]")
		self.assertEqual(present_cell("embedding", [0.1, 0.2]), "[omitido]")
		self.assertEqual(present_cell("title", "Nota fiscal"), "Nota fiscal")


if __name__ == "__main__":
	unittest.main()
