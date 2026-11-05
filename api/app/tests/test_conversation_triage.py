import unittest
from unittest.mock import patch

from flask import Flask

from app import db
from app.models import HelpDeskAiInsight
from app.services.conversation_triage import apply_triage_correction, match_named, run_classify


class ConversationTriageTest(unittest.TestCase):
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

	def test_only_real_queue_and_person_match(self):
		self.assertEqual(match_named("fiscal", ["Suporte Fiscal", "ERP"]), "")
		self.assertEqual(match_named("Suporte ERP", ["Suporte Fiscal", "Suporte ERP"]), "Suporte ERP")
		self.assertEqual(match_named("Maria", ["Maria Souza", "João Lima"]), "Maria Souza")
		self.assertEqual(match_named("Maria", ["Maria Souza", "Maria Lima"]), "")

	def test_classify_keeps_known_names_and_drops_invented_queue(self):
		def engine(_method, path, **_kwargs):
			if str(path).startswith("/tickets/"):
				return {"id": 8, "status": "pending", "contact": {"name": "Ana"}}
			return {"messages": [{"fromMe": False, "body": "O CLIPP não emite NFC-e", "isInternal": False}]}

		with patch("app.services.conversation_triage._transcript_from_engine", return_value=("Cliente: O CLIPP não emite NFC-e", "Ana", None)), \
			patch("app.services.conversation_triage._queue_names", return_value=["Suporte ERP"]), \
			patch("app.services.conversation_triage._people_names", return_value=["Maria Souza"]), \
			patch("app.services.conversation_triage._generate", return_value={
				"categoria": "Fiscal / NFC-e",
				"sistema": "CLIPP",
				"prioridade": "alta",
				"setor": "Fila inventada",
				"motivo": "Rejeição de total",
				"intencao": "problema",
				"tecnico": "Maria Souza",
			}), \
			patch("app.services.conversation_triage._audit"):
			triage = run_classify(8)
		self.assertEqual(triage["categoria"], "Fiscal / NFC-e")
		self.assertEqual(triage["sistema"], "CLIPP")
		self.assertEqual(triage["prioridade"], "alta")
		self.assertEqual(triage["setor"], "")
		self.assertEqual(triage["tecnico"], "Maria Souza")
		self.assertEqual(triage["intencao"], "problema")
		stored = HelpDeskAiInsight.query.filter_by(engine_ticket_id=8).one()
		self.assertIn("Fiscal", stored.triage)

	def test_correction_overwrites_and_rejects_unknown_queue(self):
		with patch("app.services.conversation_triage._queue_names", return_value=["Suporte ERP"]), \
			patch("app.services.conversation_triage._people_names", return_value=["Maria Souza"]):
			saved = apply_triage_correction(3, {"categoria": "Fiscal", "setor": "Suporte ERP", "tecnico": "Maria Souza"})
			self.assertEqual(saved["setor"], "Suporte ERP")
			self.assertTrue(saved["corrected"])
			with self.assertRaises(ValueError):
				apply_triage_correction(3, {"setor": "Fila inventada"})
