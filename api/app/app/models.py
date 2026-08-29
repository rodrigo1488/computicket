import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from flask_login import UserMixin
from . import db, login_manager
from .timezone_utils import get_brasilia_now, brasilia_to_utc

# Tabela de associação contrato-serviço (para contratos do PostgreSQL)
contract_service = db.Table(
	"contract_service",
	db.Column("contract_name", db.String(120), primary_key=True),  # Nome do contrato do PostgreSQL
	db.Column("service_id", db.Integer, db.ForeignKey("service.id"), primary_key=True),
)


class Client(db.Model):
	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(120), nullable=False)
	phone = db.Column(db.String(50))
	document = db.Column(db.String(30), unique=True)
	contract_type = db.Column(db.String(50))  # ex: mensal, avulso, etc
	contracts = db.relationship("Contract", backref="client", lazy=True)
	tickets = db.relationship("Ticket", backref="client", lazy=True)

	def __repr__(self) -> str:
		return f"<Client {self.name}>"


class User(UserMixin, db.Model):
	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(120), nullable=False)
	email = db.Column(db.String(120), unique=True, nullable=False)
	password_hash = db.Column(db.String(255), nullable=False)
	status = db.Column(db.String(20), nullable=False, default="1")  # 1=ativo, 0=inativo
	role = db.Column(db.String(30), nullable=False, default="tecnico")  # admin, tecnico, viewer
	opened_tickets = db.relationship("Ticket", backref="opened_by_user", lazy=True, foreign_keys="Ticket.opened_by_id")
	assigned_tickets = db.relationship("Ticket", backref="assigned_to_user", lazy=True, foreign_keys="Ticket.assigned_to_id")
	time_entries = db.relationship("TimeEntry", backref="user", lazy=True)
	whatsapp_message_template = db.Column(db.Text, nullable=True)
	team = db.Column(db.String(50), nullable=True, default="Equipe 1")
	avatar_path = db.Column(db.String(500), nullable=True)

	@property
	def is_active(self) -> bool:  # Override do UserMixin
		return self.status == "1"

	def has_role(self, role: str) -> bool:
		user_role = (self.role or "").strip().lower()
		target_role = (role or "").strip().lower()
		if user_role in {"administrador", "administrator"}:
			user_role = "admin"
		if target_role in {"administrador", "administrator"}:
			target_role = "admin"
		return user_role == target_role

	def __repr__(self) -> str:
		return f"<User {self.email} ({self.role}) status={self.status}>"


@login_manager.user_loader
def load_user(user_id: str) -> Optional["User"]:
	return User.query.get(int(user_id))


class Contract(db.Model):
	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(120), nullable=False)
	client_id = db.Column(db.Integer, db.ForeignKey("client.id"), nullable=False)
	tickets = db.relationship("Ticket", backref="contract", lazy=True)

	def __repr__(self) -> str:
		return f"<Contract {self.name} / client={self.client_id}>"


class PostgreSQLContract:
	"""Classe para representar contratos do PostgreSQL (não é uma tabela do SQLite)"""
	def __init__(self, name: str, services: list = None):
		self.name = name
		self.services = services or []
	
	def __repr__(self) -> str:
		return f"<PostgreSQLContract {self.name}>"


class ClientContract(db.Model):
	"""Detalhes do contrato de um cliente específico (camada sobre extra9/extra11 do PostgreSQL)"""
	__tablename__ = "client_contract"
	__table_args__ = (
		db.UniqueConstraint("contract_name", "external_client_id", name="uq_client_contract"),
	)

	id = db.Column(db.Integer, primary_key=True)
	contract_name = db.Column(db.String(120), nullable=False, index=True)
	external_client_id = db.Column(db.Integer, nullable=False, index=True)
	external_client_name = db.Column(db.String(200), nullable=True)

	product = db.Column(db.String(200), nullable=True)  # produto contratado (texto livre)
	start_date = db.Column(db.Date, nullable=True)  # data de contratação
	end_date = db.Column(db.Date, nullable=True)  # data de vencimento
	value = db.Column(db.Float, nullable=True)  # valor do contrato
	status = db.Column(db.String(20), nullable=False, default="ativo")  # ativo, cancelado
	notes = db.Column(db.Text, nullable=True)

	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)

	@property
	def is_expired(self) -> bool:
		if self.status != "ativo" or not self.end_date:
			return False
		return self.end_date < get_brasilia_now().date()

	@property
	def days_to_expire(self) -> Optional[int]:
		"""Dias até o vencimento (negativo se vencido); None se sem data ou não ativo"""
		if self.status != "ativo" or not self.end_date:
			return None
		return (self.end_date - get_brasilia_now().date()).days

	@property
	def display_status(self) -> str:
		"""Status para exibição: cancelado, vencido, vencendo (<=30d) ou ativo"""
		if self.status == "cancelado":
			return "cancelado"
		days = self.days_to_expire
		if days is None:
			return "ativo"
		if days < 0:
			return "vencido"
		if days <= 30:
			return "vencendo"
		return "ativo"

	def to_dict(self) -> Dict[str, Any]:
		return {
			"id": self.id,
			"contract_name": self.contract_name,
			"external_client_id": self.external_client_id,
			"external_client_name": self.external_client_name,
			"product": self.product or "",
			"start_date": self.start_date.strftime("%Y-%m-%d") if self.start_date else "",
			"end_date": self.end_date.strftime("%Y-%m-%d") if self.end_date else "",
			"start_date_br": self.start_date.strftime("%d/%m/%Y") if self.start_date else "",
			"end_date_br": self.end_date.strftime("%d/%m/%Y") if self.end_date else "",
			"value": self.value,
			"status": self.status,
			"display_status": self.display_status,
			"days_to_expire": self.days_to_expire,
			"notes": self.notes or "",
		}

	def __repr__(self) -> str:
		return f"<ClientContract {self.contract_name} / client={self.external_client_id}>"


class Service(db.Model):
	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(120), nullable=False, unique=True)
	description = db.Column(db.Text)
	hourly_rate = db.Column(db.Float, default=0.0)  # valor hora técnica
	tickets = db.relationship("Ticket", backref="service", lazy=True)

	def __repr__(self) -> str:
		return f"<Service {self.name}>"


