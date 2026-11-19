import unittest
from datetime import timedelta
from unittest.mock import patch

from flask import Flask

from app import db
from app.engine_client import EngineError
from app.models import Ticket, User
from app.services.assistant_actions import (
	begin_group_send,
	brasilia_period,
	collect_agent_groups,
	operation_report,
	resolve_agent_groups,
	send_agent_group_message,
)
from app.services.copilot import answer_assistant


JID_A = "120363000000000001@g.us"
JID_B = "120363000000000002@g.us"


def _prompts():
	return [
		{
			"id": 1,
			"name": "Atendimento",
			"idleAlertGroupJid": JID_A,
			"apiKey": "nao-pode-vazar",
		},
		{
			"id": 2,
			"name": "Financeiro",
			"idleAlertGroupJid": JID_B,
			"apiKey": "outra-chave",
		},
	]


def _connections():
	return [
		{"id": 10, "name": "Suporte", "promptId": 1, "status": "CONNECTED"},
		{"id": 11, "name": "Cobranca", "promptId": 2, "status": "DISCONNECTED"},
	]


def _contacts():
	return [
		{"id": 1, "name": "Agentes IA", "number": JID_A},
		{"id": 2, "name": "Financeiro interno", "number": JID_B},
	]


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

	def generate_content(self, **kwargs):
		return self._replies.pop(0)


class _FakeGemini:
	def __init__(self, replies):
		self.models = _FakeModels(replies)


