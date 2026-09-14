import os
import tempfile
import unittest
from io import BytesIO

from flask import Flask, jsonify
from werkzeug.security import generate_password_hash

from app import db, login_manager
from app.blueprints.auth import bp as auth_bp
from app.blueprints.utilitarios import MAX_FILE_SIZE, bp as utilitarios_bp
from app.models import User, UtilityCategory, UtilityFile


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

	def test_chunked_upload_assembles_file(self):
		self.app.config["UTILITARIOS_CHUNK_SIZE"] = 4
		self._login()
		content = b"ABCDEFGHIJ"
		init = self.client.post(
			"/utilitarios/api/uploads",
			json={"filename": "pacote.zip", "size": len(content), "title": "Pacote", "mime": "application/zip"},
		)
		self.assertEqual(init.status_code, 201, init.get_data(as_text=True))
		payload = init.get_json()
		upload_id = payload["upload_id"]
		self.assertEqual(payload["total_chunks"], 3)
		self.assertEqual(payload["chunk_size"], 4)
		for index in range(payload["total_chunks"]):
			start = index * 4
			chunk = content[start:start + 4]
			res = self.client.put(
				f"/utilitarios/api/uploads/{upload_id}/chunks/{index}",
				data=chunk,
				content_type="application/octet-stream",
			)
			self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
		done = self.client.post(f"/utilitarios/api/uploads/{upload_id}/complete")
		self.assertEqual(done.status_code, 201, done.get_data(as_text=True))
		item = done.get_json()
		self.assertEqual(item["title"], "Pacote")
		self.assertEqual(item["original_filename"], "pacote.zip")
		self.assertEqual(item["file_size"], len(content))
		download = self.client.get(f"/utilitarios/api/publico/{item['id']}/download")
		self.assertEqual(download.status_code, 200)
		self.assertEqual(download.data, content)

	def test_chunked_upload_requires_login(self):
		res = self.client.post(
			"/utilitarios/api/uploads",
			json={"filename": "manual.pdf", "size": 10},
		)
		self.assertEqual(res.status_code, 401)

	def test_categories_organize_public_listing(self):
		self._login()
		created = self.client.post("/utilitarios/api/categorias", json={"name": "Instaladores"})
		self.assertEqual(created.status_code, 201, created.get_data(as_text=True))
		category = created.get_json()
		self.assertEqual(category["name"], "Instaladores")

		dup = self.client.post("/utilitarios/api/categorias", json={"name": "instaladores"})
		self.assertEqual(dup.status_code, 409)

		upload = self._upload(title="AnyDesk", description="Acesso remoto")
		file_id = upload.get_json()["items"][0]["id"]
		patched = self.client.patch(
			f"/utilitarios/api/{file_id}",
			json={"category_id": category["id"]},
		)
		self.assertEqual(patched.status_code, 200)
		self.assertEqual(patched.get_json()["category_id"], category["id"])
		self.assertEqual(patched.get_json()["category_name"], "Instaladores")

		public = self.client.get(f"/utilitarios/api/publico?category_id={category['id']}")
		self.assertEqual(public.status_code, 200)
		payload = public.get_json()
		self.assertEqual(len(payload["items"]), 1)
		self.assertEqual(payload["categories"][0]["files_count"], 1)

		empty = self.client.get("/utilitarios/api/publico?category_id=none")
		self.assertEqual(empty.get_json()["items"], [])

		removed = self.client.delete(f"/utilitarios/api/categorias/{category['id']}")
		self.assertEqual(removed.status_code, 200)
		self.assertEqual(UtilityCategory.query.count(), 0)
		row = UtilityFile.query.get(file_id)
		self.assertIsNone(row.category_id)

	def test_chunked_upload_keeps_category(self):
		self.app.config["UTILITARIOS_CHUNK_SIZE"] = 4
		self._login()
		cat = self.client.post("/utilitarios/api/categorias", json={"name": "Manuais"}).get_json()
		content = b"ABCDEFGHIJ"
		init = self.client.post(
			"/utilitarios/api/uploads",
			json={
				"filename": "manual.pdf",
				"size": len(content),
				"title": "Manual",
				"mime": "application/pdf",
				"category_id": cat["id"],
			},
		)
		upload_id = init.get_json()["upload_id"]
		for index in range(init.get_json()["total_chunks"]):
			start = index * 4
			self.client.put(
				f"/utilitarios/api/uploads/{upload_id}/chunks/{index}",
				data=content[start:start + 4],
				content_type="application/octet-stream",
			)
		done = self.client.post(f"/utilitarios/api/uploads/{upload_id}/complete")
		self.assertEqual(done.status_code, 201, done.get_data(as_text=True))
		self.assertEqual(done.get_json()["category_id"], cat["id"])
		self.assertEqual(done.get_json()["category_name"], "Manuais")


if __name__ == "__main__":
	unittest.main()