class Ticket(db.Model):
	id = db.Column(db.Integer, primary_key=True)
	title = db.Column(db.String(200), nullable=False)
	description = db.Column(db.Text)
	status = db.Column(db.String(20), default="aberto")  # aberto, em_andamento, fechado
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
	closed_at = db.Column(db.DateTime)
	in_progress_started_at = db.Column(db.DateTime)

	client_id = db.Column(db.Integer, db.ForeignKey("client.id"), nullable=True)
	# Campos para cliente externo (Postgres)
	external_client_id = db.Column(db.Integer, nullable=True)
	external_client_name = db.Column(db.String(200), nullable=True)
	solicitante = db.Column(db.String(200), nullable=True)  # Nome da pessoa que solicitou o serviço

	contract_id = db.Column(db.Integer, db.ForeignKey("contract.id"), nullable=True)
	service_id = db.Column(db.Integer, db.ForeignKey("service.id"), nullable=True)

	opened_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
	assigned_to_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)

	total_cost = db.Column(db.Float, default=0.0)
	ps_printed = db.Column(db.Boolean, default=False)  # Marca se a PS já foi impressa
	ps_number = db.Column(db.String(50), nullable=True)  # Número da PS gerada
	ps_file = db.Column(db.String(200), nullable=True)  # Nome do arquivo PDF gerado
	visto = db.Column(db.Boolean, default=False)  # Marca se o ticket foi visualizado pelo usuário
	dav_id = db.Column(db.Integer, nullable=True)
	dav_codigo = db.Column(db.Integer, nullable=True)
	
	# Relacionamento pai/filho para continuação de atendimento
	parent_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=True)
	children = db.relationship("Ticket", backref=db.backref("parent", remote_side=[id]), lazy=True)
	
	time_entries = db.relationship("TimeEntry", backref="ticket", lazy=True, cascade="all, delete-orphan")
	products = db.relationship(
		"TicketProduct",
		backref="ticket",
		lazy=True,
		cascade="all, delete-orphan",
		order_by="TicketProduct.id",
	)
	addons = db.relationship(
		"TicketAddon",
		backref="ticket",
		lazy=True,
		cascade="all, delete-orphan",
		order_by="TicketAddon.id",
	)

	def total_hours(self) -> float:
		return float(sum(entry.hours for entry in self.time_entries))

	def formatted_total_hours(self) -> str:
		"""Formata o total de horas de forma legível (ex: 1h 20m, 45min)"""
		total = self.total_hours()
		if total < 1:
			minutes = int(total * 60)
			return f"{minutes}min"
		else:
			hours = int(total)
			minutes = int((total - hours) * 60)
			if minutes == 0:
				return f"{hours}h"
			else:
				return f"{hours}h {minutes}m"

	def display_client_name(self) -> str:
		if self.external_client_name:
			return self.external_client_name
		return self.client.name if self.client else ""

	def products_total(self) -> float:
		return float(sum((p.preco or 0.0) * (p.quantidade or 0.0) for p in self.products))

	def resolved_ps_filename(self) -> str | None:
		"""Nome do PDF da PS (salvo ou inferido para tickets antigos)."""
		if self.ps_file:
			return self.ps_file
		if not self.ps_printed:
			return None
		ps_dir = Path(__file__).resolve().parent.parent / "ps" / "ps-do-dia"
		candidates: list[str] = []
		if self.products:
			candidates.append(f"ps-recibo-{self.id}.pdf")
		if self.ps_number:
			candidates.append(f"{self.ps_number.replace('/', '_')}.pdf")
		for name in candidates:
			if (ps_dir / name).exists():
				return name
		# Se não encontrar em ps-do-dia, buscar em qualquer subpasta de ps/
		ps_root = Path(__file__).resolve().parent.parent / "ps"
		for name in candidates:
			for path in ps_root.rglob(name):
				if path.is_file():
					return name
		return candidates[0] if candidates else None

	def __repr__(self) -> str:
		return f"<Ticket {self.id}: {self.title} ({self.status})>"


class TicketProduct(db.Model):
	id = db.Column(db.Integer, primary_key=True)
	ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=False)
	product_id = db.Column(db.Integer, nullable=False)
	codigo = db.Column(db.String(50))
	nome = db.Column(db.String(200), nullable=False)
	unidademedida = db.Column(db.String(20))
	preco = db.Column(db.Float, default=0.0)
	quantidade = db.Column(db.Float, default=1.0)
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
	dav_id = db.Column(db.Integer, nullable=True)
	dav_codigo = db.Column(db.Integer, nullable=True)

	def to_dict(self) -> dict:
		return {
			"id": self.product_id,
			"codigo": self.codigo,
			"nome": self.nome,
			"unidademedida": self.unidademedida,
			"preco": self.preco,
			"quantidade": self.quantidade,
			"dav_id": self.dav_id,
			"dav_codigo": self.dav_codigo,
		}

	def __repr__(self) -> str:
		return f"<TicketProduct ticket={self.ticket_id} produto={self.product_id}>"


class TicketAddon(db.Model):
	"""Serviço adicional de texto livre (layout Figma), separado de TicketProduct/DAV."""
	__tablename__ = "ticket_addon"

	id = db.Column(db.Integer, primary_key=True)
	ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=False)
	description = db.Column(db.String(255), nullable=False)
	value = db.Column(db.Float, default=0.0)
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))

	def to_dict(self) -> dict:
		return {
			"id": self.id,
			"ticket_id": self.ticket_id,
			"description": self.description,
			"value": float(self.value or 0),
		}

	def __repr__(self) -> str:
		return f"<TicketAddon ticket={self.ticket_id} {self.description}>"


class UserAvailability(db.Model):
	"""Horários de atendimento definidos pelo admin (chips no perfil)."""
	__tablename__ = "user_availability"

	id = db.Column(db.Integer, primary_key=True)
	user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
	hour = db.Column(db.String(5), nullable=False)

	user = db.relationship("User", backref=db.backref("availability_slots", lazy=True, cascade="all, delete-orphan"))

	def __repr__(self) -> str:
		return f"<UserAvailability user={self.user_id} {self.hour}>"


class TimeEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    hours = db.Column(db.Float, nullable=False)
    comment = db.Column(db.Text)
    start_time = db.Column(db.DateTime, nullable=True)  # Data/hora de início do apontamento
    end_time = db.Column(db.DateTime, nullable=True)    # Data/hora de fim do apontamento
    no_charge = db.Column(db.Boolean, default=False)    # Se True, não gera cobrança (serviço contemplado por contrato)
    # Campos de geolocalização
    latitude = db.Column(db.Float, nullable=True)       # Latitude da localização
    longitude = db.Column(db.Float, nullable=True)      # Longitude da localização
    address = db.Column(db.String(500), nullable=True)  # Endereço formatado da localização
    accuracy = db.Column(db.Float, nullable=True)       # Precisão da localização em metros
    # Campos de assinatura digital
    signature_data = db.Column(db.Text, nullable=True)  # Dados da assinatura em base64 (mantido para compatibilidade)
    signature_file_path = db.Column(db.String(500), nullable=True)  # Caminho do arquivo de assinatura
    signature_timestamp = db.Column(db.DateTime, nullable=True)  # Timestamp da assinatura
    created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))

    def formatted_hours(self) -> str:
        """Formata as horas de forma legível (ex: 1h 20m, 45min)"""
        if self.hours < 1:
            minutes = int(self.hours * 60)
            return f"{minutes}min"
        else:
            hours = int(self.hours)
            minutes = int((self.hours - hours) * 60)
            if minutes == 0:
                return f"{hours}h"
            else:
                return f"{hours}h {minutes}m"

    def formatted_start_time(self) -> str:
        """Formata a data/hora de início"""
        if self.start_time:
            from .timezone_utils import format_datetime_brasilia
            return format_datetime_brasilia(self.start_time)
        return "—"

    def formatted_end_time(self) -> str:
        """Formata a data/hora de fim"""
        if self.end_time:
            from .timezone_utils import format_datetime_brasilia
            return format_datetime_brasilia(self.end_time)
        return "—"
    
    def start_time_brasilia(self):
        """Retorna start_time convertido para Brasília (sem timezone info)"""
        if self.start_time:
            from .timezone_utils import utc_to_brasilia
            return utc_to_brasilia(self.start_time).replace(tzinfo=None)
        return None
    
    def end_time_brasilia(self):
        """Retorna end_time convertido para Brasília (sem timezone info)"""
        if self.end_time:
            from .timezone_utils import utc_to_brasilia
            return utc_to_brasilia(self.end_time).replace(tzinfo=None)
        return None

    def has_location(self) -> bool:
        """Verifica se tem dados de localização"""
        return bool(self.latitude and self.longitude)

    def formatted_location(self) -> str:
        """Formata a localização para exibição"""
        if self.address:
            return self.address
        elif self.has_location():
            return f"Lat: {self.latitude:.6f}, Lng: {self.longitude:.6f}"
        return "—"

    def get_google_maps_url(self) -> str:
        """Retorna URL do Google Maps para a localização"""
        if self.has_location():
            return f"https://www.google.com/maps?q={self.latitude},{self.longitude}"
        return ""

    def __repr__(self) -> str:
        return f"<TimeEntry ticket={self.ticket_id} user={self.user_id} hours={self.hours}>"


