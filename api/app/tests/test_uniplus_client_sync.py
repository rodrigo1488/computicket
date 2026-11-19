import tempfile
import unittest
from unittest.mock import patch

from flask import Flask, jsonify
from werkzeug.security import generate_password_hash

from app import db, login_manager
from app.blueprints.auth import bp as auth_bp
from app.blueprints.uniplus_api import bp as uniplus_api_bp
from app.models import UniplusClient, User
from app.services.uniplus_client_sync import (
	list_mirrored_clients,
	load_clients,
	sync_uniplus_clients,
	upsert_public_client,
)


def _entidade(uniplus_id, nome, **extra):
	row = {
		"id": uniplus_id,
		"nome": nome,
		"cnpjcpf": extra.get("cnpjcpf") or "",
		"celular": extra.get("celular") or "",
		"email": extra.get("email") or "",
		"endereco": "",
		"numeroendereco": "",
		"extra9": extra.get("extra9"),
		"extra10": extra.get("extra10"),
		"observacao": extra.get("observacao"),
		"inativo": extra.get("inativo") or 0,
	}
	return row


class UniplusClientSyncTest(unittest.TestCase):
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
		self.app.register_blueprint(uniplus_api_bp)
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		db.session.add(User(
			name="Admin",
			email="sync@example.invalid",
			password_hash=generate_password_hash("secret12"),
			role="admin",
			status="1",
		))
		db.session.commit()
		self.client = self.app.test_client()

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()
		self._tmp.cleanup()

	def test_sync_espelha_em_lotes_e_inativa_quem_saiu(self):
		pages = [
			[_entidade(10, "Alfa"), _entidade(20, "Beta", extra9="Mensal")],
			[_entidade(30, "Inativo", inativo=1)],
			[],
		]

		def fake_batch(after_id, limit):
			self.assertGreaterEqual(limit, 50)
			if after_id == 0:
				return pages[0]
			if after_id == 20:
				return pages[1]
			return []

		with patch("app.services.uniplus_client_sync.fetch_entidade_batch", side_effect=fake_batch):
			first = sync_uniplus_clients(batch_size=50)

		self.assertEqual(first["status"], "ok")
		self.assertEqual(first["synced"], 3)
		self.assertEqual(first["batches"], 2)
		self.assertEqual(first["active"], 2)
		listed = list_mirrored_clients()
		self.assertEqual([item["id"] for item in listed], [10, 20])
		self.assertEqual(listed[0]["idclienteuniplus"], 10)
		self.assertNotEqual(UniplusClient.query.filter_by(idclienteuniplus=10).one().id, 10)
		self.assertEqual(listed[1]["contract_type"], "Mensal")

		def second_batch(after_id, limit):
			if after_id == 0:
				return [_entidade(10, "Alfa Atualizada", cnpjcpf="123")]
			return []

		with patch("app.services.uniplus_client_sync.fetch_entidade_batch", side_effect=second_batch):
			second = sync_uniplus_clients()

		self.assertEqual(second["synced"], 1)
		self.assertGreaterEqual(second["inactive_marked"], 1)
		listed = list_mirrored_clients()
		self.assertEqual([item["name"] for item in listed], ["Alfa Atualizada"])
		self.assertEqual(listed[0]["document"], "123")
		beta = UniplusClient.query.filter_by(idclienteuniplus=20).one()
		self.assertTrue(beta.inactive)
		items, source = load_clients("alfa")
		self.assertEqual(source, "mirror")
		self.assertEqual(len(items), 1)

	def test_upsert_manual_entra_na_listagem(self):
		upsert_public_client({
			"id": 77,
			"name": "Padaria",
			"document": "00.000.000/0001-00",
			"phone": "119999",
		})
		items, source = load_clients("padaria")
		self.assertEqual(source, "mirror")
		self.assertEqual(items[0]["idclienteuniplus"], 77)
		self.assertEqual(items[0]["id"], 77)

	def test_api_sync(self):
		self.client.post("/auth/api/login", json={"email": "sync@example.invalid", "password": "secret12"})

		def fake_batch(after_id, limit):
			if after_id == 0:
				return [_entidade(5, "Gama")]
			return []

		with patch("app.services.uniplus_client_sync.fetch_entidade_batch", side_effect=fake_batch):
			res = self.client.post("/api/uniplus/clients/sync", json={})
		self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
		body = res.get_json()
		self.assertEqual(body["status"], "ok")
		self.assertEqual(body["synced"], 1)

		status = self.client.get("/api/uniplus/clients/sync")
		self.assertEqual(status.status_code, 200)
		self.assertEqual(status.get_json()["active"], 1)
		self.assertEqual(status.get_json()["status"], "ok")


if __name__ == "__main__":
	unittest.main()
