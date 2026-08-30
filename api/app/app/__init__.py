import sys

# Evita que o Python quebre com UnicodeEncodeError ao imprimir emojis/acentos em consoles Windows
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import os
from flask import Flask, redirect, url_for, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_mail import Mail
from flask_socketio import SocketIO
from pathlib import Path
from dotenv import load_dotenv
from .timezone_utils import format_datetime_brasilia
from .format_utils import format_brl

# Extensões globais
db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "auth.login"
mail = Mail()
socketio = SocketIO()


def create_app() -> Flask:
	# Carrega .env na raiz do projeto (ex.: GEMINI_API_KEY)
	env_path = Path(__file__).resolve().parent.parent / ".env"
	load_dotenv(env_path)

	app = Flask(__name__, instance_relative_config=True, template_folder="../templates", static_folder="../static")

	# Configurações básicas
	if not app.config.get("SECRET_KEY"):
		app.config["SECRET_KEY"] = "dev-secret-key"
	# URI via .env (Postgres). Sem env: fallback SQLite em instance/tickets.sqlite3
	db_uri = os.environ.get("SQLALCHEMY_DATABASE_URI", "").strip()
	if not db_uri:
		db_path = Path(app.instance_path) / "tickets.sqlite3"
		db_path.parent.mkdir(parents=True, exist_ok=True)
		db_uri = f"sqlite:///{db_path}"
	app.config.setdefault("SQLALCHEMY_DATABASE_URI", db_uri)
	app.config.setdefault("SQLALCHEMY_TRACK_MODIFICATIONS", False)
	
	# Configurações de sessão para garantir isolamento entre clientes
	app.config.setdefault("SESSION_COOKIE_HTTPONLY", True)
	app.config.setdefault("SESSION_COOKIE_SECURE", False)  # True em produção com HTTPS
	app.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
	app.config.setdefault("PERMANENT_SESSION_LIFETIME", 3600)  # 1 hora
	
	# Configurações de email
	app.config.setdefault("MAIL_SERVER", "smtp.gmail.com")
	app.config.setdefault("MAIL_PORT", 587)
	app.config.setdefault("MAIL_USE_TLS", True)
	app.config.setdefault("MAIL_USERNAME", "seu-email@gmail.com")
	app.config.setdefault("MAIL_PASSWORD", "sua-senha-app")
	app.config.setdefault("MAIL_DEFAULT_SENDER", "seu-email@gmail.com")

	# Inicializa extensões
	db.init_app(app)
	login_manager.init_app(app)
	mail.init_app(app)
	socketio.init_app(app, cors_allowed_origins="*", logger=True, engineio_logger=True, async_mode='threading')

	@login_manager.unauthorized_handler
	def _unauthorized():
		wants_json = (
			request.is_json
			or request.path.startswith("/auth/api")
			or "/api/" in request.path
			or request.headers.get("X-Requested-With") == "XMLHttpRequest"
			or request.accept_mimetypes.best == "application/json"
		)
		if wants_json:
			return jsonify({"error": "Não autenticado"}), 401
		return redirect(url_for("auth.login"))

	@app.after_request
	def _cors_for_spa(resp):
		origin = request.headers.get("Origin")
		if origin and ("localhost" in origin or "127.0.0.1" in origin):
			resp.headers["Access-Control-Allow-Origin"] = origin
			resp.headers["Access-Control-Allow-Credentials"] = "true"
			resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Requested-With"
			resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
		return resp
	
	# Filtros Jinja2
	@app.template_filter('brasilia_datetime')
	def brasilia_datetime_filter(dt, format_str='%d/%m/%Y %H:%M'):
		return format_datetime_brasilia(dt, format_str)

	app.jinja_env.filters['brl'] = format_brl

	# Importa modelos para criação de tabelas
	from . import models  # noqa: F401

	with app.app_context():
		# O tipo vector precisa existir antes de o metadata criar knowledge_chunk.
		if db.engine.url.get_backend_name() == "postgresql":
			from sqlalchemy import text
			with db.engine.begin() as conn:
				conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
		db.create_all()
		if db.engine.url.get_backend_name() == "postgresql":
			with db.engine.begin() as conn:
				conn.execute(text("ALTER TABLE ticket ADD COLUMN IF NOT EXISTS ps_operation_key VARCHAR(36)"))
				conn.execute(text("ALTER TABLE ticket ADD COLUMN IF NOT EXISTS ps_registration_status VARCHAR(24)"))
				conn.execute(text("ALTER TABLE ticket ADD COLUMN IF NOT EXISTS ps_registration_updated_at TIMESTAMP"))
				conn.execute(text("ALTER TABLE ticket ADD COLUMN IF NOT EXISTS ps_job_id INTEGER"))
			try:
				with db.engine.begin() as conn:
					conn.execute(text(
						"CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ps_number "
						"ON ticket (ps_number) WHERE ps_number IS NOT NULL"
					))
					conn.execute(text(
						"CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ps_operation_key "
						"ON ticket (ps_operation_key) WHERE ps_operation_key IS NOT NULL"
					))
			except Exception as exc:
				app.logger.error("Não foi possível criar índices únicos de PS: %s", exc)
		# Migrações leves SQLite
		try:
			engine = db.get_engine()
			if engine.url.get_backend_name() == "sqlite":
				with engine.connect() as conn:
					# ticket: colunas
					t_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(ticket)").fetchall()]
					if "external_client_id" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN external_client_id INTEGER")
					
					# user: colunas
					u_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(user)").fetchall()]
					if "whatsapp_message_template" not in u_cols:
						conn.exec_driver_sql("ALTER TABLE user ADD COLUMN whatsapp_message_template TEXT")
					if "team" not in u_cols:
						conn.exec_driver_sql("ALTER TABLE user ADD COLUMN team VARCHAR(50) DEFAULT 'Equipe 1'")
					if "avatar_path" not in u_cols:
						conn.exec_driver_sql("ALTER TABLE user ADD COLUMN avatar_path VARCHAR(500)")
					if "external_client_name" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN external_client_name VARCHAR(200)")
					if "total_cost" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN total_cost FLOAT DEFAULT 0.0")
					if "in_progress_started_at" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN in_progress_started_at DATETIME")
					# service: coluna
					s_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(service)").fetchall()]
					if "hourly_rate" not in s_cols:
						conn.exec_driver_sql("ALTER TABLE service ADD COLUMN hourly_rate FLOAT DEFAULT 0.0")
					# ticket: colunas de PS
					if "ps_printed" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_printed BOOLEAN DEFAULT 0")
					if "ps_number" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_number VARCHAR(50)")
					if "ps_file" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_file VARCHAR(200)")
					if "ps_operation_key" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_operation_key VARCHAR(36)")
					if "ps_registration_status" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_registration_status VARCHAR(24)")
					if "ps_registration_updated_at" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_registration_updated_at DATETIME")
					if "ps_job_id" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN ps_job_id INTEGER")
					try:
						conn.exec_driver_sql(
							"CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ps_number "
							"ON ticket (ps_number) WHERE ps_number IS NOT NULL"
						)
						conn.exec_driver_sql(
							"CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ps_operation_key "
							"ON ticket (ps_operation_key) WHERE ps_operation_key IS NOT NULL"
						)
					except Exception as exc:
						app.logger.error("Não foi possível criar índices únicos de PS: %s", exc)
					if "parent_id" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN parent_id INTEGER REFERENCES ticket(id)")
					if "dav_id" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN dav_id INTEGER")
					if "dav_codigo" not in t_cols:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN dav_codigo INTEGER")
					
					# time_entry: colunas de início e fim
					te_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(time_entry)").fetchall()]
					if "start_time" not in te_cols:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN start_time DATETIME")
					if "end_time" not in te_cols:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN end_time DATETIME")
					
					# shift_swap: colunas adicionais
					try:
						ss_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(shift_swap)").fetchall()]
						if ss_cols:
							if "status" not in ss_cols:
								conn.exec_driver_sql("ALTER TABLE shift_swap ADD COLUMN status VARCHAR(20) DEFAULT 'pending'")
							if "requested_by_id" not in ss_cols:
								conn.exec_driver_sql("ALTER TABLE shift_swap ADD COLUMN requested_by_id INTEGER")
					except Exception as e:
						print(f"⚠️ Erro ao verificar colunas de shift_swap: {e}")
					
					# Verificar se tabela service_order existe, se não, criar
					tables = [r[0] for r in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
					if "service_order" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE service_order (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								codigo VARCHAR(50) NOT NULL UNIQUE,
								client_id INTEGER,
								client_name VARCHAR(200) NOT NULL,
								client_document VARCHAR(30),
								client_phone VARCHAR(50),
								client_address VARCHAR(200),
								client_address_number VARCHAR(20),
								equipment VARCHAR(200),
								problem_description TEXT,
								service_executed TEXT NOT NULL,
								observations TEXT,
								value FLOAT DEFAULT 0.0,
								ps_number VARCHAR(50),
								ps_generated BOOLEAN DEFAULT 0,
								delivery_receipt_generated BOOLEAN DEFAULT 0,
								status INTEGER NOT NULL,
								no_charge BOOLEAN DEFAULT 0,
								has_contract BOOLEAN DEFAULT 0,
								opening_date DATETIME,
								completion_date DATETIME,
								technician_id INTEGER,
								technician_name VARCHAR(120) NOT NULL,
								ps_file VARCHAR(200),
								delivery_file VARCHAR(200),
								FOREIGN KEY (technician_id) REFERENCES user (id)
							)
						""")
					
					# Verificar se coluna solicitante existe na tabela ticket, se não, adicionar
					columns = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(ticket)").fetchall()]
					if "solicitante" not in columns:
						conn.exec_driver_sql("ALTER TABLE ticket ADD COLUMN solicitante VARCHAR(200)")
					
					# Verificar se coluna no_charge existe na tabela time_entry, se não, adicionar
					columns = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(time_entry)").fetchall()]
					if "no_charge" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN no_charge BOOLEAN DEFAULT 0")
					
					# Verificar se colunas de geolocalização existem na tabela time_entry, se não, adicionar
					if "latitude" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN latitude FLOAT")
					if "longitude" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN longitude FLOAT")
					if "address" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN address VARCHAR(500)")
					if "accuracy" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN accuracy FLOAT")
					if "signature_data" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN signature_data TEXT")
					if "signature_file_path" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN signature_file_path VARCHAR(500)")
					if "signature_timestamp" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN signature_timestamp DATETIME")
					if "created_at" not in columns:
						conn.exec_driver_sql("ALTER TABLE time_entry ADD COLUMN created_at DATETIME")
					
					# Verificar se coluna reminder_sent existe na tabela appointment, se não, adicionar
					appointment_columns = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(appointment)").fetchall()]
					if "reminder_sent" not in appointment_columns:
						conn.exec_driver_sql("ALTER TABLE appointment ADD COLUMN reminder_sent BOOLEAN DEFAULT 0")
					
					# budget: colunas do builder de orçamentos
					budget_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(budget)").fetchall()]
					if budget_cols:
						if "public_token" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN public_token VARCHAR(64)")
							conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_budget_public_token ON budget (public_token)")
						if "valid_until" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN valid_until DATE")
						if "theme_id" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN theme_id INTEGER REFERENCES budget_theme(id)")
						if "show_logo" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN show_logo BOOLEAN DEFAULT 1")
						if "discount" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN discount FLOAT DEFAULT 0.0")
						if "payment_terms" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN payment_terms TEXT")
						if "responded_at" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN responded_at DATETIME")
						if "internal_notes" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN internal_notes TEXT")
						if "signer_name" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN signer_name VARCHAR(200)")
						if "signature_data" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN signature_data TEXT")
						if "signature_file_path" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN signature_file_path VARCHAR(500)")
						if "signature_timestamp" not in budget_cols:
							conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN signature_timestamp DATETIME")

					# budget_theme: coluna de cor do título
					theme_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(budget_theme)").fetchall()]
					if theme_cols and "title_color" not in theme_cols:
						conn.exec_driver_sql("ALTER TABLE budget_theme ADD COLUMN title_color VARCHAR(7) DEFAULT '#ffffff'")

					# budget_item: colunas de produto, serviço e observações
					item_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(budget_item)").fetchall()]
					if item_cols:
						if "item_type" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN item_type VARCHAR(20) DEFAULT 'manual'")
						if "product_id" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN product_id INTEGER")
						if "service_id" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN service_id INTEGER REFERENCES service(id)")
						if "codigo" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN codigo VARCHAR(50)")
						if "unit_of_measure" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN unit_of_measure VARCHAR(20)")
						if "observations" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN observations TEXT")
						if "is_recurring" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN is_recurring BOOLEAN DEFAULT 0")
						if "recurrence_period" not in item_cols:
							conn.exec_driver_sql("ALTER TABLE budget_item ADD COLUMN recurrence_period VARCHAR(20)")
					
					# Verificar se tabela technician_location existe, se não, criar
					technician_location_exists = conn.exec_driver_sql(
						"SELECT name FROM sqlite_master WHERE type='table' AND name='technician_location'"
					).fetchone()
					
					if not technician_location_exists:
						conn.exec_driver_sql("""
							CREATE TABLE technician_location (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								user_id INTEGER NOT NULL,
								latitude FLOAT NOT NULL,
								longitude FLOAT NOT NULL,
								address VARCHAR(500),
								accuracy FLOAT,
								is_online BOOLEAN DEFAULT 1,
								is_tracking BOOLEAN DEFAULT 1,
								last_seen DATETIME,
								created_at DATETIME,
								FOREIGN KEY (user_id) REFERENCES user (id)
							)
						""")
						print("✅ Tabela technician_location criada com sucesso!")
					
					# Verificar se tabela contract_service existe, se não, criar
					tables = [r[0] for r in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
					if "contract_service" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE contract_service (
								contract_name VARCHAR(120) NOT NULL,
								service_id INTEGER NOT NULL,
								PRIMARY KEY (contract_name, service_id),
								FOREIGN KEY (service_id) REFERENCES service (id)
							)
						""")
					
					# Verificar se tabelas do help desk existem, se não, criar
					if "help_desk_session" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE help_desk_session (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								session_id VARCHAR(100) NOT NULL UNIQUE,
								client_email VARCHAR(120) NOT NULL,
								client_name VARCHAR(200) NOT NULL,
								client_id INTEGER,
								title VARCHAR(200) NOT NULL,
								description TEXT NOT NULL,
								status VARCHAR(20) DEFAULT 'waiting',
								created_at DATETIME,
								assigned_to_id INTEGER,
								assigned_at DATETIME,
								closed_at DATETIME,
								ticket_id INTEGER,
								FOREIGN KEY (assigned_to_id) REFERENCES user (id),
								FOREIGN KEY (ticket_id) REFERENCES ticket (id)
							)
						""")
					
					if "help_desk_message" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE help_desk_message (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								session_id INTEGER NOT NULL,
								message TEXT NOT NULL,
								sender_type VARCHAR(20) NOT NULL,
								sender_id INTEGER,
								sender_name VARCHAR(200) NOT NULL,
								created_at DATETIME,
								read_at DATETIME,
								FOREIGN KEY (session_id) REFERENCES help_desk_session (id),
								FOREIGN KEY (sender_id) REFERENCES user (id)
							)
						""")
					
					# Verificar se tabela password_vault existe, se não, criar
					if "password_vault" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE password_vault (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								client_id INTEGER NULL,
								external_client_id INTEGER NULL,
								external_client_name VARCHAR(200) NULL,
								machine_name VARCHAR(200) NOT NULL,
								anydesk_code VARCHAR(50) NULL,
								password VARCHAR(500) NOT NULL,
								description TEXT NULL,
								created_at DATETIME,
								updated_at DATETIME,
								created_by_id INTEGER NOT NULL,
								FOREIGN KEY (client_id) REFERENCES client (id),
								FOREIGN KEY (created_by_id) REFERENCES user (id)
							)
						""")
					else:
						# Verificar se as colunas de cliente externo existem, se não, adicionar
						pv_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(password_vault)").fetchall()]
						if "external_client_id" not in pv_cols:
							conn.exec_driver_sql("ALTER TABLE password_vault ADD COLUMN external_client_id INTEGER")
						if "external_client_name" not in pv_cols:
							conn.exec_driver_sql("ALTER TABLE password_vault ADD COLUMN external_client_name VARCHAR(200)")
						
						# Verificar se client_id é nullable - se não for, recriar a tabela
						client_id_info = [r for r in pv_cols if r[1] == 'client_id']
						if client_id_info and client_id_info[0][3] == 1:  # 1 = NOT NULL, 0 = NULL
							print("DEBUG: Recriando tabela password_vault para tornar client_id nullable")
							# Backup dos dados existentes
							existing_data = conn.exec_driver_sql("SELECT * FROM password_vault").fetchall()
							
							# Dropar a tabela antiga
							conn.exec_driver_sql("DROP TABLE password_vault")
							
							# Recriar com a estrutura correta
							conn.exec_driver_sql("""
								CREATE TABLE password_vault (
									id INTEGER PRIMARY KEY AUTOINCREMENT,
									client_id INTEGER NULL,
									external_client_id INTEGER NULL,
									external_client_name VARCHAR(200) NULL,
									machine_name VARCHAR(200) NOT NULL,
									anydesk_code VARCHAR(50) NULL,
									password VARCHAR(500) NOT NULL,
									description TEXT NULL,
									created_at DATETIME,
									updated_at DATETIME,
									created_by_id INTEGER NOT NULL,
									FOREIGN KEY (client_id) REFERENCES client (id),
									FOREIGN KEY (created_by_id) REFERENCES user (id)
								)
							""")
							
							# Restaurar os dados
							for row in existing_data:
								conn.exec_driver_sql("""
									INSERT INTO password_vault 
									(id, client_id, external_client_id, external_client_name, machine_name, 
									 anydesk_code, password, description, created_at, updated_at, created_by_id)
									VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
								""", row)
					
					# Verificar se tabelas do banco de conhecimentos existem, se não, criar
					if "knowledge_category" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE knowledge_category (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								name VARCHAR(100) NOT NULL UNIQUE,
								description TEXT,
								icon VARCHAR(50) DEFAULT 'fas fa-folder',
								color VARCHAR(20) DEFAULT '#3B82F6',
								created_at DATETIME,
								updated_at DATETIME,
								created_by_id INTEGER NOT NULL,
								FOREIGN KEY (created_by_id) REFERENCES user (id)
							)
						""")
					
					if "knowledge_article" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE knowledge_article (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								title VARCHAR(200) NOT NULL,
								content TEXT NOT NULL,
								summary TEXT,
								tags VARCHAR(500),
								category_id INTEGER NOT NULL,
								status VARCHAR(20) DEFAULT 'published',
								views_count INTEGER DEFAULT 0,
								is_featured BOOLEAN DEFAULT 0,
								created_at DATETIME,
								updated_at DATETIME,
								created_by_id INTEGER NOT NULL,
								updated_by_id INTEGER,
								FOREIGN KEY (category_id) REFERENCES knowledge_category (id),
								FOREIGN KEY (created_by_id) REFERENCES user (id),
								FOREIGN KEY (updated_by_id) REFERENCES user (id)
							)
						""")
					
					if "knowledge_attachment" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE knowledge_attachment (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								article_id INTEGER NOT NULL,
								filename VARCHAR(255) NOT NULL,
								original_filename VARCHAR(255) NOT NULL,
								file_path VARCHAR(500) NOT NULL,
								file_size INTEGER NOT NULL,
								file_type VARCHAR(100) NOT NULL,
								description TEXT,
								download_count INTEGER DEFAULT 0,
								created_at DATETIME,
								created_by_id INTEGER NOT NULL,
								FOREIGN KEY (article_id) REFERENCES knowledge_article (id),
								FOREIGN KEY (created_by_id) REFERENCES user (id)
							)
						""")
					
					# Verificar se tabela budget existe, se não, criar
					if "budget" not in tables:
						conn.exec_driver_sql("""
							CREATE TABLE budget (
								id INTEGER PRIMARY KEY AUTOINCREMENT,
								title VARCHAR(200) NOT NULL,
								description TEXT,
								client_id INTEGER NULL,
								external_client_id INTEGER NULL,
								external_client_name VARCHAR(200) NULL,
								original_filename VARCHAR(255) NULL,
								stored_filename VARCHAR(255) NULL,
								file_path VARCHAR(500) NULL,
								file_size INTEGER NULL,
								file_type VARCHAR(100) NULL,
								status VARCHAR(50) DEFAULT 'draft',
								created_at DATETIME,
								updated_at DATETIME,
								created_by_id INTEGER NOT NULL,
								FOREIGN KEY (client_id) REFERENCES client (id),
								FOREIGN KEY (created_by_id) REFERENCES user (id)
							)
						""")
		except Exception:
			pass

	# Migração SQLite→Postgres só precisa do schema (models + create_all).
	if (os.environ.get("COMPUTICKET_SCHEMA_ONLY") or "").strip().lower() in {"1", "true", "yes", "on"}:
		return app

	# Blueprints
	from .blueprints.auth import bp as auth_bp
	from .blueprints.utils import bp as utils_bp
	from .blueprints.clients import bp as clients_bp
	from .blueprints.users import bp as users_bp
	from .blueprints.services import bp as services_bp
	from .blueprints.contracts import bp as contracts_bp
	from .blueprints.tickets import bp as tickets_bp
	from .blueprints.reports import bp as reports_bp
	from .blueprints.catalog import bp as catalog_bp
	from .blueprints.dashboard import bp as dashboard_bp
	from .blueprints.printer import service_provision_routes as printer_bp
	from .blueprints.service_orders import bp as service_orders_bp
	from .blueprints.config import bp as config_bp
	from .blueprints.ps import bp as ps_bp
	from .blueprints.helpdesk import helpdesk_bp
	from .blueprints import helpdesk_socketio  # Importar eventos WebSocket
	from .blueprints import budget_socketio  # Presença Co-op de orçamentos  # noqa: F401
	from .blueprints import uniplus_agent_ws  # Agente Uniplus namespace /uniplus  # noqa: F401
	from .blueprints.password_vault import password_vault
	from .blueprints.knowledge_base import knowledge_base
	from .blueprints.budget import budget
	from .blueprints.inventory import bp as inventory_bp
	from .blueprints.agenda import agenda_bp
	from .blueprints.compuchat import bp as compuchat_bp
	from .blueprints.web_api import bp as web_api_bp
	from .blueprints.uniplus_api import bp as uniplus_api_bp
	from .blueprints.remote_monitor import bp as remote_monitor_bp
	from .blueprints import remote_monitor_agent_ws  # noqa: F401

	app.register_blueprint(auth_bp)
	app.register_blueprint(web_api_bp)
	app.register_blueprint(uniplus_api_bp)
	app.register_blueprint(remote_monitor_bp)
	app.register_blueprint(utils_bp)
	app.register_blueprint(clients_bp, url_prefix="/clientes")
	app.register_blueprint(users_bp, url_prefix="/usuarios")
	app.register_blueprint(services_bp, url_prefix="/servicos")
	app.register_blueprint(contracts_bp, url_prefix="/contratos")
	app.register_blueprint(tickets_bp, url_prefix="/tickets")
	app.register_blueprint(reports_bp, url_prefix="/relatorios")
	app.register_blueprint(dashboard_bp)
	app.register_blueprint(printer_bp)
	app.register_blueprint(service_orders_bp, url_prefix="/ordens-servico")
	app.register_blueprint(config_bp, url_prefix="/configuracoes")
	app.register_blueprint(ps_bp, url_prefix="/ps")
	app.register_blueprint(helpdesk_bp)
	app.register_blueprint(password_vault, url_prefix="/password-vault")
	app.register_blueprint(knowledge_base, url_prefix="/knowledge-base")
	app.register_blueprint(budget, url_prefix="/orcamentos")
	app.register_blueprint(inventory_bp, url_prefix="/inventario")
	app.register_blueprint(agenda_bp, url_prefix="/agenda")
	app.register_blueprint(compuchat_bp)
	# Catálogo público
	app.register_blueprint(catalog_bp, url_prefix="/catalogo")
	
	# Garantir coluna support_included / tabelas de planos (dialeto-agnóstico)
	try:
		with app.app_context():
			from .schema_utils import ensure_column, ensure_tables_from_metadata
			dialect = db.session.get_bind().dialect.name if db.session else ""
			default = "FALSE" if dialect == "postgresql" else "0"
			if ensure_column("plan", "support_included", f"BOOLEAN DEFAULT {default}"):
				print("✅ Coluna 'support_included' adicionada à tabela plan")
			from .models import PlanAdditional, CustomPlan, CustomPlanItem  # noqa: F401
			ensure_tables_from_metadata(["plan_additional", "custom_plan", "custom_plan_item"])
	except Exception as _e:
		print(f"⚠️ Não foi possível verificar/adicionar schema de planos: {_e}")

	# Pesquisa de satisfação do Help Desk (SQLite e PostgreSQL).
	try:
		with app.app_context():
			from .schema_utils import ensure_column, ensure_tables_from_metadata
			ensure_tables_from_metadata(["helpdesk_rating"])
			ensure_column("helpdesk_rating", "sent_at", "TIMESTAMP")
	except Exception as _rating_schema_error:
		app.logger.warning("Não foi possível garantir o schema de avaliações: %s", _rating_schema_error)

	# Vínculo contato WhatsApp ↔ cliente Unico (SQLite e PostgreSQL).
	try:
		with app.app_context():
			from .models import HelpDeskContactClientLink  # noqa: F401
			from .schema_utils import ensure_tables_from_metadata
			ensure_tables_from_metadata(["helpdesk_contact_client_link"])
	except Exception as _contact_link_schema_error:
		app.logger.warning(
			"Não foi possível garantir o schema de vínculo contato↔cliente: %s",
			_contact_link_schema_error,
		)

	# Tabelas do monitoramento remoto (SQLite e PostgreSQL).
	try:
		with app.app_context():
			from .schema_utils import ensure_tables_from_metadata
			ensure_tables_from_metadata([
				"remote_agent",
				"remote_agent_enrollment",
				"remote_agent_snapshot",
				"remote_agent_sample",
				"remote_agent_alert",
				"remote_agent_command",
				"remote_file_transfer",
			])
	except Exception as _remote_schema_error:
		app.logger.warning("Não foi possível garantir o schema de monitoramento remoto: %s", _remote_schema_error)
	
	# Registrar blueprint de planos
	from app.blueprints.plans import plans_bp
	app.register_blueprint(plans_bp)
	
	# Registrar blueprint de monitoramento
	from app.blueprints.monitoring import bp as monitoring_bp
	app.register_blueprint(monitoring_bp)
	
	# Registrar blueprint de notificações
	from app.blueprints.notifications import notifications_bp
	app.register_blueprint(notifications_bp)
	with app.app_context():
		from app.notification_service import ensure_vapid_keys
		ensure_vapid_keys()
	
	# Inicializar sistema de monitoramento de localização
	from app.websocket_monitoring import init_location_monitoring
	init_location_monitoring()
	
	# Inicializar scheduler de lembretes
	from app.scheduler import start_scheduler
	start_scheduler()

	# Manutenção do RMM usa este app já inicializado (sem create_app recursivo).
	from app.remote_monitor_service import start_remote_monitor_maintenance
	start_remote_monitor_maintenance(app)

	# Eventos pós-commit e comando `flask rag-reindex`.
	from .rag_hooks import register_rag
	register_rag(app)

	@app.route("/")
	def index():
		return redirect(url_for("dashboard.index"))
	
	# Rota para servir arquivos da pasta image
	@app.route("/image/<filename>")
	def serve_image(filename):
		from flask import send_from_directory
		import os
		image_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'image')
		return send_from_directory(image_dir, filename)

	# Garantir blueprint de inventário (evita BuildError em url_for se o registro acima não vingou)
	try:
		if "inventory.index" not in app.view_functions:
			from .blueprints.inventory import bp as _inventory_bp_fallback
			app.register_blueprint(_inventory_bp_fallback, url_prefix="/inventario")
	except Exception as _inv_err:
		app.logger.warning("Blueprint inventory (fallback): %s", _inv_err)

	return app