class TechnicianLocation(db.Model):
    """Tabela para monitoramento de localização dos técnicos em tempo real"""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    latitude = db.Column(db.Float, nullable=False)      # Latitude da localização
    longitude = db.Column(db.Float, nullable=False)     # Longitude da localização
    address = db.Column(db.String(500), nullable=True)  # Endereço formatado da localização
    accuracy = db.Column(db.Float, nullable=True)       # Precisão da localização em metros
    is_online = db.Column(db.Boolean, default=True)     # Se o técnico está online
    is_tracking = db.Column(db.Boolean, default=True)   # Se o tracking está ativo
    last_seen = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
    created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
    
    # Relacionamento com usuário
    user = db.relationship("User", backref="location_tracking")
    
    def to_dict(self):
        """Converte para dicionário para envio via WebSocket"""
        from app.timezone_utils import format_datetime_brasilia
        user = self.user
        if user is None:
            from app.models import User
            user = User.query.get(self.user_id)
        last_seen_iso = self.last_seen.isoformat() if self.last_seen else None
        last_seen_label = format_datetime_brasilia(self.last_seen) if self.last_seen else None
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': user.name if user else 'Usuário não encontrado',
            'name': user.name if user else 'Usuário não encontrado',
            'user_role': user.role if user else 'unknown',
            'latitude': self.latitude,
            'longitude': self.longitude,
            'address': self.address,
            'accuracy': self.accuracy,
            'is_online': bool(self.is_online),
            'is_tracking': bool(self.is_tracking),
            'last_seen': last_seen_iso,
            'last_update': last_seen_iso,
            'last_seen_label': last_seen_label,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    @staticmethod
    def get_active_technicians():
        """Retorna todos os técnicos com tracking ativo"""
        return TechnicianLocation.query.filter_by(is_tracking=True, is_online=True).all()
    
    @staticmethod
    def get_all_technicians_with_last_location():
        """Última localização de cada usuário (uma linha por user_id)."""
        rows = TechnicianLocation.query.order_by(
            TechnicianLocation.last_seen.desc().nullslast(),
            TechnicianLocation.id.desc(),
        ).all()
        seen = set()
        last_locations = []
        for loc in rows:
            if loc.user_id in seen:
                continue
            seen.add(loc.user_id)
            last_locations.append(loc)
        return last_locations
    
    @staticmethod
    def get_last_location_by_user(user_id):
        """Retorna a última localização de um usuário específico"""
        return TechnicianLocation.query.filter_by(user_id=user_id).order_by(
            TechnicianLocation.last_seen.desc()
        ).first()
    
    @staticmethod
    def update_technician_location(user_id, latitude, longitude, address=None, accuracy=None):
        """Atualiza ou cria localização do técnico"""
        try:
            # Validar coordenadas
            if not TechnicianLocation.is_valid_coordinates(latitude, longitude):
                print(f"❌ Coordenadas inválidas para usuário {user_id}: Lat={latitude}, Lng={longitude}")
                return None
            
            # Validar precisão (rejeitar se muito imprecisa)
            if accuracy and accuracy > 1000:  # Rejeitar se precisão > 1km
                print(f"⚠️ Precisão muito baixa para usuário {user_id}: {accuracy}m. Rejeitando.")
                return None
            
            # Buscar localização existente para este usuário
            print(f"🔍 Buscando localização existente para usuário {user_id}...")
            location = TechnicianLocation.query.filter_by(user_id=user_id).first()
            
            if location:
                # Verificar se a nova localização é significativamente melhor
                if location.accuracy and accuracy and accuracy < location.accuracy * 0.8:
                    print(f"✅ Nova localização mais precisa para usuário {user_id}: {accuracy}m vs {location.accuracy}m")
                elif location.accuracy and accuracy and accuracy > location.accuracy * 1.5:
                    print(f"⚠️ Nova localização menos precisa para usuário {user_id}: {accuracy}m vs {location.accuracy}m")
                
                # Atualizar localização existente
                print(f"🔄 Atualizando localização existente para usuário {user_id}")
                print(f"   Localização atual: Lat={location.latitude}, Lng={location.longitude}, Acc={location.accuracy}m")
                print(f"   Nova localização: Lat={latitude}, Lng={longitude}, Acc={accuracy}m")
                
                location.latitude = latitude
                location.longitude = longitude
                location.address = address
                location.accuracy = accuracy
                location.last_seen = brasilia_to_utc(get_brasilia_now())
                location.is_online = True
                location.is_tracking = True
            else:
                # Criar nova localização apenas se as coordenadas são válidas
                print(f"➕ Criando nova localização para usuário {user_id}")
                print(f"   Coordenadas: Lat={latitude}, Lng={longitude}, Acc={accuracy}m")
                
                location = TechnicianLocation(
                    user_id=user_id,
                    latitude=latitude,
                    longitude=longitude,
                    address=address,
                    accuracy=accuracy,
                    is_online=True,
                    is_tracking=True
                )
                db.session.add(location)
            
            db.session.commit()
            print(f"✅ Localização salva para usuário {user_id}: {latitude}, {longitude} (precisão: {accuracy}m)")
            return location
            
        except Exception as e:
            print(f"❌ Erro ao salvar localização para usuário {user_id}: {e}")
            db.session.rollback()
            return None
    
    @staticmethod
    def is_valid_coordinates(latitude, longitude):
        """Valida se as coordenadas são válidas"""
        return (
            latitude is not None and longitude is not None and
            -90 <= latitude <= 90 and
            -180 <= longitude <= 180 and
            not (latitude == 0 and longitude == 0)  # Evitar coordenadas 0,0
        )


class SystemConfig(db.Model):
	"""Modelo para armazenar configurações do sistema"""
	id = db.Column(db.Integer, primary_key=True)
	key = db.Column(db.String(100), unique=True, nullable=False)
	value = db.Column(db.Text)
	description = db.Column(db.String(255))
	category = db.Column(db.String(50), default="general")  # email, general, system, etc
	updated_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()), onupdate=lambda: brasilia_to_utc(get_brasilia_now()))
	
	@staticmethod
	def get(key: str, default: str = None) -> str:
		"""Obtém uma configuração por chave"""
		config = SystemConfig.query.filter_by(key=key).first()
		return config.value if config else default
	
	@staticmethod
	def set(key: str, value: str, description: str = None, category: str = "general") -> None:
		"""Define uma configuração"""
		config = SystemConfig.query.filter_by(key=key).first()
		if config:
			config.value = value
			config.description = description or config.description
			config.category = category
			config.updated_at = brasilia_to_utc(get_brasilia_now())
		else:
			config = SystemConfig(
				key=key,
				value=value,
				description=description,
				category=category
			)
			db.session.add(config)
		db.session.commit()
	
	@staticmethod
	def get_all_by_category(category: str = None) -> dict:
		"""Obtém todas as configurações, opcionalmente filtradas por categoria"""
		query = SystemConfig.query
		if category:
			query = query.filter_by(category=category)
		configs = query.all()
		return {config.key: {
			'value': config.value,
			'description': config.description,
			'category': config.category,
			'updated_at': config.updated_at
		} for config in configs}
	
	def __repr__(self) -> str:
		return f"<SystemConfig {self.key}={self.value}>"


