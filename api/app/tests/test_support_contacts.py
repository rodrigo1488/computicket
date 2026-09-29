import unittest
from unittest.mock import patch

from flask import Flask
from sqlalchemy.pool import StaticPool

from app import db
from app.models import KnowledgeArticle, KnowledgeCategory, User
from app.services.copilot import CopilotError
from app.services.support_knowledge import extract_support_solution, save_support_article
from app.support_routing import is_support_ticket


class SupportRoutingTest(unittest.TestCase):
	def test_support_status_skips_helpdesk(self):
		self.assertTrue(is_support_ticket("support", False))
		self.assertTrue(is_support_ticket("open", True))
		self.assertTrue(is_support_ticket("pending", "true"))

	def test_customer_ticket_stays_in_helpdesk(self):
		self.assertFalse(is_support_ticket("pending", False))
		self.assertFalse(is_support_ticket("open", None))
		self.assertFalse(is_support_ticket("closed", False))


class SupportKnowledgeTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
			SQLALCHEMY_ENGINE_OPTIONS={
				"poolclass": StaticPool,
				"connect_args": {"check_same_thread": False},
			},
		)
		db.init_app(self.app)
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		user = User(name="Agente", email="agente@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.commit()
		self.user_id = user.id

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	@patch("app.services.support_knowledge._generate")
	def test_extracts_solution_from_support_conversation(self, generate):
		generate.return_value = {
			"title": "Erro ao emitir NF",
			"problem": "A nota fiscal não autorizava.",
			"solution": "Atualizar o certificado A1 e reenviar.",
			"hasSolution": True,
		}
		draft = extract_support_solution(
			"Equipe: a nota não autoriza\nSuporte: atualize o certificado A1",
			"Uniplus",
		)
		self.assertEqual(draft["title"], "Erro ao emitir NF")
		self.assertTrue(draft["has_solution"])
		self.assertIn("certificado", draft["solution"])
		generate.assert_called_once()

	@patch("app.services.support_knowledge._generate")
	def test_extract_without_solution_is_not_ready_to_save(self, generate):
		generate.return_value = {
			"title": "Dúvida",
			"problem": "Usuário perguntou o caminho do menu.",
			"solution": "",
			"hasSolution": False,
		}
		draft = extract_support_solution("Equipe: onde fica o menu?", "Uniplus")
		self.assertFalse(draft["has_solution"])
		self.assertEqual(draft["solution"], "")

	def test_extract_requires_conversation(self):
		with self.assertRaises(CopilotError):
			extract_support_solution("   ", "Uniplus")

	def test_saves_article_linked_to_system_folder(self):
		article = save_support_article(
			title="Certificado da NF",
			problem="A nota não autorizava.",
			solution="Atualizar o certificado A1 e reenviar.",
			system_name="Uniplus",
			user_id=self.user_id,
		)
		self.assertEqual(article.category.name, "Uniplus")
		self.assertIn("Origem: conversa de suporte (Uniplus)", article.content)
		self.assertIn("Atualizar o certificado", article.content)
		self.assertIn("suporte", article.tags)
		again = save_support_article(
			title="Outra solução",
			problem="Menu sumiu.",
			solution="Limpar o cache do navegador.",
			system_name="uniplus",
			user_id=self.user_id,
		)
		self.assertEqual(again.category_id, article.category_id)
		self.assertEqual(KnowledgeCategory.query.count(), 1)
		self.assertEqual(KnowledgeArticle.query.count(), 2)

	def test_save_requires_solution(self):
		with self.assertRaises(ValueError):
			save_support_article(
				title="Sem solução",
				problem="Ainda investigando.",
				solution="  ",
				system_name="Uniplus",
				user_id=self.user_id,
			)
