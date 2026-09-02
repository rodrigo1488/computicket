import tempfile
import unittest
from io import BytesIO

from flask import Flask
from werkzeug.security import generate_password_hash

from app import db, login_manager
from app.blueprints.auth import bp as auth_bp
from app.blueprints.web_api import bp as web_api_bp
from app.models import User

_PNG = bytes.fromhex(
	"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
	"0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


class UserAvatarApiTest(unittest.TestCase):
	def setUp(self):
		self._tmp = tempfile.TemporaryDirectory()
		self.app = Flask(__name__, root_path=self._tmp.name)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(self.app)
		login_manager.init_app(self.app)
		self.app.register_blueprint(auth_bp)
		self.app.register_blueprint(web_api_bp)
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		user = User(
			name="Admin Foto",
			email="foto@example.invalid",
			password_hash=generate_password_hash("secret12"),
			role="admin",
			status="1",
		)
		db.session.add(user)
		db.session.commit()
		self.user_id = user.id
		self.client = self.app.test_client()

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()
		self._tmp.cleanup()

	def _login(self):
		res = self.client.post(
			"/auth/api/login",
			json={"email": "foto@example.invalid", "password": "secret12"},
		)
		self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
		return res.get_json()

	def test_upload_list_and_fetch_avatar(self):
		payload = self._login()
		self.assertIsNone(payload.get("avatar_url"))

		bad = self.client.post(
			"/auth/api/me/avatar",
			data={"file": (BytesIO(b"not-an-image"), "notes.txt")},
			content_type="multipart/form-data",
		)
		self.assertEqual(bad.status_code, 400)

		ok = self.client.post(
			"/auth/api/me/avatar",
			data={"file": (BytesIO(_PNG), "foto.png")},
			content_type="multipart/form-data",
		)
		self.assertEqual(ok.status_code, 200, ok.get_data(as_text=True))
		body = ok.get_json()
		self.assertTrue(body["avatar_url"].startswith("/flask/auth/api/me/avatar?v="))

		listed = self.client.get("/api/web/users?status=all")
		self.assertEqual(listed.status_code, 200)
		item = listed.get_json()["items"][0]
		self.assertTrue(item["avatar_url"].startswith(f"/flask/api/web/users/{self.user_id}/avatar?v="))

		img = self.client.get(f"/api/web/users/{self.user_id}/avatar")
		self.assertEqual(img.status_code, 200)
		self.assertEqual(img.data[:8], b"\x89PNG\r\n\x1a\n")

		admin_post = self.client.post(
			f"/api/web/users/{self.user_id}/avatar",
			data={"file": (BytesIO(_PNG), "outra.png")},
			content_type="multipart/form-data",
		)
		self.assertEqual(admin_post.status_code, 200)

		removed = self.client.delete("/auth/api/me/avatar")
		self.assertEqual(removed.status_code, 200)
		self.assertIsNone(removed.get_json().get("avatar_url"))
		self.assertEqual(self.client.get(f"/api/web/users/{self.user_id}/avatar").status_code, 404)


if __name__ == "__main__":
	unittest.main()