class ServiceOrder(db.Model):
	"""Modelo para ordens de serviço finalizadas"""
	id = db.Column(db.Integer, primary_key=True)
	
	# Dados da ordem de serviço
	codigo = db.Column(db.String(50), nullable=False, unique=True)  # Código da OS
	client_id = db.Column(db.Integer, nullable=True)  # ID do cliente no PostgreSQL
	client_name = db.Column(db.String(200), nullable=False)  # Nome do cliente
	client_document = db.Column(db.String(30), nullable=True)  # CNPJ/CPF
	client_phone = db.Column(db.String(50), nullable=True)  # Telefone
	client_address = db.Column(db.String(200), nullable=True)  # Endereço
	client_address_number = db.Column(db.String(20), nullable=True)  # Número do endereço
	
	# Dados do serviço
	equipment = db.Column(db.String(200), nullable=True)  # Equipamento
	problem_description = db.Column(db.Text, nullable=True)  # Problema descrito
	service_executed = db.Column(db.Text, nullable=False)  # Serviço executado
	observations = db.Column(db.Text, nullable=True)  # Observações
	
	# Dados financeiros
	value = db.Column(db.Float, default=0.0)  # Valor do serviço
	ps_number = db.Column(db.String(50), nullable=True)  # Número da PS gerada
	ps_generated = db.Column(db.Boolean, default=False)  # Se PS foi gerada
	delivery_receipt_generated = db.Column(db.Boolean, default=False)  # Se recibo foi gerado
	
	# Status e controle
	status = db.Column(db.Integer, nullable=False)  # Status final (3=sem cobrança, 5=com cobrança)
	no_charge = db.Column(db.Boolean, default=False)  # Flag "não cobra atendimento"
	has_contract = db.Column(db.Boolean, default=False)  # Se tem contrato
	
	# Datas
	opening_date = db.Column(db.DateTime, nullable=True)  # Data de abertura
	completion_date = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))  # Data de finalização
	
	# Usuário responsável
	technician_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)  # Técnico responsável
	technician_name = db.Column(db.String(120), nullable=False)  # Nome do técnico
	
	# Arquivos gerados
	ps_file = db.Column(db.String(200), nullable=True)  # Nome do arquivo PS
	delivery_file = db.Column(db.String(200), nullable=True)  # Nome do arquivo recibo
	
	def formatted_completion_date(self) -> str:
		"""Formata a data de finalização"""
		from .timezone_utils import format_datetime_brasilia
		return format_datetime_brasilia(self.completion_date)
	
	def formatted_opening_date(self) -> str:
		"""Formata a data de abertura"""
		if self.opening_date:
			from .timezone_utils import format_datetime_brasilia
			return format_datetime_brasilia(self.opening_date)
		return "—"
	
	def status_text(self) -> str:
		"""Retorna o texto do status"""
		if self.status == 3:
			return "Finalizada sem cobrança"
		elif self.status == 5:
			return "Finalizada com cobrança"
		else:
			return f"Status {self.status}"
	
	def __repr__(self) -> str:
		return f"<ServiceOrder {self.codigo}>"


class HelpDeskSession(db.Model):
	"""Sessão de chat do help desk"""
	id = db.Column(db.Integer, primary_key=True)
	session_id = db.Column(db.String(100), unique=True, nullable=False)  # ID único da sessão
	client_email = db.Column(db.String(120), nullable=False)  # Email do cliente
	client_name = db.Column(db.String(200), nullable=False)  # Nome do cliente
	client_id = db.Column(db.Integer, nullable=True)  # ID do cliente no PostgreSQL
	title = db.Column(db.String(200), nullable=False)  # Título do atendimento
	description = db.Column(db.Text, nullable=False)  # Descrição do problema
	status = db.Column(db.String(20), default="waiting")  # waiting, active, closed
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
	assigned_to_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)  # Agente responsável
	assigned_at = db.Column(db.DateTime, nullable=True)  # Quando foi assumido
	closed_at = db.Column(db.DateTime, nullable=True)  # Quando foi fechado
	ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=True)  # Ticket criado a partir do chat
	
	# Relacionamentos
	assigned_to = db.relationship("User", backref="helpdesk_sessions")
	ticket = db.relationship("Ticket", backref="helpdesk_session")
	messages = db.relationship("HelpDeskMessage", backref="session", lazy=True, cascade="all, delete-orphan")
	
	def formatted_created_at(self) -> str:
		"""Formata a data de criação"""
		from .timezone_utils import format_datetime_brasilia
		return format_datetime_brasilia(self.created_at)
	
	def formatted_assigned_at(self) -> str:
		"""Formata a data de atribuição"""
		if self.assigned_at:
			from .timezone_utils import format_datetime_brasilia
			return format_datetime_brasilia(self.assigned_at)
		return "—"
	
	def formatted_closed_at(self) -> str:
		"""Formata a data de fechamento"""
		if self.closed_at:
			from .timezone_utils import format_datetime_brasilia
			return format_datetime_brasilia(self.closed_at)
		return "—"
	
	def status_text(self) -> str:
		"""Retorna o texto do status"""
		status_map = {
			"waiting": "Aguardando",
			"active": "Em Atendimento",
			"closed": "Fechado"
		}
		return status_map.get(self.status, self.status)
	
	def status_color(self) -> str:
		"""Retorna a cor do status"""
		color_map = {
			"waiting": "warning",
			"active": "success",
			"closed": "secondary"
		}
		return color_map.get(self.status, "secondary")
	
	def __repr__(self) -> str:
		return f"<HelpDeskSession {self.session_id}: {self.title}>"


class HelpDeskMessage(db.Model):
	"""Mensagem do chat do help desk"""
	id = db.Column(db.Integer, primary_key=True)
	session_id = db.Column(db.Integer, db.ForeignKey("help_desk_session.id"), nullable=False)
	message = db.Column(db.Text, nullable=False)
	sender_type = db.Column(db.String(20), nullable=False)  # client, agent, system
	sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)  # ID do agente (se for agente)
	sender_name = db.Column(db.String(200), nullable=False)  # Nome do remetente
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
	read_at = db.Column(db.DateTime, nullable=True)  # Quando foi lida (para mensagens do cliente)
	
	# Relacionamentos
	sender = db.relationship("User", backref="helpdesk_messages")
	
	def formatted_created_at(self) -> str:
		"""Formata a data de criação"""
		from .timezone_utils import format_datetime_brasilia
		return format_datetime_brasilia(self.created_at)
	
	def formatted_time(self) -> str:
		"""Formata apenas a hora"""
		from .timezone_utils import format_time_brasilia
		return format_time_brasilia(self.created_at)
	
	def is_from_client(self) -> bool:
		"""Verifica se a mensagem é do cliente"""
		return self.sender_type == "client"
	
	def is_from_agent(self) -> bool:
		"""Verifica se a mensagem é do agente"""
		return self.sender_type == "agent"
	
	def is_system_message(self) -> bool:
		"""Verifica se é uma mensagem do sistema"""
		return self.sender_type == "system"
	
	def __repr__(self) -> str:
		return f"<HelpDeskMessage {self.id}: {self.sender_name}>"


class HelpDeskAgentMap(db.Model):
	"""Mapeia um usuário do Computicket para o engine WhatsApp (Compuchat)."""
	__tablename__ = "helpdesk_agent_map"

	id = db.Column(db.Integer, primary_key=True)
	computicket_user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
	engine_user_id = db.Column(db.Integer, nullable=False)
	engine_email = db.Column(db.String(200), nullable=False)
	engine_password = db.Column(db.String(120), nullable=False)
	company_id = db.Column(db.Integer, nullable=False, default=1)
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))

	user = db.relationship("User", backref="helpdesk_agent_map")


class HelpDeskTicketLink(db.Model):
	"""Vínculo conversa WhatsApp (engine) ↔ chamado Computicket."""
	__tablename__ = "helpdesk_ticket_link"

	id = db.Column(db.Integer, primary_key=True)
	engine_ticket_id = db.Column(db.Integer, unique=True, nullable=False, index=True)
	computicket_ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=False, index=True)
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))

	ticket = db.relationship("Ticket", backref="helpdesk_links")


