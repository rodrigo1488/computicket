import unittest
from unittest.mock import patch

from flask import Flask

from app import db
from app.models import KnowledgeArticle, KnowledgeCategory, KnowledgeChunk, User
from app.services.copilot import answer_question
from app.services.gemini_client import GeminiError
from app.services.rag import chunk_text, hybrid_search, index_source, sanitize_for_rag


class RAGServiceTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
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

	def test_sanitizes_html_pii_and_secrets(self):
		clean = sanitize_for_rag(
			"<script>roubo()</script><p>Contato teste@exemplo.com, 11999998888; "
			"api_key=abc123secreto</p>"
		)
		self.assertNotIn("roubo", clean)
		self.assertNotIn("teste@exemplo.com", clean)
		self.assertNotIn("11999998888", clean)
		self.assertNotIn("abc123secreto", clean)
		self.assertIn("[EMAIL REMOVIDO]", clean)

	def test_chunking_has_bounded_chunks(self):
		chunks = chunk_text("frase de teste. " * 200, size=320, overlap=40)
		self.assertGreater(len(chunks), 1)
		self.assertTrue(all(len(chunk) <= 320 for chunk in chunks))

	def test_answer_without_sources_does_not_call_generation(self):
		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot._generate") as generate,
		):
			result = answer_question("Como resolvo este problema?")
		generate.assert_not_called()
		self.assertEqual(result["sources"], [])
		self.assertIn("evidências suficientes", result["draft"])

	def test_index_keeps_lexical_fallback_and_removes_unpublished(self):
		user = User(name="Teste", email="teste@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.flush()
		category = KnowledgeCategory(name="Rede", created_by_id=user.id)
		db.session.add(category)
		db.session.flush()
		article = KnowledgeArticle(
			title="Configurar impressora",
			content="<p>Reinicie o spooler de impressão.</p>",
			category_id=category.id,
			status="published",
			created_by_id=user.id,
		)
		db.session.add(article)
		db.session.commit()

		# O pipeline só suprime falhas Gemini conhecidas; simula a classe correta.
		with patch("app.services.rag.embed_texts", side_effect=GeminiError("offline")):
			index_source("knowledge_article", article.id)
			self.assertEqual(KnowledgeChunk.query.count(), 1)
			self.assertIsNone(KnowledgeChunk.query.first().embedding)
			results = hybrid_search("spooler")
			self.assertTrue(results)
			self.assertEqual(results[0]["source_type"], "knowledge_article")
			self.assertEqual(results[0]["source_id"], article.id)
			self.assertEqual(results[0]["href"], f"/conhecimento/{category.id}")

		article.status = "draft"
		db.session.commit()
		index_source("knowledge_article", article.id)
		self.assertEqual(KnowledgeChunk.query.count(), 0)


if __name__ == "__main__":
	unittest.main()
