import unittest
from unittest.mock import patch

from flask import Flask

from app import db
from app.models import HelpDeskAiInsight, KnowledgeChunk
from app.services.ai_queue import process_ai_job
from app.services.conversation_summary import format_summary_note, run_summarize, stated_solution
from app.services.rag import index_source


class ConversationSummaryTest(unittest.TestCase):
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

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def test_note_keeps_solution_only_when_it_exists(self):
		self.assertEqual(stated_solution("Não informado"), "")
		note = format_summary_note({
			"problema": "Rejeição de NFC-e",
			"diagnostico": "",
			"procedimentos": "",
			"solucao": "Não informado",
			"pendencias": "Acompanhar amanhã",
			"proxima_acao": "",
		})
		self.assertIn("Rejeição de NFC-e", note)
		self.assertIn("Acompanhar amanhã", note)
		self.assertNotIn("Solução", note)
		self.assertNotIn("Cliente:", note)

	def test_indexes_helpdesk_conversation_without_the_raw_note(self):
		db.session.add(HelpDeskAiInsight(
			engine_ticket_id=9,
			client_name="Mercado",
			transcript="Cliente: a nota foi rejeitada pelo total",
			problema="Rejeição de total",
			status="ready",
		))
		db.session.commit()
		vector = [0.01] * 768
		with patch("app.services.rag.embed_texts", return_value=[vector]):
			result = index_source("helpdesk_conversation", 9)
		self.assertGreaterEqual(result["indexed"], 1)
		chunk = KnowledgeChunk.query.filter_by(source_type="helpdesk_conversation", source_id=9).one()
		self.assertIn("rejeitada", chunk.content)
		self.assertIn("Rejeição de total", chunk.content)

	def test_job_only_allows_declared_tools(self):
		with self.assertRaises(ValueError):
			process_ai_job({"kind": "drop_database", "payload": {"engine_ticket_id": 1}})

	def test_summary_job_stores_fields_and_skips_invented_solution(self):
		def engine(_method, path, **_kwargs):
			if path.startswith("/tickets/"):
				return {"contact": {"id": 3, "name": "Ana"}}
			return {"messages": [{"fromMe": False, "body": "A NFC-e foi rejeitada", "isInternal": False}]}

		fields = {
			"problema": "Rejeição de NFC-e",
			"diagnostico": "Divergência de total",
			"procedimentos": "",
			"solucao": "",
			"pendencias": "Verificar o XML",
			"proxima_acao": "Retornar ao cliente",
		}
		with patch("app.services.conversation_summary.admin_request", side_effect=engine), \
			patch("app.services.conversation_summary._ask_gemini", return_value=fields), \
			patch("app.services.conversation_summary.index_source"), \
			patch("app.services.conversation_summary.send_engine_message") as note:
			result = run_summarize(4, post_note=True)
		self.assertEqual(result["problema"], "Rejeição de NFC-e")
		self.assertEqual(result["solucao"], "")
		self.assertEqual(result["status"], "ready")
		body = note.call_args.args[1]
		self.assertIn("Rejeição de NFC-e", body)
		self.assertNotIn("A NFC-e foi rejeitada", body)
		stored = HelpDeskAiInsight.query.filter_by(engine_ticket_id=4).one()
		self.assertIn("rejeitada", stored.transcript)