class PasswordVault(db.Model):
	"""Modelo para armazenar credenciais de máquinas dos clientes"""
	id = db.Column(db.Integer, primary_key=True)
	client_id = db.Column(db.Integer, db.ForeignKey('client.id'), nullable=True)
	# Campos para cliente externo (PostgreSQL)
	external_client_id = db.Column(db.Integer, nullable=True)
	external_client_name = db.Column(db.String(200), nullable=True)
	
	machine_name = db.Column(db.String(200), nullable=False)
	anydesk_code = db.Column(db.String(50))
	password = db.Column(db.String(500), nullable=False)  # Senha criptografada
	description = db.Column(db.Text)
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	
	# Relacionamentos
	client = db.relationship('Client', backref='password_entries')
	created_by = db.relationship('User', backref='created_passwords')
	
	def get_client_name(self) -> str:
		"""Retorna o nome do cliente (interno ou externo)"""
		if self.external_client_name:
			return self.external_client_name
		if self.client_id == -1:
			return "Cliente Externo"
		return self.client.name if self.client else ""
	
	def get_client_id(self) -> int:
		"""Retorna o ID do cliente (interno ou externo)"""
		if self.external_client_id:
			return self.external_client_id
		if self.client_id == -1:
			return self.external_client_id or 0
		return self.client_id if self.client_id else 0
	
	def is_external_client(self) -> bool:
		"""Verifica se é um cliente externo"""
		return bool(self.external_client_id) or self.client_id == -1
	
	def __repr__(self) -> str:
		client_name = self.get_client_name()
		return f"<PasswordVault {self.machine_name} - {client_name}>"

class KnowledgeCategory(db.Model):
	"""Modelo para categorias do banco de conhecimentos"""
	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(100), nullable=False, unique=True)
	description = db.Column(db.Text)
	icon = db.Column(db.String(50), default='fas fa-folder')
	color = db.Column(db.String(20), default='#3B82F6')
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	
	# Relacionamentos
	created_by = db.relationship('User', backref='created_categories')
	articles = db.relationship('KnowledgeArticle', backref='category', lazy='dynamic', cascade='all, delete-orphan')
	
	def __repr__(self) -> str:
		return f"<KnowledgeCategory {self.name}>"

class KnowledgeArticle(db.Model):
	"""Modelo para artigos do banco de conhecimentos"""
	id = db.Column(db.Integer, primary_key=True)
	title = db.Column(db.String(200), nullable=False)
	content = db.Column(db.Text, nullable=False)
	summary = db.Column(db.Text)
	tags = db.Column(db.String(500))  # Tags separadas por vírgula
	category_id = db.Column(db.Integer, db.ForeignKey('knowledge_category.id'), nullable=False)
	status = db.Column(db.String(20), default='published')  # draft, published, archived
	views_count = db.Column(db.Integer, default=0)
	is_featured = db.Column(db.Boolean, default=False)
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	updated_by_id = db.Column(db.Integer, db.ForeignKey('user.id'))
	
	# Relacionamentos
	created_by = db.relationship('User', foreign_keys=[created_by_id], backref='created_articles')
	updated_by = db.relationship('User', foreign_keys=[updated_by_id], backref='updated_articles')
	attachments = db.relationship('KnowledgeAttachment', backref='article', lazy='dynamic', cascade='all, delete-orphan')
	
	def get_tags_list(self) -> list:
		"""Retorna lista de tags"""
		if not self.tags:
			return []
		return [tag.strip() for tag in self.tags.split(',') if tag.strip()]
	
	def add_tag(self, tag: str):
		"""Adiciona uma tag"""
		tags_list = self.get_tags_list()
		if tag not in tags_list:
			tags_list.append(tag)
			self.tags = ', '.join(tags_list)
	
	def remove_tag(self, tag: str):
		"""Remove uma tag"""
		tags_list = self.get_tags_list()
		if tag in tags_list:
			tags_list.remove(tag)
			self.tags = ', '.join(tags_list)
	
	def increment_views(self):
		"""Incrementa contador de visualizações"""
		self.views_count += 1
		db.session.commit()
	
	def __repr__(self) -> str:
		return f"<KnowledgeArticle {self.title}>"

class KnowledgeAttachment(db.Model):
	"""Modelo para anexos dos artigos do banco de conhecimentos"""
	id = db.Column(db.Integer, primary_key=True)
	article_id = db.Column(db.Integer, db.ForeignKey('knowledge_article.id'), nullable=False)
	filename = db.Column(db.String(255), nullable=False)
	original_filename = db.Column(db.String(255), nullable=False)
	file_path = db.Column(db.String(500), nullable=False)
	file_size = db.Column(db.Integer, nullable=False)  # em bytes
	file_type = db.Column(db.String(100), nullable=False)  # MIME type
	description = db.Column(db.Text)
	download_count = db.Column(db.Integer, default=0)
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	
	# Relacionamentos
	created_by = db.relationship('User', backref='uploaded_attachments')
	
	def get_file_size_mb(self) -> float:
		"""Retorna tamanho do arquivo em MB"""
		return round(self.file_size / (1024 * 1024), 2)
	
	def get_file_icon(self) -> str:
		"""Retorna ícone baseado no tipo de arquivo"""
		file_ext = self.filename.split('.')[-1].lower()
		icon_map = {
			'pdf': 'fas fa-file-pdf',
			'doc': 'fas fa-file-word',
			'docx': 'fas fa-file-word',
			'xls': 'fas fa-file-excel',
			'xlsx': 'fas fa-file-excel',
			'ppt': 'fas fa-file-powerpoint',
			'pptx': 'fas fa-file-powerpoint',
			'txt': 'fas fa-file-alt',
			'zip': 'fas fa-file-archive',
			'rar': 'fas fa-file-archive',
			'jpg': 'fas fa-file-image',
			'jpeg': 'fas fa-file-image',
			'png': 'fas fa-file-image',
			'gif': 'fas fa-file-image',
			'mp4': 'fas fa-file-video',
			'avi': 'fas fa-file-video',
			'mp3': 'fas fa-file-audio',
			'wav': 'fas fa-file-audio'
		}
		return icon_map.get(file_ext, 'fas fa-file')
	
	def increment_downloads(self):
		"""Incrementa contador de downloads"""
		self.download_count += 1
		db.session.commit()
	
	def __repr__(self) -> str:
		return f"<KnowledgeAttachment {self.original_filename}>"


