import unittest

from flask import Flask

from app.blueprints.helpdesk import _fail, _humanize_engine_error
from app.engine_client import EngineError


class HelpdeskMediaErrorTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
		self.ctx = self.app.test_request_context(
			"/helpdesk/api/conversations/1/messages",
			method="POST",
			content_type="multipart/form-data; boundary=----test",
		)
		self.ctx.push()

	def tearDown(self):
		self.ctx.pop()

	def test_fail_maps_engine_500_code_without_unavailable_prefix(self):
		resp, status = _fail(EngineError("ERR_INTERNAL_SERVER_ERROR", 500))
		self.assertEqual(status, 500)
		data = resp.get_json()
		self.assertNotIn("indispon", data["error"].lower())
		self.assertNotIn("ERR_INTERNAL", data["error"])
		self.assertIn("tente novamente", data["error"].lower())

	def test_fail_keeps_unavailable_for_connection_errors(self):
		resp, status = _fail(EngineError("Engine WhatsApp indisponível: Connection refused", 503))
		self.assertEqual(status, 503)
		self.assertIn("indispon", resp.get_json()["error"].lower())

	def test_fail_maps_timeout_on_media_post(self):
		resp, status = _fail(EngineError("Engine WhatsApp indisponível: Read timed out", 503))
		data = resp.get_json()
		self.assertIn("demorou", data["error"].lower())
		self.assertNotIn("indispon", data["error"].lower())

	def test_humanize_invalid_media(self):
		self.assertIn("MP4", _humanize_engine_error("ERR_INVALID_MEDIA", 400))
