import unittest
from datetime import timedelta

from flask import Flask

from app import db
from app.models import RemoteAgent, RemoteAgentAlert, RemoteAgentSample
from app.remote_monitor_service import (
	activate,
	authenticate_agent,
	create_enrollment,
	hash_activation_code,
	hash_agent_token,
	ingest_telemetry,
	mark_offline_agents,
	purge_old_samples,
	revoke_agent,
	utc_now,
	verify_agent_token,
)


class RemoteMonitorServiceTest(unittest.TestCase):
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

	def test_hashing_is_normalized_and_token_comparison_is_exact(self):
		self.assertEqual(hash_activation_code("ABCD-EF12-3456"), hash_activation_code("abcd ef12 3456"))
		token_hash = hash_agent_token("token-secreto")
		self.assertTrue(verify_agent_token("token-secreto", token_hash))
		self.assertFalse(verify_agent_token("token-diferente", token_hash))

	def test_activation_code_is_single_use(self):
		agent = RemoteAgent(
			external_client_id=10,
			external_client_name="Cliente",
			name="PC-01",
			thresholds={},
		)
		db.session.add(agent)
		db.session.commit()
		code = create_enrollment(agent)

		activated, token = activate(code, "f862a5bf-0437-4d15-935b-8a1ec9585179", "1.0")
		self.assertEqual(activated.status, "online")
		self.assertTrue(verify_agent_token(token, activated.token_hash))
		with self.assertRaises(ValueError):
			activate(code)

	def test_authentication_revocation_and_offline_transition(self):
		from app.remote_monitor_service import OFFLINE_AFTER_SECONDS, register_agent_connection, unregister_agent_connection, utc_iso

		agent = RemoteAgent(external_client_id=10, external_client_name="Cliente", name="PC-02", thresholds={})
		db.session.add(agent)
		db.session.commit()
		activated, token = activate(create_enrollment(agent))
		self.assertEqual(authenticate_agent(activated.device_uuid, token).id, activated.id)
		payload = activated.to_dict()
		self.assertTrue(str(payload["last_seen"]).endswith("Z"))
		self.assertRegex(payload["last_seen"], r"^\d{4}-\d{2}-\d{2}T")
		self.assertEqual(utc_iso(activated.last_seen), payload["last_seen"])

		activated.last_seen = utc_now() - timedelta(seconds=OFFLINE_AFTER_SECONDS + 1)
		db.session.commit()
		register_agent_connection("sid-alive", activated.id)
		self.assertEqual(mark_offline_agents(), 0)
		self.assertEqual(activated.status, "online")
		unregister_agent_connection("sid-alive")

		activated.last_seen = utc_now() - timedelta(seconds=OFFLINE_AFTER_SECONDS + 1)
		db.session.commit()
		self.assertEqual(mark_offline_agents(), 1)
		self.assertEqual(activated.status, "offline")
		self.assertIsNotNone(RemoteAgentAlert.query.filter_by(agent_id=agent.id, alert_type="offline").first())
		revoke_agent(activated)
		self.assertIsNone(authenticate_agent(activated.device_uuid, token))

	def test_telemetry_snapshot_alert_resolution_and_retention(self):
		agent = RemoteAgent(
			external_client_id=10,
			external_client_name="Cliente",
			name="PC-03",
			thresholds={"cpu": 90, "ram": 90, "disk": 90, "temperature": 85},
		)
		db.session.add(agent)
		db.session.commit()
		agent, _token = activate(create_enrollment(agent))
		ingest_telemetry(agent, {
			"metrics": {"cpu_percent": 95, "ram_percent": 30, "disk_percent": 40},
			"inventory": {"status": "available"},
			"updates": {"status": "available", "data": {"count": 0}},
		})
		alert = RemoteAgentAlert.query.filter_by(agent_id=agent.id, alert_type="cpu", resolved_at=None).first()
		self.assertIsNotNone(alert)
		self.assertEqual(RemoteAgentSample.query.filter_by(agent_id=agent.id).count(), 1)
		ingest_telemetry(agent, {"metrics": {"cpu_percent": 10}, "inventory": {}, "updates": {}})
		self.assertIsNotNone(alert.resolved_at)
		sample = RemoteAgentSample.query.filter_by(agent_id=agent.id).first()
		sample.minute_at = utc_now() - timedelta(days=31)
		db.session.commit()
		self.assertEqual(purge_old_samples(), 1)


if __name__ == "__main__":
	unittest.main()