class Budget(db.Model):
	"""Modelo para orçamentos"""
	id = db.Column(db.Integer, primary_key=True)
	title = db.Column(db.String(200), nullable=False)
	description = db.Column(db.Text)
	client_id = db.Column(db.Integer, db.ForeignKey('client.id'), nullable=True)
	external_client_id = db.Column(db.Integer, nullable=True)
	external_client_name = db.Column(db.String(200), nullable=True)
	
	# Campos de arquivo
	original_filename = db.Column(db.String(255), nullable=True)
	stored_filename = db.Column(db.String(255), nullable=True)
	file_path = db.Column(db.String(500), nullable=True)
	file_size = db.Column(db.Integer, nullable=True)
	file_type = db.Column(db.String(100), nullable=True)
	
	# Campos de controle
	status = db.Column(db.String(50), default='draft')  # draft, sent, approved, rejected
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	
	# Campos do builder de orçamentos
	public_token = db.Column(db.String(64), unique=True, nullable=True, index=True)
	valid_until = db.Column(db.Date, nullable=True)
	theme_id = db.Column(db.Integer, db.ForeignKey('budget_theme.id'), nullable=True)
	show_logo = db.Column(db.Boolean, default=True)
	discount = db.Column(db.Float, default=0.0)
	payment_terms = db.Column(db.Text, nullable=True)
	internal_notes = db.Column(db.Text, nullable=True)  # uso interno — não visível ao cliente
	responded_at = db.Column(db.DateTime, nullable=True)
	signer_name = db.Column(db.String(200), nullable=True)
	signature_data = db.Column(db.Text, nullable=True)
	signature_file_path = db.Column(db.String(500), nullable=True)
	signature_timestamp = db.Column(db.DateTime, nullable=True)
	
	# Relacionamentos
	client = db.relationship('Client', backref='budgets')
	created_by = db.relationship('User', backref='created_budgets')
	theme = db.relationship('BudgetTheme', backref='budgets', lazy=True)
	items = db.relationship('BudgetItem', backref='budget', lazy=True,
		order_by='BudgetItem.sort_order', cascade='all, delete-orphan')
	
	@property
	def subtotal(self) -> float:
		"""Soma dos itens não recorrentes (investimento único)."""
		return sum(item.total for item in self.items if not getattr(item, 'is_recurring', False))

	@property
	def recurring_totals_by_period(self) -> Dict[str, float]:
		"""Totais recorrentes agrupados por período (monthly/quarterly/yearly)."""
		totals: Dict[str, float] = {}
		for item in self.items:
			if not getattr(item, 'is_recurring', False):
				continue
			period = item.recurrence_period if item.recurrence_period in BudgetItem.RECURRENCE_LABELS else 'monthly'
			totals[period] = totals.get(period, 0.0) + item.total
		return totals
	
	@property
	def total(self) -> float:
		return max(self.subtotal - (self.discount or 0.0), 0.0)
	
	@property
	def is_expired(self) -> bool:
		return bool(self.valid_until and self.valid_until < get_brasilia_now().date())
	
	def get_theme_colors(self) -> Dict[str, str]:
		"""Cores do tema do orçamento (ou padrão)"""
		if self.theme:
			return {
				"primary": self.theme.primary_color or "#2563eb",
				"accent": self.theme.accent_color or "#0ea5e9",
				"text": self.theme.text_color or "#1e293b",
				"title": self.theme.title_color or "#ffffff",
			}
		return {"primary": "#2563eb", "accent": "#0ea5e9", "text": "#1e293b", "title": "#ffffff"}
	
	def get_client_name(self) -> str:
		"""Retorna o nome do cliente (interno ou externo)"""
		if self.external_client_name:
			return self.external_client_name
		if self.client_id == -1:
			return "Cliente Externo"
		return self.client.name if self.client else "Sem cliente"
	
	def get_client_id(self) -> int:
		"""Retorna o ID do cliente (interno ou externo)"""
		if self.external_client_id:
			return self.external_client_id
		if self.client_id == -1:
			return self.external_client_id or 0
		return self.client_id if self.client_id else 0
	
	def is_external_client(self) -> bool:
		"""Verifica se é um cliente externo"""
		return bool(self.external_client_id) or self.client_id == -1
	
	def has_file(self) -> bool:
		"""Verifica se tem arquivo anexado"""
		return bool(self.stored_filename and self.file_path)
	
	def get_file_icon(self) -> str:
		"""Retorna ícone baseado na extensão do arquivo"""
		if not self.original_filename:
			return 'fas fa-file'
		
		file_ext = self.original_filename.split('.')[-1].lower()
		icon_map = {
			'pdf': 'fas fa-file-pdf',
			'doc': 'fas fa-file-word',
			'docx': 'fas fa-file-word',
			'xls': 'fas fa-file-excel',
			'xlsx': 'fas fa-file-excel',
			'ppt': 'fas fa-file-powerpoint',
			'pptx': 'fas fa-file-powerpoint',
			'txt': 'fas fa-file-alt',
			'jpg': 'fas fa-file-image',
			'jpeg': 'fas fa-file-image',
			'png': 'fas fa-file-image',
			'gif': 'fas fa-file-image',
			'zip': 'fas fa-file-archive',
			'rar': 'fas fa-file-archive',
			'7z': 'fas fa-file-archive'
		}
		return icon_map.get(file_ext, 'fas fa-file')
	
	def get_status_color(self) -> str:
		"""Retorna cor baseada no status"""
		status_colors = {
			'draft': 'secondary',
			'sent': 'info',
			'approved': 'success',
			'rejected': 'danger'
		}
		return status_colors.get(self.status, 'secondary')
	
	def get_status_text(self) -> str:
		"""Retorna texto do status em português"""
		status_texts = {
			'draft': 'Rascunho',
			'sent': 'Enviado',
			'approved': 'Aprovado',
			'rejected': 'Rejeitado'
		}
		return status_texts.get(self.status, 'Desconhecido')
	
	def __repr__(self) -> str:
		client_name = self.get_client_name()
		return f"<Budget {self.title} - {client_name}>"


class BudgetItem(db.Model):
	"""Item de linha de um orçamento (builder)"""
	__tablename__ = 'budget_item'

	id = db.Column(db.Integer, primary_key=True)
	budget_id = db.Column(db.Integer, db.ForeignKey('budget.id'), nullable=False, index=True)
	item_type = db.Column(db.String(20), default='manual')  # manual | product | service
	product_id = db.Column(db.Integer, nullable=True)
	service_id = db.Column(db.Integer, db.ForeignKey('service.id'), nullable=True)
	codigo = db.Column(db.String(50), nullable=True)
	description = db.Column(db.Text, nullable=False)
	quantity = db.Column(db.Float, default=1.0)
	unit_price = db.Column(db.Float, default=0.0)
	unit_of_measure = db.Column(db.String(20), nullable=True)
	observations = db.Column(db.Text, nullable=True)
	sort_order = db.Column(db.Integer, default=0)
	is_recurring = db.Column(db.Boolean, default=False)
	# monthly | quarterly | yearly (quando is_recurring)
	recurrence_period = db.Column(db.String(20), nullable=True)

	service = db.relationship('Service', backref='budget_items', lazy=True)

	RECURRENCE_LABELS = {
		'monthly': 'Mensal',
		'quarterly': 'Trimestral',
		'yearly': 'Anual',
	}

	@property
	def total(self) -> float:
		return (self.quantity or 0.0) * (self.unit_price or 0.0)

	@property
	def type_label(self) -> str:
		labels = {'product': 'Produto', 'service': 'Serviço', 'manual': 'Item'}
		return labels.get(self.item_type or 'manual', 'Item')

	@property
	def recurrence_label(self) -> str:
		if not self.is_recurring:
			return ''
		return self.RECURRENCE_LABELS.get(self.recurrence_period or 'monthly', 'Mensal')

	def to_dict(self) -> Dict[str, Any]:
		period = self.recurrence_period if self.is_recurring else None
		if self.is_recurring and period not in self.RECURRENCE_LABELS:
			period = 'monthly'
		return {
			"id": self.id,
			"item_type": self.item_type or 'manual',
			"product_id": self.product_id,
			"service_id": self.service_id,
			"codigo": self.codigo or '',
			"description": self.description,
			"quantity": self.quantity,
			"unit_price": self.unit_price,
			"unit_of_measure": self.unit_of_measure or '',
			"observations": self.observations or '',
			"total": self.total,
			"sort_order": self.sort_order,
			"is_recurring": bool(self.is_recurring),
			"recurrence_period": period,
		}

	def __repr__(self) -> str:
		return f"<BudgetItem {self.description} x{self.quantity}>"


class BudgetTheme(db.Model):
	"""Padrão de cores reutilizável para orçamentos"""
	__tablename__ = 'budget_theme'

	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(100), nullable=False, unique=True)
	primary_color = db.Column(db.String(7), default="#2563eb")
	accent_color = db.Column(db.String(7), default="#0ea5e9")
	text_color = db.Column(db.String(7), default="#1e293b")
	title_color = db.Column(db.String(7), default="#ffffff")
	is_default = db.Column(db.Boolean, default=False)

	def to_dict(self) -> Dict[str, Any]:
		return {
			"id": self.id,
			"name": self.name,
			"primary_color": self.primary_color,
			"accent_color": self.accent_color,
			"text_color": self.text_color,
			"title_color": self.title_color,
			"is_default": self.is_default,
		}

	def __repr__(self) -> str:
		return f"<BudgetTheme {self.name}>"


