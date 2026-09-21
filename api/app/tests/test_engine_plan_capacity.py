import unittest
from unittest.mock import patch

from app import engine_client as ec


class EnginePlanCapacityTest(unittest.TestCase):
	def setUp(self):
		ec._plan_capacity_ensured = False

	def tearDown(self):
		ec._plan_capacity_ensured = False

	@patch("app.engine_client.admin_request")
	def test_raises_plan_below_embedded_limit(self, admin_request):
		admin_request.side_effect = [
			[
				{
					"id": 1,
					"name": "Plano 1",
					"users": 10,
					"connections": 10,
					"queues": 10,
					"value": 30,
				}
			],
			{"id": 1, "users": 9999},
		]
		ec.ensure_engine_plan_capacity()
		self.assertTrue(ec._plan_capacity_ensured)
		self.assertEqual(admin_request.call_count, 2)
		method, path = admin_request.call_args_list[1][0][:2]
		self.assertEqual(method, "PUT")
		self.assertEqual(path, "/plans/1")
		body = admin_request.call_args_list[1][1]["json"]
		self.assertEqual(body["id"], 1)
		self.assertEqual(body["users"], 9999)
		self.assertEqual(body["connections"], 9999)
		self.assertEqual(body["queues"], 9999)

	@patch("app.engine_client.admin_request")
	def test_skips_put_when_plan_already_high(self, admin_request):
		admin_request.return_value = [
			{"id": 1, "name": "Plano 1", "users": 9999, "connections": 9999, "queues": 9999}
		]
		ec.ensure_engine_plan_capacity()
		self.assertTrue(ec._plan_capacity_ensured)
		self.assertEqual(admin_request.call_count, 1)

	@patch("app.engine_client.admin_request")
	def test_does_not_repeat_after_success(self, admin_request):
		admin_request.return_value = [
			{"id": 1, "users": 9999, "connections": 9999, "queues": 9999}
		]
		ec.ensure_engine_plan_capacity()
		ec.ensure_engine_plan_capacity()
		self.assertEqual(admin_request.call_count, 1)

	@patch("app.engine_client.admin_request")
	def test_retries_later_if_put_fails(self, admin_request):
		admin_request.side_effect = [
			[{"id": 1, "users": 10, "connections": 10, "queues": 10, "value": 0}],
			ec.EngineError("Acesso não permitido", 401),
		]
		ec.ensure_engine_plan_capacity()
		self.assertFalse(ec._plan_capacity_ensured)
		admin_request.side_effect = [
			[{"id": 1, "users": 10, "connections": 10, "queues": 10, "value": 0}],
			{"id": 1},
		]
		ec.ensure_engine_plan_capacity()
		self.assertTrue(ec._plan_capacity_ensured)

	def test_as_plan_list_unwraps_dict(self):
		self.assertEqual(ec._as_plan_list({"plans": [{"id": 1}]}), [{"id": 1}])
