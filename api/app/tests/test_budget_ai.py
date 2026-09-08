import unittest

from flask import Flask

from app import db
from app.models import Plan, System
from app.services.budget_ai import (
	_post_process,
	extract_seat_count,
	wants_alternative_options,
	_fetch_plan_candidates,
)


class BudgetAIHelpersTest(unittest.TestCase):
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

	def test_detects_alternative_options_only_when_asked(self):
		self.assertTrue(wants_alternative_options("duas opções: com e sem relógio de ponto"))
		self.assertTrue(wants_alternative_options("montar alternativas de proposta"))
		self.assertFalse(wants_alternative_options("orçamento do plano RH ID para 10 colaboradores"))

	def test_extracts_seat_count(self):
		self.assertEqual(extract_seat_count("plano RH ID para 10 colaboradores"), 10)
		self.assertEqual(extract_seat_count("15 licenças do sistema"), 15)
		self.assertIsNone(extract_seat_count("instalação de câmeras"))

	def test_plan_candidates_match_name_and_skip_unrelated_prompts(self):
		system = System(name="RH ID", description="Ponto e RH", is_active=True)
		db.session.add(system)
		db.session.flush()
		db.session.add(
			Plan(
				system_id=system.id,
				name="RH ID Essencial",
				description="Ponto eletrônico por colaborador",
				monthly_value=39.9,
				setup_fee=150.0,
				is_active=True,
			)
		)
		db.session.commit()

		matched = _fetch_plan_candidates("orçamento com o plano do RH ID para 10 colaboradores")
		self.assertTrue(matched)
		self.assertEqual(matched[0]["name"], "RH ID Essencial")
		self.assertEqual(matched[0]["monthly_value"], 39.9)

		unrelated = _fetch_plan_candidates("2 switches PoE e 50 metros de cabo")
		self.assertEqual(unrelated, [])

	def test_post_process_keeps_options_only_when_requested_and_complete(self):
		raw = {
			"title": "Proposta",
			"description": "",
			"payment_terms": "",
			"internal_notes": "",
			"items": [
				{
					"item_type": "manual",
					"description": "<p>Opção A</p>",
					"quantity": 10,
					"unit_price": 39.9,
					"option_key": "1",
					"option_label": "Com relógio",
					"is_recurring": True,
					"recurrence_period": "monthly",
				},
				{
					"item_type": "manual",
					"description": "<p>Opção B</p>",
					"quantity": 10,
					"unit_price": 29.9,
					"option_key": "2",
					"option_label": "Sem relógio",
				},
			],
		}
		flat = _post_process(raw, [], [], wants_options=False)
		self.assertIsNone(flat["items"][0]["option_key"])
		grouped = _post_process(raw, [], [], wants_options=True)
		self.assertEqual(grouped["items"][0]["option_key"], "1")
		self.assertTrue(grouped["items"][0]["is_recurring"])
		self.assertEqual(grouped["items"][1]["option_label"], "Sem relógio")