class Appointment(db.Model):
	"""Modelo para agendamentos"""
	id = db.Column(db.Integer, primary_key=True)
	title = db.Column(db.String(200), nullable=False)
	description = db.Column(db.Text)
	appointment_date = db.Column(db.DateTime, nullable=False)
	client_id = db.Column(db.Integer, db.ForeignKey('client.id'), nullable=False)
	user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	service_id = db.Column(db.Integer, db.ForeignKey('service.id'))
	created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	reminder_sent = db.Column(db.Boolean, default=False)  # Flag para controlar envio de lembretes
	
	# Relacionamentos
	client = db.relationship('Client', backref='appointments', lazy=True)
	user = db.relationship('User', backref='appointments', lazy=True, foreign_keys=[user_id])
	service = db.relationship('Service', backref='appointments', lazy=True)
	creator = db.relationship('User', backref='created_appointments', lazy=True, foreign_keys=[created_by])
	
	def get_client_name(self) -> str:
		"""Retorna o nome do cliente"""
		return self.client.name if self.client else 'Cliente não definido'
	
	def get_user_name(self) -> str:
		"""Retorna o nome do usuário"""
		return self.user.name if self.user else 'Usuário não definido'
	
	def get_service_name(self) -> str:
		"""Retorna o nome do serviço"""
		return self.service.name if self.service else 'Serviço não definido'
	
	def get_formatted_date(self) -> str:
		"""Retorna a data formatada"""
		return self.appointment_date.strftime('%d/%m/%Y às %H:%M')
	
	def is_today(self) -> bool:
		"""Verifica se o agendamento é hoje"""
		return self.appointment_date.date() == get_brasilia_now().date()
	
	def is_past(self) -> bool:
		"""Verifica se o agendamento já passou"""
		return self.appointment_date < get_brasilia_now()
	
	def __repr__(self) -> str:
		return f"<Appointment {self.title} - {self.get_formatted_date()}>"


class System(db.Model):
	"""Modelo para sistemas/softwares"""
	__tablename__ = 'system'
	
	id = db.Column(db.Integer, primary_key=True)
	name = db.Column(db.String(100), nullable=False, unique=True)
	description = db.Column(db.Text)
	version = db.Column(db.String(50))
	company = db.Column(db.String(100))
	logo_url = db.Column(db.String(255))
	is_active = db.Column(db.Boolean, default=True)
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	
	# Relacionamentos
	plans = db.relationship('Plan', backref='system', lazy=True, cascade='all, delete-orphan')
	
	def get_active_plans(self):
		"""Retorna apenas os planos ativos do sistema"""
		return [plan for plan in self.plans if plan.is_active]
	
	def get_total_plans(self):
		"""Retorna o total de planos do sistema"""
		return len(self.plans)
	
	def get_active_plans_count(self):
		"""Retorna a quantidade de planos ativos"""
		return len(self.get_active_plans())
	
	def __repr__(self) -> str:
		return f"<System {self.name} - {self.version}>"


class Plan(db.Model):
	"""Modelo para planos de suporte"""
	__tablename__ = 'plan'
	
	id = db.Column(db.Integer, primary_key=True)
	system_id = db.Column(db.Integer, db.ForeignKey('system.id'), nullable=False)
	name = db.Column(db.String(100), nullable=False)
	description = db.Column(db.Text)
	
	# Configurações de horas
	monthly_hours = db.Column(db.Integer, default=0)  # Horas mensais incluídas
	additional_hour_rate = db.Column(db.Float, default=0.0)  # Valor da hora adicional
	
	# Configurações de suporte
	includes_remote_support = db.Column(db.Boolean, default=True)
	includes_on_site_support = db.Column(db.Boolean, default=False)
	includes_phone_support = db.Column(db.Boolean, default=True)
	includes_email_support = db.Column(db.Boolean, default=True)
	# Flag geral se o plano inclui suporte (para separar planos com/sem suporte)
	support_included = db.Column(db.Boolean, default=False)
	
	# Configurações de SLA
	response_time_hours = db.Column(db.Integer, default=24)  # Tempo de resposta em horas
	resolution_time_hours = db.Column(db.Integer, default=72)  # Tempo de resolução em horas
	
	# Configurações de prioridade
	priority_level = db.Column(db.Integer, default=3)  # 1=Crítica, 2=Alta, 3=Média, 4=Baixa
	
	# Configurações financeiras
	monthly_value = db.Column(db.Float, default=0.0)
	setup_fee = db.Column(db.Float, default=0.0)
	
	# Status
	is_active = db.Column(db.Boolean, default=True)
	is_featured = db.Column(db.Boolean, default=False)  # Plano em destaque
	
	# Metadados
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	
	# Relacionamentos
	client_plans = db.relationship('ClientPlan', backref='plan', lazy=True, cascade='all, delete-orphan')
	
	def get_formatted_monthly_value(self):
		"""Retorna o valor mensal formatado"""
		return f"R$ {self.monthly_value:.2f}"
	
	def get_formatted_additional_hour_rate(self):
		"""Retorna o valor da hora adicional formatado"""
		return f"R$ {self.additional_hour_rate:.2f}"
	
	def get_priority_text(self):
		"""Retorna o texto da prioridade"""
		priorities = {
			1: "Crítica",
			2: "Alta", 
			3: "Média",
			4: "Baixa"
		}
		return priorities.get(self.priority_level, "Média")
	
	def get_priority_color(self):
		"""Retorna a cor da prioridade"""
		colors = {
			1: "error",
			2: "warning",
			3: "info", 
			4: "success"
		}
		return colors.get(self.priority_level, "info")
	
	def get_sla_text(self):
		"""Retorna o texto do SLA"""
		return f"{self.response_time_hours}h resposta / {self.resolution_time_hours}h resolução"
	
	def get_support_types(self):
		"""Retorna lista dos tipos de suporte incluídos"""
		types = []
		if self.includes_remote_support:
			types.append("Remoto")
		if self.includes_on_site_support:
			types.append("Presencial")
		if self.includes_phone_support:
			types.append("Telefone")
		if self.includes_email_support:
			types.append("Email")
		return types
	
	def __repr__(self) -> str:
		return f"<Plan {self.name} - {self.system.name if self.system else 'Sistema não encontrado'}>"


class ClientPlan(db.Model):
	"""Modelo para planos contratados pelos clientes"""
	__tablename__ = 'client_plan'
	
	id = db.Column(db.Integer, primary_key=True)
	client_id = db.Column(db.Integer, db.ForeignKey('client.id'), nullable=False)
	plan_id = db.Column(db.Integer, db.ForeignKey('plan.id'), nullable=False)
	
	# Datas do contrato
	start_date = db.Column(db.DateTime, nullable=False)
	end_date = db.Column(db.DateTime, nullable=False)
	
	# Configurações específicas do cliente
	custom_monthly_hours = db.Column(db.Integer)  # Horas personalizadas (opcional)
	custom_hour_rate = db.Column(db.Float)  # Valor personalizado da hora adicional (opcional)
	
	# Status
	is_active = db.Column(db.Boolean, default=True)
	is_auto_renew = db.Column(db.Boolean, default=True)  # Renovação automática
	
	# Metadados
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	
	def get_effective_monthly_hours(self):
		"""Retorna as horas mensais efetivas (personalizadas ou padrão do plano)"""
		return self.custom_monthly_hours if self.custom_monthly_hours else self.plan.monthly_hours
	
	def get_effective_hour_rate(self):
		"""Retorna o valor efetivo da hora adicional"""
		return self.custom_hour_rate if self.custom_hour_rate else self.plan.additional_hour_rate
	
	def is_expired(self):
		"""Verifica se o plano está expirado"""
		return get_brasilia_now() > self.end_date
	
	def days_until_expiry(self):
		"""Retorna dias até expirar"""
		if self.is_expired():
			return 0
		return (self.end_date - get_brasilia_now()).days
	
	def get_status_text(self):
		"""Retorna o status do plano"""
		if not self.is_active:
			return "Inativo"
		if self.is_expired():
			return "Expirado"
		return "Ativo"
	
	def get_status_color(self):
		"""Retorna a cor do status"""
		if not self.is_active:
			return "secondary"
		if self.is_expired():
			return "error"
		return "success"
	
	def __repr__(self) -> str:
		return f"<ClientPlan {self.client.name if self.client else 'Cliente'} - {self.plan.name if self.plan else 'Plano'}>"


