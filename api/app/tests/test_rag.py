import unittest
from unittest.mock import patch

from flask import Flask

from app import db
from app.models import KnowledgeArticle, KnowledgeCategory, KnowledgeChunk, User
from app.services.copilot import CopilotError, answer_assistant, answer_question
from app.services.config_secrets import decrypt_secret, encrypt_secret
from app.services.gemini_client import GeminiError
from app.services.rag import chunk_text, hybrid_search, index_source, sanitize_for_rag


class _ToolCall:
	def __init__(self, name, args):
		self.name = name
		self.args = args


class _GeminiReply:
	def __init__(self, text, calls=None):
		self.text = text
		self.function_calls = calls or []
		self.candidates = []


class _FakeModels:
	def __init__(self, replies):
		self._replies = list(replies)
		self.configs = []

	def generate_content(self, **kwargs):
		self.configs.append(kwargs.get("config") or {})
		return self._replies.pop(0)


class _FakeGemini:
	def __init__(self, replies):
		self.models = _FakeModels(replies)


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

	def test_answer_cites_knowledge_article_sources(self):
		sources = [
			{"source_type": "knowledge_article", "source_id": 11, "title": "RH ID", "snippet": "Mensalidade por colaborador."},
			{"source_type": "ticket", "source_id": 22, "title": "Chamado antigo", "snippet": "Outro assunto."},
		]
		with (
			patch("app.services.copilot.hybrid_search", return_value=sources),
			patch("app.services.copilot._generate", return_value={"draft": "Use o artigo RH ID.", "cited": [1]}),
		):
			result = answer_question("Como funciona o plano RH ID?")
		self.assertEqual(result["draft"], "Use o artigo RH ID.")
		self.assertEqual(len(result["sources"]), 1)
		self.assertEqual(result["sources"][0]["source_id"], 11)

	def test_dashboard_assistant_answers_without_copying_the_base(self):
		client = _FakeGemini([_GeminiReply("Olha a fila pelos mais antigos e me diz qual cliente está parado.")])
		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
		):
			result = answer_assistant("como eu priorizo os atendimentos de hoje?")
		self.assertNotIn("Não encontrei evidências", result["draft"])
		self.assertIn("fila", result["draft"])
		self.assertEqual(result["sources"], [])
		self.assertIn("tools", client.models.configs[0])

	def test_dashboard_assistant_queries_the_database_before_answering(self):
		call = _ToolCall("query", {"sql": "SELECT id, status FROM ticket WHERE status = 'aberto'", "database": "computicket"})
		client = _FakeGemini([
			_GeminiReply("", [call]),
			_GeminiReply("Há 2 chamados abertos. O mais antigo é o 18."),
		])
		seen = {}

		def dispatch(name, args):
			seen["name"] = name
			seen["sql"] = args.get("sql")
			return '{"rows": [{"id": 18, "status": "aberto"}]}'

		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
			patch("app.services.copilot._dispatch_database_tool", side_effect=dispatch),
		):
			result = answer_assistant("quantos chamados estão abertos?")
		self.assertEqual(seen["name"], "query")
		self.assertIn("ticket", seen["sql"])
		self.assertIn("18", result["draft"])
		self.assertEqual(len(client.models.configs), 2)

	def test_dashboard_assistant_answers_when_the_tool_round_is_silent(self):
		call = _ToolCall("query", {"sql": "SELECT id FROM ticket", "database": "computicket"})
		client = _FakeGemini([
			_GeminiReply("", [call]),
			_GeminiReply(""),
		])
		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
			patch("app.services.copilot._dispatch_database_tool", return_value='{"rows": []}'),
			patch(
				"app.services.copilot._generate",
				return_value={
					"draft": "A mensagem do Clipp aponta falha de rede ao abrir o módulo. Confira internet, DNS e se o servidor do Clipp responde.",
					"cited": [],
				},
			) as generate,
		):
			result = answer_assistant("o sistema clipp não abre, verifique a internet")
		self.assertIn("Clipp", result["draft"])
		self.assertNotIn("não devolveu uma resposta", result["draft"])
		self.assertIn("CONSULTAS JÁ FEITAS", generate.call_args.args[0])

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
			self.assertEqual(results[0]["href"], f"/conhecimento/{category_id}?artigo={article.id}")
			self.assertEqual(results[0]["article_id"], article.id)

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

	def _staff_user(self, email="assistente@example.invalid"):
		user = User(name="Ana Técnica", email=email, password_hash="x", status="1")
		db.session.add(user)
		db.session.commit()
		return user

	def test_support_solution_is_not_saved_without_the_fix(self):
		from app.services.assistant_actions import save_support_solution

		user = self._staff_user()
		result = save_support_solution(
			{
				"problem": "O módulo do Clipp não abre e pede para verificar a internet",
				"solution": "reiniciei",
			},
			user.id,
		)
		self.assertFalse(result["ok"])
		self.assertEqual(KnowledgeArticle.query.count(), 0)

	def test_support_solution_is_saved_and_indexed(self):
		from app.services.assistant_actions import save_support_solution

		user = self._staff_user("solucao@example.invalid")
		with patch("app.services.rag.embed_texts", side_effect=GeminiError("offline")):
			result = save_support_solution(
				{
					"title": "Clipp não abre",
					"problem": "O módulo do Clipp não abre e pede para verificar a internet",
					"solution": "Reiniciei o serviço do Clipp e a internet do caixa voltou",
				},
				user.id,
			)
		self.assertTrue(result["ok"])
		article = db.session.get(KnowledgeArticle, result["article_id"])
		self.assertEqual(article.title, "Clipp não abre")
		self.assertEqual(article.status, "published")
		self.assertIn("Problema", article.content)
		self.assertIn("Solução", article.content)
		self.assertIn("Reiniciei o serviço", article.content)
		self.assertEqual(
			KnowledgeChunk.query.filter_by(source_type="knowledge_article", source_id=article.id).count(),
			1,
		)

	def test_dashboard_appointment_requires_a_linked_client(self):
		from app.models import Appointment
		from app.services.assistant_actions import create_appointment

		user = self._staff_user("agenda@example.invalid")
		result = create_appointment(
			{
				"title": "Visita Clipp",
				"appointment_date": "2026-11-16T14:00:00",
				"cliente": "Loja Fantasma",
			},
			user.id,
		)
		self.assertFalse(result["ok"])
		self.assertEqual(Appointment.query.count(), 0)

	def test_dashboard_appointment_is_created_for_a_linked_client(self):
		from app.models import Appointment, HelpDeskContactClientLink
		from app.services.assistant_actions import create_appointment

		user = self._staff_user("agenda-ok@example.invalid")
		db.session.add(
			HelpDeskContactClientLink(
				engine_contact_id=41,
				external_client_id=77,
				external_client_name="Padaria do João",
			)
		)
		db.session.commit()
		with (
			patch("app.notification_service.create_notifications"),
			patch("app.services.assistant_actions.enviar_email_confirmacao"),
			patch("app.services.assistant_actions.notify_appointment_whatsapp"),
		):
			result = create_appointment(
				{
					"title": "Visita Clipp",
					"appointment_date": "2026-11-16T14:00:00",
					"cliente": "Padaria do João",
					"description": "Módulo não abre",
				},
				user.id,
			)
		self.assertTrue(result["ok"])
		row = db.session.get(Appointment, result["appointment_id"])
		self.assertEqual(row.client_id, 77)
		self.assertEqual(row.user_id, user.id)
		self.assertEqual(row.created_by, user.id)
		self.assertIn("Padaria do João", result["message"])

	def test_dashboard_assistant_saves_the_solution_from_the_tool(self):
		user = self._staff_user("ferramenta@example.invalid")
		call = _ToolCall(
			"save_support_solution",
			{
				"title": "Clipp não abre",
				"problem": "O módulo do Clipp não abre e pede para verificar a internet",
				"solution": "Reiniciei o serviço do Clipp e a internet do caixa voltou",
			},
		)
		client = _FakeGemini([
			_GeminiReply("", [call]),
			_GeminiReply("Salvei no conhecimento: Clipp não abre."),
		])
		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
			patch("app.services.rag.embed_texts", side_effect=GeminiError("offline")),
		):
			result = answer_assistant(
				"o clipp não abre. resolvi reiniciando o serviço do caixa",
				actor_id=user.id,
			)
		self.assertIn("conhecimento", result["draft"])
		article = KnowledgeArticle.query.filter_by(title="Clipp não abre").one()
		self.assertEqual(article.created_by_id, user.id)
		self.assertIn("verificar a internet", article.content)

	def test_dashboard_assistant_sends_the_print_to_the_model(self):
		import base64

		client = _FakeGemini([_GeminiReply("O print mostra o Clipp sem acesso ao módulo.")])
		seen = {}
		original = client.models.generate_content

		def wrapped(**kwargs):
			seen["contents"] = kwargs.get("contents")
			return original(**kwargs)

		client.models.generate_content = wrapped
		png = base64.b64encode(b"\x89PNG\r\n\x1a\nprint").decode("ascii")
		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
		):
			result = answer_assistant("", image=f"data:image/png;base64,{png}")
		self.assertIn("Clipp", result["draft"])
		parts = seen["contents"][0]["parts"]
		self.assertEqual(len(parts), 2)
		self.assertIn("print", parts[0]["text"])

		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
		):
			with self.assertRaises(CopilotError) as raised:
				answer_assistant("oi", image="data:text/plain;base64,YQ==")
		self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
	unittest.main()