class AgentGroupMessageTest(unittest.TestCase):
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
		begin_group_send()

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def _user(self):
		user = User(name="Ana Técnica", email="ana-grupo@example.invalid", password_hash="x", status="1")
		db.session.add(user)
		db.session.commit()
		return user

	def test_collects_one_row_per_group_and_prefers_the_connected_number(self):
		rows = collect_agent_groups(
			[
				{"id": 1, "name": "Atendimento", "idleAlertGroupJid": "120363000000000001"},
				{"id": 3, "name": "Plantão", "idleAlertGroupJid": JID_A, "apiKey": "segredo"},
			],
			[
				{"id": 10, "name": "Suporte", "promptId": "1", "status": "DISCONNECTED"},
				{"id": 12, "name": "Plantão", "promptId": 3, "status": "CONNECTED"},
			],
			[{"name": "Agentes IA", "number": JID_A}],
		)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["jid"], JID_A)
		self.assertEqual(rows[0]["group_name"], "Agentes IA")
		self.assertEqual(rows[0]["agents"], ["Atendimento", "Plantão"])
		self.assertEqual(rows[0]["whatsapp_id"], 12)
		self.assertTrue(rows[0]["connected"])
		self.assertNotIn("segredo", str(rows[0]))

	def test_one_group_is_used_when_the_person_does_not_name_it(self):
		groups = collect_agent_groups(_prompts()[:1], _connections()[:1], _contacts()[:1])
		decision = resolve_agent_groups(groups, "")
		self.assertEqual(decision["action"], "send")
		self.assertEqual(decision["groups"][0]["group_name"], "Agentes IA")

	def test_several_groups_wait_for_a_choice(self):
		groups = collect_agent_groups(_prompts(), _connections(), _contacts())
		decision = resolve_agent_groups(groups, "no grupo")
		self.assertEqual(decision["action"], "choose")
		self.assertEqual(len(decision["groups"]), 2)

	def test_agent_name_selects_its_group(self):
		groups = collect_agent_groups(_prompts(), _connections(), _contacts())
		decision = resolve_agent_groups(groups, "financeiro")
		self.assertEqual(decision["action"], "send")
		self.assertEqual(decision["groups"][0]["jid"], JID_B)

	def test_todos_selects_every_group(self):
		groups = collect_agent_groups(_prompts(), _connections(), _contacts())
		decision = resolve_agent_groups(groups, "todos os grupos")
		self.assertEqual(decision["action"], "send")
		self.assertEqual(len(decision["groups"]), 2)

	def _engine(self, posts, prompts=None, connections=None, contacts=None):
		prompts = _prompts() if prompts is None else prompts
		connections = _connections() if connections is None else connections
		contacts = _contacts() if contacts is None else contacts

		def admin(method, path, **kwargs):
			if method == "GET" and path == "/prompt":
				return {"prompts": prompts, "hasMore": False}
			if method == "GET" and path == "/whatsapp":
				return connections
			if method == "GET" and path == "/contacts/groups":
				return contacts
			if method == "POST" and path == "/messages/send-to-group":
				posts.append(kwargs["json"])
				return {"ok": True, "messageId": "m1"}
			raise AssertionError(f"chamada inesperada {method} {path}")

		return admin

	def test_sends_the_signed_text_to_the_only_group(self):
		user = self._user()
		posts = []
		with patch(
			"app.engine_client.admin_request",
			side_effect=self._engine(posts, _prompts()[:1], _connections()[:1], _contacts()[:1]),
		):
			result = send_agent_group_message(
				{"message": "O valor mínimo do atendimento passa a ser R$ 80."},
				user.id,
			)
		self.assertTrue(result["ok"])
		self.assertIn("Agentes IA", result["message"])
		self.assertEqual(len(posts), 1)
		self.assertEqual(posts[0]["groupJid"], JID_A)
		self.assertEqual(posts[0]["whatsappId"], 10)
		self.assertTrue(posts[0]["body"].startswith("*ANA TÉCNICA*"))
		self.assertIn("R$ 80", posts[0]["body"])
		self.assertNotIn("nao-pode-vazar", posts[0]["body"])
		self.assertNotIn("apiKey", str(result))

	def test_does_not_send_until_the_group_is_chosen(self):
		user = self._user()
		posts = []
		with patch("app.engine_client.admin_request", side_effect=self._engine(posts)):
			result = send_agent_group_message(
				{"message": "Relatório dos chamados de hoje."},
				user.id,
			)
		self.assertFalse(result["ok"])
		self.assertTrue(result["needs_choice"])
		self.assertEqual(posts, [])
		names = {item["group"] for item in result["groups"]}
		self.assertEqual(names, {"Agentes IA", "Financeiro interno"})

	def test_second_send_of_the_same_text_does_not_hit_whatsapp_again(self):
		user = self._user()
		posts = []
		text = {"message": "O valor mínimo do atendimento passa a ser R$ 80.", "group": "Agentes IA"}
		with patch("app.engine_client.admin_request", side_effect=self._engine(posts)):
			first = send_agent_group_message(text, user.id)
			second = send_agent_group_message(text, user.id)
		self.assertTrue(first["ok"])
		self.assertTrue(second["ok"])
		self.assertEqual(len(posts), 1)

	def test_refuses_a_disconnected_group(self):
		user = self._user()
		posts = []
		with patch("app.engine_client.admin_request", side_effect=self._engine(posts)):
			result = send_agent_group_message(
				{"message": "Fechamento do financeiro de hoje.", "group": "Financeiro"},
				user.id,
			)
		self.assertFalse(result["ok"])
		self.assertIn("desconectado", result["message"])
		self.assertEqual(posts, [])

	def test_reports_the_engine_failure(self):
		user = self._user()

		def admin(method, path, **kwargs):
			if method == "GET" and path == "/prompt":
				return {"prompts": _prompts()[:1], "hasMore": False}
			if method == "GET" and path == "/whatsapp":
				return _connections()[:1]
			if method == "GET" and path == "/contacts/groups":
				return _contacts()[:1]
			raise EngineError("WhatsApp indisponível", 503)

		with patch("app.engine_client.admin_request", side_effect=admin):
			result = send_agent_group_message(
				{"message": "O valor mínimo do atendimento passa a ser R$ 80."},
				user.id,
			)
		self.assertFalse(result["ok"])
		self.assertIn("indisponível", result["message"])

	def test_operation_report_uses_brasilia_day_and_ignores_cancelled(self):
		user = self._user()
		partner = User(name="Bruno", email="bruno-grupo@example.invalid", password_hash="x", status="1")
		db.session.add(partner)
		db.session.commit()
		period = brasilia_period()
		today = period["day_start"] + timedelta(hours=2)
		db.session.add_all(
			[
				Ticket(
					title="Caixa sem internet",
					opened_by_id=user.id,
					assigned_to_id=user.id,
					status="aberto",
					external_client_name="Padaria",
					created_at=today,
				),
				Ticket(
					title="Nota rejeitada",
					opened_by_id=user.id,
					assigned_to_id=partner.id,
					status="fechado",
					external_client_name="Mercado",
					created_at=period["day_start"] - timedelta(days=2),
					closed_at=today,
				),
				Ticket(
					title="Chamado cancelado",
					opened_by_id=user.id,
					status="cancelado",
					created_at=today,
					cancelled_at=today,
				),
				Ticket(
					title="Fechado pela Ana",
					opened_by_id=user.id,
					assigned_to_id=user.id,
					status="fechado",
					created_at=period["day_start"] - timedelta(days=2),
					closed_at=today,
				),
			]
		)
		db.session.commit()
		today_report = operation_report({"kind": "hoje"}, user.id)
		self.assertTrue(today_report["ok"])
		self.assertEqual(today_report["created"], 1)
		self.assertEqual(today_report["closed"], 2)
		self.assertEqual(today_report["open"], 1)
		self.assertEqual(today_report["tickets"][0]["client"], "Padaria")
		self.assertEqual(today_report["tickets"][0]["attendant"], "Ana Técnica")
		created = operation_report({"kind": "criados_hoje"}, user.id)
		self.assertEqual(created["created"], 1)
		self.assertEqual(created["tickets"][0]["title"], "Caixa sem internet")
		ranking = operation_report({"kind": "top_mes"}, user.id)
		self.assertEqual(ranking["ranking"][0], {"name": "Ana Técnica", "closed": 1})
		self.assertEqual(ranking["ranking"][1]["name"], "Bruno")
		self.assertFalse(operation_report({"kind": "senha"}, user.id)["ok"])

	def test_assistant_sends_the_group_message_from_the_tool(self):
		user = self._user()
		posts = []
		client = _FakeGemini(
			[
				_GeminiReply(
					"",
					[
						_ToolCall(
							"send_agent_group_message",
							{"message": "O valor mínimo do atendimento passa a ser R$ 80."},
						)
					],
				),
				_GeminiReply("Enviei o aviso no grupo Agentes IA."),
			]
		)
		with (
			patch("app.services.copilot.hybrid_search", return_value=[]),
			patch("app.services.copilot.get_client", return_value=client),
			patch(
				"app.engine_client.admin_request",
				side_effect=self._engine(posts, _prompts()[:1], _connections()[:1], _contacts()[:1]),
			),
		):
			result = answer_assistant(
				"avise no grupo que o valor mínimo passa a ser 80 reais",
				actor_id=user.id,
			)
		self.assertIn("Agentes IA", result["draft"])
		self.assertEqual(posts[0]["groupJid"], JID_A)
		self.assertIn("R$ 80", posts[0]["body"])


if __name__ == "__main__":
	unittest.main()
