import os
import tempfile
import unittest
from io import BytesIO

from flask import Flask, jsonify
from werkzeug.security import generate_password_hash

from app import db, login_manager
from app.blueprints.auth import bp as auth_bp
from app.blueprints.utilitarios import MAX_FILE_SIZE, bp as utilitarios_bp
from app.models import User, UtilityFile


class UtilitariosApiTest(unittest.TestCase):
	def setUp(self):
		self._tmp = tempfile.TemporaryDirectory()
		self.app = Flask(__name__, instance_path=self._tmp.name)
		self.app.config.update(
			SQLALCHEMY_DATABASE_URI="sqlite://",
			SQLALCHEMY_TRACK_MODIFICATIONS=False,
			SECRET_KEY="test-secret",
			TESTING=True,
		)
		db.init_app(self.app)
		login_manager.init_app(self.app)

		@login_manager.unauthorized_handler
		def _unauthorized():
			return jsonify({"error": "Não autenticado"}), 401

		self.app.register_blueprint(auth_bp)
		self.app.register_blueprint(utilitarios_bp)
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		user = User(
			name="Admin Arquivos",
			email="arquivos@example.invalid",
			password_hash=generate_password_hash("secret12"),
			role="admin",
			status="1",
		)
		db.session.add(user)
		db.session.commit()
		self.client = self.app.test_client()

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()
		self._tmp.cleanup()

	def _login(self):
		res = self.client.post(
			"/auth/api/login",
			json={"email": "arquivos@example.invalid", "password": "secret12"},
		)
		self.assertEqual(res.status_code, 200, res.get_data(as_text=True))

	def _upload(self, filename="manual.pdf", content=b"%PDF-1.4 teste", title="Manual Uniplus", description="Guia"):
		self._login()
		return self.client.post(
			"/utilitarios/api",
			data={
				"title": title,
				"description": description,
				"file": (BytesIO(content), filename),
			},
			content_type="multipart/form-data",
		)

	def test_public_list_is_empty_without_files(self):
		res = self.client.get("/utilitarios/api/publico")
		self.assertEqual(res.status_code, 200)
		self.assertEqual(res.get_json()["items"], [])

	def test_upload_requires_login(self):
		res = self.client.post(
			"/utilitarios/api",
			data={"file": (BytesIO(b"%PDF-1.4"), "manual.pdf")},
			content_type="multipart/form-data",
		)
		self.assertEqual(res.status_code, 401)

	def test_upload_list_and_public_download(self):
		created = self._upload()
		self.assertEqual(created.status_code, 201, created.get_data(as_text=True))
		item = created.get_json()["items"][0]
		self.assertEqual(item["title"], "Manual Uniplus")
		self.assertNotIn("file_path", item)
		self.assertNotIn("filename", item)

		public = self.client.get("/utilitarios/api/publico")
		self.assertEqual(public.status_code, 200)
		listed = public.get_json()["items"]
		self.assertEqual(len(listed), 1)
		self.assertEqual(listed[0]["id"], item["id"])
		self.assertEqual(listed[0]["original_filename"], "manual.pdf")

		download = self.client.get(f"/utilitarios/api/publico/{item['id']}/download")
		self.assertEqual(download.status_code, 200)
		self.assertEqual(download.data, b"%PDF-1.4 teste")
		self.assertIn("attachment", download.headers.get("Content-Disposition", ""))

		row = UtilityFile.query.get(item["id"])
		self.assertEqual(row.download_count, 1)

	def test_rejects_disallowed_extension(self):
		res = self._upload(filename="script.html", content=b"<script>alert(1)</script>")
		self.assertEqual(res.status_code, 400)
		self.assertIn("não permitido", res.get_json()["error"])
		self.assertEqual(UtilityFile.query.count(), 0)

	def test_delete_removes_file_from_disk(self):
		created = self._upload()
		file_id = created.get_json()["items"][0]["id"]
		row = UtilityFile.query.get(file_id)
		path = os.path.join(self.app.instance_path, "utilitarios_uploads", row.filename)
		self.assertTrue(os.path.isfile(path))

		removed = self.client.delete(f"/utilitarios/api/{file_id}")
		self.assertEqual(removed.status_code, 200)
		self.assertIsNone(UtilityFile.query.get(file_id))
		self.assertFalse(os.path.isfile(path))

	def test_update_title(self):
		created = self._upload()
		file_id = created.get_json()["items"][0]["id"]
		res = self.client.patch(f"/utilitarios/api/{file_id}", json={"title": "Instalador"})
		self.assertEqual(res.status_code, 200)
		self.assertEqual(res.get_json()["title"], "Instalador")

	def test_max_file_size_is_one_gb(self):
		self.assertEqual(MAX_FILE_SIZE, 1024 * 1024 * 1024)


if __name__ == "__main__":
	unittest.main()
