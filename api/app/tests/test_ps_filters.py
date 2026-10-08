import json
import unittest
from urllib.parse import quote

from flask import Flask

from app.blueprints.ps import apply_ps_list_filters
from app.query_filters import filter_dicts


class PsListFilterTest(unittest.TestCase):
	def test_filters_by_client_date_and_value_then_sorts(self):
		items = [
			{"client_name": "Alpha", "issued_at": "2026-01-10T12:00:00", "value": 100},
			{"client_name": "Beta", "issued_at": "2026-03-01", "value": 50},
			{"client_name": "Alpha Ltda", "issued_at": "2026-02-01", "value": 200},
			{"client_name": "Alpha Sem Data", "issued_at": None, "value": 900},
		]
		out = apply_ps_list_filters(
			items,
			client="alpha",
			date_from="2026-01-15",
			date_to="2026-12-31",
			value_min="150",
			value_max="250,00",
			sort="value_desc",
		)
		self.assertEqual([item["client_name"] for item in out], ["Alpha Ltda"])

	def test_sorts_by_smallest_value(self):
		items = [
			{"client_name": "B", "issued_at": "2026-01-02", "value": 30},
			{"client_name": "A", "issued_at": "2026-01-01", "value": 10},
		]
		out = apply_ps_list_filters(items, sort="value_asc")
		self.assertEqual([item["value"] for item in out], [10, 30])

	def test_column_filters_compare_value_and_date(self):
		app = Flask(__name__)
		items = [
			{"value": 10, "issued_at": "2026-05-01T00:00:00", "client_name": "Acme"},
			{"value": 4, "issued_at": "2026-04-01", "client_name": "Outro"},
		]
		raw = json.dumps(
			[
				{"field": "value", "op": "gte", "value": "10"},
				{"field": "issued_at", "op": "on", "value": "2026-05-01"},
				{"field": "client_name", "op": "contains", "value": "acm"},
			]
		)
		with app.test_request_context(f"/?col_filters={quote(raw)}"):
			matched = filter_dicts(items)
		self.assertEqual(len(matched), 1)
		self.assertEqual(matched[0]["client_name"], "Acme")