class PlanUsage(db.Model):
	"""Modelo para controle de uso de horas dos planos"""
	__tablename__ = 'plan_usage'
	
	id = db.Column(db.Integer, primary_key=True)
	client_plan_id = db.Column(db.Integer, db.ForeignKey('client_plan.id'), nullable=False)
	ticket_id = db.Column(db.Integer, db.ForeignKey('ticket.id'), nullable=True)
	
	# Controle de horas
	hours_used = db.Column(db.Float, nullable=False, default=0.0)
	month_year = db.Column(db.String(7), nullable=False)  # Formato: YYYY-MM
	
	# Metadados
	created_at = db.Column(db.DateTime, default=get_brasilia_now)
	updated_at = db.Column(db.DateTime, default=get_brasilia_now, onupdate=get_brasilia_now)
	
	# Relacionamentos
	client_plan = db.relationship('ClientPlan', backref='usage_records', lazy=True)
	ticket = db.relationship('Ticket', backref='plan_usage', lazy=True)
	
	def get_month_year_display(self):
		"""Retorna o mês/ano formatado"""
		try:
			year, month = self.month_year.split('-')
			month_names = {
				'01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
				'05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
				'09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
			}
			return f"{month_names.get(month, month)}/{year}"
		except:
			return self.month_year
	
	def __repr__(self) -> str:
		return f"<PlanUsage {self.client_plan.client.name if self.client_plan and self.client_plan.client else 'Cliente'} - {self.month_year} - {self.hours_used}h>"


class InventoryItem(db.Model):
	"""Item de inventário com UUID público para etiquetas."""

	__tablename__ = "inventory_item"

	STATUS_DISPONIVEL = "disponivel"
	STATUS_EMPRESTADO = "emprestado"
	STATUS_VENDIDO = "vendido"
	STATUS_DESCARTADO = "descartado"
	STATUSES = (STATUS_DISPONIVEL, STATUS_EMPRESTADO, STATUS_VENDIDO, STATUS_DESCARTADO)

	id = db.Column(db.Integer, primary_key=True)
	public_uuid = db.Column(db.String(36), unique=True, nullable=False, index=True)
	title = db.Column(db.String(200))
	description = db.Column(db.Text)
	serial_number = db.Column(db.String(120))
	status = db.Column(db.String(20), nullable=False, default=STATUS_DISPONIVEL)

	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
	updated_at = db.Column(
		db.DateTime,
		default=lambda: brasilia_to_utc(get_brasilia_now()),
		onupdate=lambda: brasilia_to_utc(get_brasilia_now()),
	)
	created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

	created_by = db.relationship("User", backref=db.backref("inventory_items_created", lazy="dynamic"), foreign_keys=[created_by_id])
	photos = db.relationship(
		"InventoryItemPhoto",
		backref="item",
		lazy=True,
		cascade="all, delete-orphan",
		order_by="InventoryItemPhoto.sort_order",
	)
	events = db.relationship(
		"InventoryEvent",
		backref="item",
		lazy=True,
		cascade="all, delete-orphan",
	)

	def status_label(self) -> str:
		labels = {
			self.STATUS_DISPONIVEL: "Disponível",
			self.STATUS_EMPRESTADO: "Emprestado",
			self.STATUS_VENDIDO: "Vendido",
			self.STATUS_DESCARTADO: "Descartado",
		}
		return labels.get(self.status, self.status or "—")

	def __repr__(self) -> str:
		return f"<InventoryItem {self.id} {self.public_uuid} ({self.status})>"


class InventoryItemPhoto(db.Model):
	__tablename__ = "inventory_item_photo"

	id = db.Column(db.Integer, primary_key=True)
	item_id = db.Column(db.Integer, db.ForeignKey("inventory_item.id"), nullable=False)
	stored_filename = db.Column(db.String(255), nullable=False)
	original_filename = db.Column(db.String(255), nullable=False)
	file_path = db.Column(db.String(500), nullable=False)
	file_size = db.Column(db.Integer, nullable=False, default=0)
	sort_order = db.Column(db.Integer, nullable=False, default=0)
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))


class InventoryEvent(db.Model):
	__tablename__ = "inventory_event"

	ACTION_EMPRESTIMO = "emprestimo"
	ACTION_VENDA = "venda"
	ACTION_DESCARTE = "descarte"
	ACTION_DEVOLUCAO = "devolucao"
	ACTIONS = (ACTION_EMPRESTIMO, ACTION_VENDA, ACTION_DESCARTE, ACTION_DEVOLUCAO)

	id = db.Column(db.Integer, primary_key=True)
	item_id = db.Column(db.Integer, db.ForeignKey("inventory_item.id"), nullable=False)
	action_type = db.Column(db.String(20), nullable=False)
	note = db.Column(db.Text)
	meta_json = db.Column(db.Text)
	created_at = db.Column(db.DateTime, default=lambda: brasilia_to_utc(get_brasilia_now()))
	created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

	created_by = db.relationship("User", backref=db.backref("inventory_events", lazy="dynamic"), foreign_keys=[created_by_id])

	def action_label(self) -> str:
		labels = {
			self.ACTION_EMPRESTIMO: "Empréstimo",
			self.ACTION_VENDA: "Venda",
			self.ACTION_DESCARTE: "Descarte",
			self.ACTION_DEVOLUCAO: "Devolução",
		}
		return labels.get(self.action_type, self.action_type or "—")

	def get_meta_dict(self) -> Dict[str, Any]:
		if not self.meta_json:
			return {}
		try:
			return json.loads(self.meta_json)
		except (json.JSONDecodeError, TypeError):
			return {}

	def __repr__(self) -> str:
		return f"<InventoryEvent {self.id} {self.action_type} item={self.item_id}>"


class ShiftSwap(db.Model):
	"""Tabela para registro de trocas temporárias de plantão entre dois membros"""
	__tablename__ = 'shift_swap'

	id = db.Column(db.Integer, primary_key=True)
	swap_date = db.Column(db.Date, nullable=False, index=True)
	user_1_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	user_2_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
	requested_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
	status = db.Column(db.String(20), nullable=False, default='pending')  # pending | accepted | declined
	created_at = db.Column(db.DateTime, default=get_brasilia_now)

	user_1 = db.relationship('User', foreign_keys=[user_1_id], backref='swaps_as_user1')
	user_2 = db.relationship('User', foreign_keys=[user_2_id], backref='swaps_as_user2')
	requested_by = db.relationship('User', foreign_keys=[requested_by_id], backref='swaps_requested')

	def to_dict(self) -> Dict[str, Any]:
		return {
			"id": self.id,
			"swap_date": self.swap_date.isoformat(),
			"swap_date_br": self.swap_date.strftime('%d/%m/%Y'),
			"status": self.status,
			"requested_by_id": self.requested_by_id,
			"user_1": {
				"id": self.user_1.id,
				"name": self.user_1.name,
				"team": self.user_1.team
			},
			"user_2": {
				"id": self.user_2.id,
				"name": self.user_2.name,
				"team": self.user_2.team
			}
		}

	def __repr__(self) -> str:
		return f"<ShiftSwap id={self.id} date={self.swap_date} status={self.status} {self.user_1_id} <-> {self.user_2_id}>"
