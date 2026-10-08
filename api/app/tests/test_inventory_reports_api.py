import unittest
from datetime import datetime

from flask import Flask
from werkzeug.security import generate_password_hash

from app import db, login_manager
from app.blueprints.auth import bp as auth_bp
from app.blueprints.reports import bp as reports_bp
from app.blueprints.web_api import bp as web_api_bp
from app.models import InventoryEvent, InventoryItem, Service, Ticket, TimeEntry, User


class InventoryAndReportRowApiTest(unittest.TestCase):
	def setUp(self):
		self.app = Flask(__name__)
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
		self.app.register_blueprint(reports_bp, url_prefix="/relatorios")
		self.context = self.app.app_context()
		self.context.push()
		db.create_all()
		user = User(
			name="Admin Teste",
			email="inv@example.invalid",
			password_hash=generate_password_hash("secret12"),
			role="admin",
			status="1",
		)
		db.session.add(user)
		db.session.commit()
		self.user_id = user.id
		self.client = self.app.test_client()
		res = self.client.post("/auth/api/login", json={"email": "inv@example.invalid", "password": "secret12"})
		self.assertEqual(res.status_code, 200, res.get_data(as_text=True))

	def tearDown(self):
		db.session.remove()
		db.drop_all()
		self.context.pop()

	def test_inventory_create_requires_description_and_valid_status(self):
		res = self.client.post("/api/web/inventory", json={"title": "Sem descrição"})
		self.assertEqual(res.status_code, 400)
		res = self.client.post("/api/web/inventory", json={"description": "Notebook", "status": "xyz"})
		self.assertEqual(res.status_code, 400)

		res = self.client.post(
			"/api/web/inventory",
			json={"title": "Notebook", "description": "Notebook Dell", "serial_number": "ABC123", "status": "emprestado"},
		)
		self.assertEqual(res.status_code, 201, res.get_data(as_text=True))
		body = res.get_json()
		self.assertEqual(body["status"], "emprestado")
		self.assertEqual(body["status_label"], "Emprestado")
		self.assertTrue(body["public_uuid"])

		default = self.client.post("/api/web/inventory", json={"description": "Mouse"})
		self.assertEqual(default.status_code, 201)
		self.assertEqual(default.get_json()["status"], "disponivel")

	def test_inventory_patch_status_and_delete_removes_events(self):
		created = self.client.post("/api/web/inventory", json={"description": "Monitor"}).get_json()
		item_id = created["id"]

		bad = self.client.patch(f"/api/web/inventory/{item_id}", json={"status": "inexistente"})
		self.assertEqual(bad.status_code, 400)
		ok = self.client.patch(f"/api/web/inventory/{item_id}", json={"status": "vendido"})
		self.assertEqual(ok.status_code, 200, ok.get_data(as_text=True))
		self.assertEqual(ok.get_json()["status"], "vendido")

		db.session.add(InventoryEvent(item_id=item_id, action_type="venda", created_by_id=self.user_id))
		db.session.commit()

		res = self.client.delete(f"/api/web/inventory/{item_id}")
		self.assertEqual(res.status_code, 200)
		self.assertIsNone(db.session.get(InventoryItem, item_id))
		self.assertEqual(InventoryEvent.query.count(), 0)

	def _seed_tickets(self):
		service = Service(name="Suporte", hourly_rate=100.0)
		db.session.add(service)
		db.session.flush()
		ticket = Ticket(
			title="Impressora parada",
			status="fechado",
			external_client_name="Cliente X",
			opened_by_id=self.user_id,
			assigned_to_id=self.user_id,
			service_id=service.id,
			total_cost=150.0,
			# created_at explícito: evita o default que consulta SystemConfig (e faz rollback) durante o flush.
			created_at=datetime.utcnow(),
		)
		ticket.time_entries.append(
			TimeEntry(user_id=self.user_id, hours=1.5, comment="Troca de toner", created_at=datetime.utcnow())
		)
		db.session.add(ticket)
		db.session.commit()
		return service, ticket

	def test_row_detail_for_client_technician_and_service(self):
		service, ticket = self._seed_tickets()

		res = self.client.get(
			"/relatorios/api/row-detail?kind=hours-client&external_client_name=Cliente%20X&name=Cliente%20X"
		)
		self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
		body = res.get_json()
		self.assertEqual(len(body["rows"]), 1)
		self.assertEqual(body["rows"][0][0], ticket.id)
		self.assertEqual(body["rows"][0][5], 1.5)

		res = self.client.get(f"/relatorios/api/row-detail?kind=hours-technician&user_id={self.user_id}")
		self.assertEqual(res.status_code, 200)
		self.assertEqual(res.get_json()["rows"][0][3], "Troca de toner")

		res = self.client.get(f"/relatorios/api/row-detail?kind=tickets-technician&user_id={self.user_id}")
		self.assertEqual(len(res.get_json()["rows"]), 1)

		res = self.client.get(f"/relatorios/api/row-detail?kind=service-performance&service_id={service.id}")
		self.assertEqual(res.get_json()["rows"][0][6], 150.0)

	def test_row_detail_validates_input_and_filters_period(self):
		self._seed_tickets()
		self.assertEqual(self.client.get("/relatorios/api/row-detail?kind=desconhecido").status_code, 400)
		self.assertEqual(self.client.get("/relatorios/api/row-detail?kind=hours-client").status_code, 400)
		self.assertEqual(self.client.get("/relatorios/api/row-detail?kind=hours-technician").status_code, 400)
		self.assertEqual(
			self.client.get("/relatorios/api/row-detail?kind=tickets-technician&user_id=1&start=abc").status_code,
			400,
		)
		res = self.client.get(
			f"/relatorios/api/row-detail?kind=tickets-technician&user_id={self.user_id}&start=2000-01-01&end=2000-01-31"
		)
		self.assertEqual(res.status_code, 200)
		self.assertEqual(res.get_json()["rows"], [])

	def test_row_export_returns_xlsx(self):
		self._seed_tickets()
		res = self.client.get(f"/relatorios/export/row?kind=tickets-technician&user_id={self.user_id}")
		self.assertEqual(res.status_code, 200)
		self.assertIn("spreadsheetml", res.mimetype)
		self.assertEqual(res.data[:2], b"PK")


if __name__ == "__main__":
	unittest.main()
