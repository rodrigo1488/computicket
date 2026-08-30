import unittest
from unittest.mock import patch

from flask import Flask

from app import db
from app.models import KnowledgeArticle, KnowledgeCategory, KnowledgeChunk, User
from app.services.copilot import CopilotError, answer_question
from app.services.config_secrets import decrypt_secret, encrypt_secret
from app.services.gemini_client import GeminiError
from app.services.rag import chunk_text, hybrid_search, index_source, sanitize_for_rag


class RAGServiceTest(unittest.TestCase):
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

	def test_ai_secret_is_encrypted_at_rest(self):
		encrypted = encrypt_secret("AIza-chave-de-teste")
		self.assertNotIn("AIza-chave-de-teste", encrypted)
		self.assertEqual(decrypt_secret(encrypted), "AIza-chave-de-teste")

	def test_copilot_upstream_failure_is_unavailable_not_bad_gateway(self):
		err = CopilotError("Falha ao consultar o Gemini: timeout")
		self.assertEqual(err.status_code, 503)
		self.assertEqual(err.code, "gemini_error")

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
		category_id = category.id
		article = KnowledgeArticle(
			title="Configurar impressora",
			content="<p>Reinicie o spooler de impressão.</p>",
			category_id=category_id,
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
			self.assertEqual(results[0]["href"], f"/conhecimento/{category_id}")

		article.status = "draft"
		db.session.commit()
		index_source("knowledge_article", article.id)
		self.assertEqual(KnowledgeChunk.query.count(), 0)

	def test_vault_indexes_metadata_without_password(self):
		from app.models import PasswordVault

		user = User(name="Teste", email="vault@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.flush()
		vault = PasswordVault(
			external_client_id=99,
			external_client_name="Cliente Vault",
			machine_name="PC Recepção",
			anydesk_code="123 456 789",
			password="SENHA_SECRETA_NUNCA_INDEXAR",
			description="Acesso remoto do balcão",
			created_by_id=user.id,
		)
		db.session.add(vault)
		db.session.commit()

		with patch("app.services.rag.embed_texts", side_effect=GeminiError("offline")):
			index_source("password_vault", vault.id)
		chunk = KnowledgeChunk.query.filter_by(source_type="password_vault", source_id=vault.id).first()
		self.assertIsNotNone(chunk)
		self.assertIn("PC Recepção", chunk.content)
		self.assertIn("123 456 789", chunk.content)
		self.assertNotIn("SENHA_SECRETA_NUNCA_INDEXAR", chunk.content)
		self.assertNotIn("SENHA_SECRETA_NUNCA_INDEXAR", chunk.title)
		results = hybrid_search("AnyDesk recepção")
		self.assertTrue(results)
		self.assertEqual(results[0]["source_type"], "password_vault")
		self.assertEqual(results[0]["href"], "/cofre/99")

	def test_budget_is_indexed_with_items(self):
		from app.models import Budget, BudgetItem

		user = User(name="Teste", email="budget@example.invalid", password_hash="x")
		db.session.add(user)
		db.session.flush()
		budget = Budget(
			title="Upgrade servidor",
			description="Proposta de upgrade de hardware",
			external_client_name="Cliente Orçamento",
			status="sent",
			payment_terms="30 dias",
			created_by_id=user.id,
		)
		db.session.add(budget)
		db.session.flush()
		db.session.add(
			BudgetItem(
				budget_id=budget.id,
				description="SSD NVMe 1TB",
				quantity=2,
				unit_price=450.0,
			)
		)
		db.session.commit()

		with patch("app.services.rag.embed_texts", side_effect=GeminiError("offline")):
			index_source("budget", budget.id)
		chunk = KnowledgeChunk.query.filter_by(source_type="budget", source_id=budget.id).first()
		self.assertIsNotNone(chunk)
		self.assertIn("SSD NVMe", chunk.content)
		self.assertIn("Upgrade servidor", chunk.title)
		results = hybrid_search("SSD NVMe orçamento")
		self.assertTrue(results)
		self.assertEqual(results[0]["source_type"], "budget")
		self.assertEqual(results[0]["href"], f"/orcamentos/{budget.id}")


if __name__ == "__main__":
	unittest.main()
