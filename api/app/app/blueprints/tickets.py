from flask import Blueprint, current_app, render_template, request, redirect, url_for, flash, jsonify, send_file
from flask_login import login_required, current_user
from datetime import datetime
import os
import base64
import uuid
from pathlib import Path
from .. import db
from ..models import Ticket, Client, Contract, Service, User, TimeEntry, TicketProduct, TicketAddon, HelpDeskTicketLink
from ..external_pg import ExternalPgError, fetch_external_clients, get_external_client_by_id
from ..timezone_utils import get_brasilia_now, brasilia_to_utc, utc_to_brasilia
from .utils import connect_postgres
from ..engine_client import EngineError, admin_request, notify_helpdesk_ticket
from ..plan_usage_manager import update_plan_usage_from_ticket
from ..services.faturamento_products import (
	search_products as search_products_pg,
	validate_products,
	create_dav,
)

def save_signature_file(signature_data, ticket_id, user_id):
    """
    Salva a assinatura digital como arquivo PNG com fundo branco na pasta signatures/
    Retorna o caminho do arquivo salvo ou None em caso de erro
    """
    try:
        # Criar pasta signatures se não existir
        # Usar caminho absoluto para garantir que seja na raiz do projeto
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        signatures_dir = os.path.join(project_root, "signatures")
        os.makedirs(signatures_dir, exist_ok=True)
        
        # Gerar nome único para o arquivo
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"signature_t{ticket_id}_u{user_id}_{timestamp}_{unique_id}.png"
        file_path = os.path.join(signatures_dir, filename)
        
        # Remover o prefixo "data:image/png;base64," se existir
        if signature_data.startswith('data:image'):
            signature_data = signature_data.split(',')[1]
        
        # Decodificar base64
        signature_bytes = base64.b64decode(signature_data)
        
        # Processar imagem para adicionar fundo branco
        try:
            from PIL import Image
            import io
            
            # Abrir imagem original
            original_img = Image.open(io.BytesIO(signature_bytes))
            
            # Converter para RGBA se necessário
            if original_img.mode != 'RGBA':
                original_img = original_img.convert('RGBA')
            
            # Criar nova imagem com fundo branco
            # Usar o mesmo tamanho da imagem original
            width, height = original_img.size
            white_bg_img = Image.new('RGB', (width, height), (255, 255, 255))  # Fundo branco
            
            # Colar a assinatura sobre o fundo branco
            white_bg_img.paste(original_img, (0, 0), original_img)
            
            # Salvar como PNG com fundo branco
            white_bg_img.save(file_path, 'PNG')
            
            print(f"DEBUG: Assinatura salva com fundo branco: {file_path}")
            
        except ImportError:
            print("DEBUG: PIL não disponível, salvando arquivo original")
            # Fallback: salvar arquivo original se PIL não estiver disponível
            with open(file_path, 'wb') as f:
                f.write(signature_bytes)
        except Exception as e:
            print(f"DEBUG: Erro ao processar imagem com PIL: {e}")
            # Fallback: salvar arquivo original em caso de erro
            with open(file_path, 'wb') as f:
                f.write(signature_bytes)
        
        # Retornar caminho relativo para armazenar no banco
        return f"signatures/{filename}"
        
    except Exception as e:
        print(f"Erro ao salvar assinatura: {e}")
        return None

def format_hours(hours: float) -> str:
	"""Formata as horas de forma legível (ex: 1h 20m, 45min)"""
	if hours < 1:
		minutes = int(hours * 60)
		return f"{minutes}min"
	else:
		hours_int = int(hours)
		minutes = int((hours - hours_int) * 60)
		if minutes == 0:
			return f"{hours_int}h"
		else:
			return f"{hours_int}h {minutes}m"

bp = Blueprint("tickets", __name__)


def _helpdesk_conversation_payload(ticket: Ticket) -> dict | None:
	try:
		link = HelpDeskTicketLink.query.filter_by(computicket_ticket_id=ticket.id).first()
	except Exception:
		return None
	if not link:
		return None
	payload = {
		"engine_ticket_id": link.engine_ticket_id,
		"href": f"/helpdesk?c={link.engine_ticket_id}",
	}
	try:
		conv = admin_request("GET", f"/tickets/{link.engine_ticket_id}") or {}
		contact = conv.get("contact") if isinstance(conv, dict) else {}
		contact = contact or {}
		payload["contact_name"] = contact.get("name")
		payload["contact_number"] = contact.get("number")
		payload["status"] = conv.get("status") if isinstance(conv, dict) else None
	except Exception:
		pass
	return payload


def _parse_bool_param(value) -> bool:
	if value is None:
		return False
	return str(value).strip().lower() in ("1", "true", "on", "yes")


def _build_tickets_query(
	*,
	status: str | None,
	assigned_to_id: int | None,
	q: str,
	date_from: str,
	date_to: str,
	ps_pending: bool = False,
	default_open_only: bool = True,
):
	"""Monta query de tickets com filtros compartilhados."""
	from sqlalchemy import or_

	query = Ticket.query

	if ps_pending:
		query = query.filter(
			Ticket.status == "fechado",
			or_(Ticket.ps_printed.is_(False), Ticket.ps_printed.is_(None)),
			Ticket.total_cost > 0,
		)
	elif status:
		query = query.filter(Ticket.status == status)
	elif default_open_only:
		query = query.filter(Ticket.status == "aberto")

	if assigned_to_id:
		query = query.filter(Ticket.assigned_to_id == assigned_to_id)
	if q:
		query = query.filter(
			(Ticket.title.ilike(f"%{q}%")) | (Ticket.external_client_name.ilike(f"%{q}%"))
		)

	if date_from:
		try:
			from datetime import datetime
			from ..timezone_utils import get_brasilia_tz, brasilia_to_utc
			date_from_dt = datetime.strptime(date_from, "%Y-%m-%d")
			date_from_dt = get_brasilia_tz().localize(date_from_dt)
			date_from_utc = brasilia_to_utc(date_from_dt)
			query = query.filter(Ticket.created_at >= date_from_utc)
		except ValueError:
			pass

	if date_to:
		try:
			from datetime import datetime
			from ..timezone_utils import get_brasilia_tz, brasilia_to_utc
			date_to_dt = datetime.strptime(date_to, "%Y-%m-%d")
			date_to_dt = date_to_dt.replace(hour=23, minute=59, second=59)
			date_to_dt = get_brasilia_tz().localize(date_to_dt)
			date_to_utc = brasilia_to_utc(date_to_dt)
			query = query.filter(Ticket.created_at <= date_to_utc)
		except ValueError:
			pass

	return query


def _ticket_filter_params_from_request():
	status = request.args.get("status")
	assigned_to_id = request.args.get("assigned_to_id", type=int)
	q = (request.args.get("q") or "").strip().lower()
	date_from = request.args.get("date_from", "").strip()
	date_to = request.args.get("date_to", "").strip()
	ps_pending = _parse_bool_param(request.args.get("ps_pending"))

	if not any([status, assigned_to_id, q, date_from, date_to, ps_pending]):
		status = request.cookies.get("tickets_filter_status")
		assigned_to_id = request.cookies.get("tickets_filter_technician", type=int)
		q = (request.cookies.get("tickets_filter_search") or "").strip().lower()
		date_from = request.cookies.get("tickets_filter_date_from", "").strip()
		date_to = request.cookies.get("tickets_filter_date_to", "").strip()
		ps_pending = _parse_bool_param(request.cookies.get("tickets_filter_ps_pending"))

	return {
		"status": status,
		"assigned_to_id": assigned_to_id,
		"q": q,
		"date_from": date_from,
		"date_to": date_to,
		"ps_pending": ps_pending,
	}


@bp.route("/")
@login_required
def list_tickets():
	params = _ticket_filter_params_from_request()
	status = params["status"]
	assigned_to_id = params["assigned_to_id"]
	q = params["q"]
	date_from = params["date_from"]
	date_to = params["date_to"]
	ps_pending = params["ps_pending"]
	page = request.args.get("page", 1, type=int)

	if ps_pending and not status:
		status = "fechado"

	query = _build_tickets_query(
		status=status,
		assigned_to_id=assigned_to_id,
		q=q,
		date_from=date_from,
		date_to=date_to,
		ps_pending=ps_pending,
		default_open_only=True,
	)
	
	# Aplicar paginação para tickets fechados ou filtro de PS pendente
	if status == "fechado" or ps_pending:
		per_page = 20  # 20 tickets por página
		pagination = query.order_by(Ticket.created_at.desc()).paginate(
			page=page, per_page=per_page, error_out=False
		)
		q_list = pagination.items
		has_pagination = True
		total_pages = pagination.pages
		current_page = pagination.page
	else:
		# Para outros status, manter comportamento atual (sem paginação)
		q_list = query.order_by(Ticket.created_at.desc()).all()
		pagination = None
		has_pagination = False
		total_pages = 1
		current_page = 1
	
	# Obter lista de usuários ativos para o dropdown de atribuição
	users = User.query.filter_by(status='1').order_by(User.name.asc()).all()
	
	# Mapa de clientes externos para auto-preencher dados no modal de impressão
	ext_clients = fetch_external_clients()
	ext_map = {c.get("id"): c for c in ext_clients}
	
	# Verificar se é uma requisição AJAX
	if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
		# Retornar apenas a parte da tabela para requisições AJAX
		return render_template("tickets/_tickets_table.html", 
			tickets=q_list, users=users, current_status=status or "aberto", ext_map=ext_map,
			has_pagination=has_pagination, pagination=pagination, current_page=current_page, total_pages=total_pages,
			current_filters={
				'status': status,
				'assigned_to_id': assigned_to_id,
				'q': q,
				'date_from': date_from,
				'date_to': date_to,
				'ps_pending': ps_pending,
			})
	
	return render_template("tickets/list.html", 
		tickets=q_list, users=users, current_status=status or "aberto", ext_map=ext_map,
		has_pagination=has_pagination, pagination=pagination, current_page=current_page, total_pages=total_pages,
		current_filters={
			'status': status,
			'assigned_to_id': assigned_to_id,
			'q': q,
			'date_from': date_from,
			'date_to': date_to,
			'ps_pending': ps_pending,
		})


@bp.route("/api/by-users")
@login_required
def tickets_by_users():
	"""Retorna tickets agrupados por usuário (respeitando filtros de status)"""
	params = _ticket_filter_params_from_request()
	status = params["status"]
	assigned_to_id = params["assigned_to_id"]
	q = params["q"]
	date_from = params["date_from"]
	date_to = params["date_to"]
	ps_pending = params["ps_pending"]

	if ps_pending:
		query = _build_tickets_query(
			status=status,
			assigned_to_id=assigned_to_id,
			q=q,
			date_from=date_from,
			date_to=date_to,
			ps_pending=True,
			default_open_only=False,
		)
	else:
		query = Ticket.query
		if status:
			query = query.filter(Ticket.status == status)
		else:
			query = query.filter(Ticket.status.in_(["aberto", "em_andamento"]))
		if assigned_to_id:
			query = query.filter(Ticket.assigned_to_id == assigned_to_id)
		if q:
			query = query.filter(
				(Ticket.title.ilike(f"%{q}%")) | (Ticket.external_client_name.ilike(f"%{q}%"))
			)
		if date_from:
			try:
				from datetime import datetime
				from ..timezone_utils import get_brasilia_tz, brasilia_to_utc
				date_from_dt = datetime.strptime(date_from, "%Y-%m-%d")
				date_from_dt = get_brasilia_tz().localize(date_from_dt)
				date_from_utc = brasilia_to_utc(date_from_dt)
				query = query.filter(Ticket.created_at >= date_from_utc)
			except ValueError:
				pass
		if date_to:
			try:
				from datetime import datetime
				from ..timezone_utils import get_brasilia_tz, brasilia_to_utc
				date_to_dt = datetime.strptime(date_to, "%Y-%m-%d")
				date_to_dt = date_to_dt.replace(hour=23, minute=59, second=59)
				date_to_dt = get_brasilia_tz().localize(date_to_dt)
				date_to_utc = brasilia_to_utc(date_to_dt)
				query = query.filter(Ticket.created_at <= date_to_utc)
			except ValueError:
				pass

	tickets = query.order_by(Ticket.created_at.desc()).all()
	
	# Agrupar por usuário
	users_tickets = {}
	for ticket in tickets:
		user_id = ticket.assigned_to_id
		if user_id not in users_tickets:
			users_tickets[user_id] = {
				'user': ticket.assigned_to_user,
				'tickets': []
			}
		users_tickets[user_id]['tickets'].append(ticket)
	
	# Converter para lista ordenada por nome do usuário, incluindo apenas usuários ativos
	users_list = []
	for user_id, data in users_tickets.items():
		# Só incluir se o usuário existir e estiver ativo (status = '1')
		if data['user'] and data['user'].status == '1':
			users_list.append({
				'user': data['user'],
				'tickets': data['tickets'],
				'total_tickets': len(data['tickets'])
			})
	
	# Ordenar por nome do usuário
	users_list.sort(key=lambda x: x['user'].name)
	
	# Mapa de clientes externos para auto-preencher dados no modal de impressão
	ext_clients = fetch_external_clients()
	ext_map = {c.get("id"): c for c in ext_clients}
	
	return render_template("tickets/_tickets_by_users.html", users_tickets=users_list, ext_map=ext_map)


@bp.route("/novo", methods=["GET", "POST"])
@login_required
def create_ticket():
	external_clients = fetch_external_clients()
	# Pesquisa server-side opcional
	q = (request.args.get("q") or "").strip().lower()
	if q:
		def match(c):
			name = (c.get("name") or "").lower()
			doc = (c.get("document") or "").lower()
			phone = (c.get("phone") or "").lower()
			email = (c.get("email") or "").lower()
			return q in name or q in doc or q in phone or q in email
		external_clients = [c for c in external_clients if match(c)]
	# Filtrar apenas usuários ativos (status = '1')
	users = User.query.filter_by(status='1').order_by(User.name.asc()).all()
	services = Service.query.order_by(Service.name.asc()).all()
	# Converter serviços para dicionários para serialização JSON
	services_dict = [{"id": s.id, "name": s.name, "hourly_rate": s.hourly_rate} for s in services]
	
	# Parâmetros de pré-preenchimento
	prefilled = {
		'title': request.args.get('title', ''),
		'description': request.args.get('description', ''),
		'solicitante': request.args.get('solicitante', ''),
		'external_client_id': request.args.get('external_client_id', type=int),
		'service_id': request.args.get('service_id', type=int),
		'parent_id': request.args.get('parent_id', type=int)
	}
	
	if request.method == "POST":
		title = request.form.get("title")
		description = request.form.get("description")
		external_client_id = request.form.get("external_client_id", type=int)
		solicitante = request.form.get("solicitante", "").strip()
		parent_id = request.form.get("parent_id", type=int)
		
		selected_ext = next((c for c in external_clients if c.get("id") == external_client_id), None)
		if not selected_ext:
			flash("Selecione um cliente antes de abrir o ticket.")
			return render_template("tickets/new.html", external_clients=external_clients, users=users, services=services, services_dict=services_dict, prefilled=prefilled)
		if not solicitante:
			flash("Informe o nome do solicitante.")
			return render_template("tickets/new.html", external_clients=external_clients, users=users, services=services, services_dict=services_dict, prefilled=prefilled)
		
		service_id = request.form.get("service_id", type=int)
		assigned_to_id = request.form.get("assigned_to_id", type=int)
		
		ticket = Ticket(
			title=title,
			description=description,
			external_client_id=external_client_id,
			external_client_name=selected_ext.get("name"),
			solicitante=solicitante,
			service_id=service_id,
			opened_by_id=current_user.id,
			assigned_to_id=assigned_to_id,
			parent_id=parent_id
		)
		db.session.add(ticket)
		db.session.commit()
		
		import logging
		logging.warning(f"✅ TICKET CRIADO - ID: {ticket.id}, Título: {ticket.title}, User: {current_user.name}")
		from ..notification_service import create_notifications, ticket_recipient_ids
		create_notifications(
			ticket_recipient_ids(ticket.assigned_to_id),
			notification_type="ticket",
			title=f"Novo ticket #{ticket.id}",
			message=f"{ticket.title} · {ticket.display_client_name() or 'Cliente não informado'}",
			url=f"/tickets/{ticket.id}",
			entity_type="ticket",
			entity_id=ticket.id,
		)
		
		# Enviar email de notificação para o técnico se atribuído
		if assigned_to_id:
			assigned_user = User.query.get(assigned_to_id)
			if assigned_user and assigned_user.email:
				from ..blueprints.utils import send_ticket_notification_email
				
				# Preparar dados do ticket para o email
				service = Service.query.get(service_id) if service_id else None
				ticket_data = {
					'id': ticket.id,
					'title': ticket.title,
					'description': ticket.description,
					'client_name': selected_ext.get("name"),
					'priority': 'media',  # Prioridade padrão, pode ser configurável
					'service_name': service.name if service else None,
					'created_at': ticket.created_at
				}
				
				# Enviar email de notificação
				send_ticket_notification_email(
					technician_email=assigned_user.email,
					technician_name=assigned_user.name,
					ticket_data=ticket_data
				)
		
		flash("Ticket aberto.")
		return redirect(url_for("tickets.list_tickets"))
	return render_template("tickets/new.html", external_clients=external_clients, users=users, services=services, services_dict=services_dict, prefilled=prefilled)


@bp.route("/<int:ticket_id>/continuar")
@login_required
def continue_ticket(ticket_id: int):
	"""Cria uma continuação de atendimento a partir de um ticket existente"""
	parent = Ticket.query.get_or_404(ticket_id)
	
	# Redirecionar para a página de criação com os dados pré-preenchidos
	return redirect(url_for('tickets.create_ticket', 
						   parent_id=parent.id,
						   title=f"Continuação: {parent.title}",
						   description=f"\n\n--- Continuação do Ticket #{parent.id} ---\nOriginal: {parent.description}",
						   external_client_id=parent.external_client_id,
						   solicitante=parent.solicitante,
						   service_id=parent.service_id))


@bp.route("/<int:ticket_id>")
@login_required
def view_ticket(ticket_id: int):
	from ..models import User
	
	t = Ticket.query.get_or_404(ticket_id)
	contract_info = None
	should_show_costs = True  # Por padrão, mostra custos
	
	# Buscar usuários ativos para o seletor de apontamento em grupo
	users = User.query.filter_by(status='1').order_by(User.name).all()
	
	client_phone = None
	if t.external_client_id:
		ext = fetch_external_clients()
		c = next((x for x in ext if x.get('id') == t.external_client_id), None)
		if c:
			client_phone = c.get('phone')
			contract_info = { 
				"contract_type": c.get("contract_type"), 
				"no_charge": c.get("no_charge"),
				"extra9": c.get("extra9"),
				"extra11": c.get("extra11")
			}
			
			# Verificar se deve mostrar custos
			should_show_costs = not c.get("no_charge", False)
			
			# Verificar se o serviço é contemplado por contrato específico
			if t.service_id and should_show_costs:
				from ..external_pg import client_has_contract_for_service
				if client_has_contract_for_service(t.external_client_id, t.service_id):
					should_show_costs = False
			
			# Verificação especial para serviço de manutenção interna (ID 5)
			if t.service_id == 5 and should_show_costs:
				extra9_contracts = c.get('extra9', '')
				extra11_contracts = c.get('extra11', '')
				
				# Se algum dos campos extra9 ou extra11 contém contrato de manutenção
				if extra9_contracts or extra11_contracts:
					should_show_costs = False
	elif t.client:
		client_phone = t.client.phone
	
	ps_pdf_filename = resolve_ticket_ps_filename(t)

	return render_template("tickets/view.html", 
		ticket=t, 
		contract_info=contract_info, 
		should_show_costs=should_show_costs,
		client_phone=client_phone,
		users=users,
		ps_pdf_filename=ps_pdf_filename,
	)


@bp.route("/<int:ticket_id>/start", methods=["POST"])
@login_required
def start_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	ticket.status = "em_andamento"
	ticket.assigned_to_id = current_user.id  # Atribuir o ticket ao usuário atual
	ticket.in_progress_started_at = brasilia_to_utc(get_brasilia_now())
	
	# Capturar dados de geolocalização se fornecidos
	latitude = request.form.get("latitude", type=float)
	longitude = request.form.get("longitude", type=float)
	address = request.form.get("address", "").strip()
	accuracy = request.form.get("accuracy", type=float)
	
	# Salvar dados de localização no ticket para referência
	if latitude and longitude:
		ticket.start_location_lat = latitude
		ticket.start_location_lng = longitude
		ticket.start_location_address = address
		ticket.start_location_accuracy = accuracy
	
	db.session.commit()
	flash("Ticket iniciado e atribuído a você.")
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/assume", methods=["POST"])
@login_required
def assume_ticket(ticket_id: int):
	"""Assumir ticket - transferir responsabilidade para o usuário logado"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Verificar se o ticket não está fechado ou cancelado
	if ticket.status in ['fechado', 'cancelado']:
		flash("Não é possível assumir um ticket fechado ou cancelado.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar se o ticket não está em andamento por outro usuário
	if ticket.status == 'em_andamento' and ticket.assigned_to_id != current_user.id:
		flash("Este ticket já está em andamento por outro usuário.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Transferir responsabilidade
	previous_user = ticket.assigned_to_user.name if ticket.assigned_to_user else "Ninguém"
	ticket.assigned_to_id = current_user.id
	
	# Se o ticket estava em andamento, parar a sessão anterior
	if ticket.status == 'em_andamento' and ticket.in_progress_started_at:
		# Criar entrada de tempo para a sessão anterior
		end_dt = brasilia_to_utc(get_brasilia_now())
		start_dt = ticket.in_progress_started_at
		
		# Garantir que ambos os datetimes tenham timezone
		if start_dt.tzinfo is None:
			from pytz import utc
			start_dt = utc.localize(start_dt)
		
		delta_hours = (end_dt - start_dt).total_seconds() / 3600.0
		entry = TimeEntry(
			ticket_id=ticket.id, 
			user_id=ticket.assigned_to_id,  # Usuário anterior
			hours=max(0.0, delta_hours), 
			comment=f"Ticket assumido por {current_user.name}",
			start_time=start_dt,
			end_time=end_dt
		)
		db.session.add(entry)
		
		# Limpar início da sessão anterior
		ticket.in_progress_started_at = None
	
	db.session.commit()
	flash(f"Ticket assumido com sucesso! (anteriormente atribuído a {previous_user})")
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/stop", methods=["POST"])
@login_required
def stop_ticket(ticket_id: int):
	import logging
	logging.warning(f"🚨 STOP_TICKET CHAMADO - Ticket ID: {ticket_id}, User: {current_user.name}, IP: {request.remote_addr}")
	
	ticket = Ticket.query.get_or_404(ticket_id)
	if not ticket.in_progress_started_at:
		logging.warning(f"🚨 STOP_TICKET - Ticket {ticket_id} não estava em andamento!")
		flash("Ticket não estava em andamento.")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Validar se o usuário atual é quem iniciou a sessão
	if ticket.assigned_to_id != current_user.id:
		flash("Apenas o usuário que iniciou a sessão pode encerrá-la.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	end_dt = brasilia_to_utc(get_brasilia_now())
	start_dt = ticket.in_progress_started_at
	
	# Garantir que ambos os datetimes tenham timezone
	if start_dt.tzinfo is None:
		# Se start_dt não tem timezone, assumir que é UTC (dados antigos)
		from pytz import utc
		start_dt = utc.localize(start_dt)
	
	delta_hours = (end_dt - start_dt).total_seconds() / 3600.0
	comment = request.form.get("comment")
	
	# Capturar dados de geolocalização se fornecidos
	latitude = request.form.get("latitude", type=float)
	longitude = request.form.get("longitude", type=float)
	address = request.form.get("address", "").strip()
	accuracy = request.form.get("accuracy", type=float)
	
	# Capturar dados de assinatura digital se fornecidos
	signature_data = request.form.get("signature_data", "").strip()
	signature_timestamp = None
	signature_file_path = None
	
	if signature_data:
		signature_timestamp = brasilia_to_utc(get_brasilia_now())
		# Salvar assinatura como arquivo
		signature_file_path = save_signature_file(signature_data, ticket.id, current_user.id)
		if signature_file_path:
			print(f"Assinatura salva em: {signature_file_path}")
		else:
			print("Erro ao salvar assinatura como arquivo")
	
	entry = TimeEntry(
		ticket_id=ticket.id, 
		user_id=current_user.id, 
		hours=max(0.0, delta_hours), 
		comment=comment or "Encerrado pelo botão",
		start_time=start_dt,
		end_time=end_dt,
		latitude=latitude,
		longitude=longitude,
		address=address,
		accuracy=accuracy,
		signature_data=signature_data if signature_data else None,
		signature_file_path=signature_file_path,
		signature_timestamp=signature_timestamp
	)
	
	logging.warning(f"🚨 TIMEENTRY CRIADO via STOP_TICKET - Ticket: {ticket_id}, Comment: '{comment or 'Encerrado pelo botão'}', Hours: {delta_hours}")
	db.session.add(entry)
	# Limpa início e volta para aberto (ou mantém em andamento até fechar?) aqui voltamos para aberto
	ticket.in_progress_started_at = None
	ticket.status = "aberto"
	db.session.commit()
	flash(f"Sessão encerrada. Apontado {delta_hours:.2f}h.")
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


def _wants_json() -> bool:
	if request.is_json:
		return True
	accept = (request.headers.get("Accept") or "").lower()
	return "application/json" in accept and "text/html" not in accept


def _request_values() -> dict:
	data = {}
	if request.form:
		data.update({k: request.form.get(k) for k in request.form.keys()})
	json_data = request.get_json(silent=True)
	if isinstance(json_data, dict):
		for k, v in json_data.items():
			if v is not None:
				data[k] = v
	return data


@bp.route("/<int:ticket_id>/apontar", methods=["POST"])
@login_required
def add_time(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	payload = _request_values()
	start_raw = str(payload.get("start_time") or "").strip() or None
	end_raw = str(payload.get("end_time") or "").strip() or None
	comment = payload.get("comment")
	wants_json = _wants_json() or request.is_json

	# Verificar se é um apontamento em grupo
	is_group_entry = str(payload.get("is_group_entry") or "").lower() in {"on", "1", "true"}
	group_users = request.form.getlist("group_users")
	if not group_users:
		raw_group = payload.get("group_users") or []
		if isinstance(raw_group, list):
			group_users = raw_group
		elif raw_group:
			group_users = [raw_group]
	
	# Debug logs
	import logging
	logging.info(f"add_time called - ticket_id: {ticket_id}")
	logging.info(f"start_raw: '{start_raw}' (type: {type(start_raw)}, len: {len(start_raw) if start_raw else 0})")
	logging.info(f"end_raw: '{end_raw}' (type: {type(end_raw)}, len: {len(end_raw) if end_raw else 0})")
	logging.info(f"comment: {comment}")
	logging.info(f"All form data: {dict(request.form)}")
	
	start_dt = None
	end_dt = None
	
	# Tentar diferentes métodos de parsing
	try:
		# Método 1: Campos hidden com datetime completo
		if start_raw and end_raw:
			logging.info(f"Trying to parse hidden fields: start='{start_raw}', end='{end_raw}'")
			
			# Tentar vários formatos possíveis
			formats_to_try = [
				"%Y-%m-%dT%H:%M:%S",  # 2024-01-15T14:30:00
				"%Y-%m-%dT%H:%M",     # 2024-01-15T14:30
				"%Y-%m-%d %H:%M:%S",  # 2024-01-15 14:30:00
				"%Y-%m-%d %H:%M",     # 2024-01-15 14:30
			]
			
			parsed = False
			for fmt in formats_to_try:
				try:
					start_dt = datetime.strptime(start_raw, fmt)
					end_dt = datetime.strptime(end_raw, fmt)
					logging.info(f"Successfully parsed using format: {fmt}")
					parsed = True
					break
				except ValueError:
					continue
			
			if not parsed:
				# Tentar fromisoformat como último recurso
				try:
					start_dt = datetime.fromisoformat(start_raw)
					end_dt = datetime.fromisoformat(end_raw)
					logging.info("Parsed using fromisoformat")
					parsed = True
				except ValueError:
					logging.warning("Failed to parse hidden fields with all methods")
		
		# Método 2: Campos individuais (fallback)
		if not start_dt or not end_dt:
			work_date = payload.get("work_date")
			start_time = payload.get("start_time_individual")
			end_time = payload.get("end_time_individual")
			
			logging.info(f"Trying individual fields - work_date: '{work_date}', start_time: '{start_time}', end_time: '{end_time}'")
			
			if work_date and start_time and end_time:
				try:
					start_dt = datetime.strptime(f"{work_date} {start_time}", "%Y-%m-%d %H:%M")
					end_dt = datetime.strptime(f"{work_date} {end_time}", "%Y-%m-%d %H:%M")
					logging.info("Parsed using individual fields")
				except ValueError as e:
					logging.error(f"Failed to parse individual fields: {e}")
		
		logging.info(f"Final parsed start_dt: {start_dt}")
		logging.info(f"Final parsed end_dt: {end_dt}")
		
	except Exception as e:
		logging.error(f"Error parsing datetime: {e}")
		logging.error(f"start_raw was: '{start_raw}'")
		logging.error(f"end_raw was: '{end_raw}'")
		start_dt = None
		end_dt = None
	
	if not start_dt or not end_dt:
		if wants_json:
			return jsonify({"error": "Informe horário inicial e final válidos."}), 400
		flash("Informe horário inicial e final válidos.")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Garantir que ambos os datetimes tenham timezone
	if start_dt.tzinfo is None:
		# Se não tem timezone, assumir o fuso do sistema (vem do formulário)
		from ..timezone_utils import get_brasilia_tz
		start_dt = get_brasilia_tz().localize(start_dt)
	if end_dt.tzinfo is None:
		from ..timezone_utils import get_brasilia_tz
		end_dt = get_brasilia_tz().localize(end_dt)
	
	delta_hours = (end_dt - start_dt).total_seconds() / 3600.0
	logging.info(f"Calculated delta_hours: {delta_hours}")
	
	if delta_hours <= 0:
		logging.warning(f"Invalid time range: delta_hours = {delta_hours}")
		if wants_json:
			return jsonify({"error": "Horário final deve ser maior que o inicial."}), 400
		flash("Horário final deve ser maior que o inicial.")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar se o cliente tem contrato que contempla o serviço
	from ..external_pg import client_has_contract_for_service
	has_contract = False
	contract_reason = ""
	
	if ticket.external_client_id and ticket.service_id:
		# Verificar contrato específico do serviço
		has_contract = client_has_contract_for_service(ticket.external_client_id, ticket.service_id)
		if has_contract:
			contract_reason = "Serviço contemplado por contrato específico"
		
		# Verificação especial para serviço de manutenção interna (ID 5)
		if ticket.service_id == 5 and not has_contract:
			# Buscar dados do cliente para verificar extra9 e extra11
			ext_clients = fetch_external_clients()
			c = next((x for x in ext_clients if x.get('id') == ticket.external_client_id), None)
			
			if c:
				# Verificar flag de isenção geral (extra10)
				if c.get('no_charge'):
					has_contract = True
					contract_reason = "Contrato com isenção geral"
				
				# Verificar contratos em extra9 e extra11
				extra9_contracts = c.get('extra9', '')
				extra11_contracts = c.get('extra11', '')
				
				# Se algum dos campos extra9 ou extra11 contém contrato de manutenção
				if extra9_contracts or extra11_contracts:
					has_contract = True
					contract_reason = "Manutenção interna contemplada por contrato (extra9/extra11)"
		
		logging.info(f"Client {ticket.external_client_id} has contract for service {ticket.service_id}: {has_contract} - {contract_reason}")

	def _as_float(key):
		raw = payload.get(key)
		if raw in (None, ""):
			return None
		try:
			return float(raw)
		except (TypeError, ValueError):
			return None

	# Capturar dados de geolocalização se fornecidos
	latitude = _as_float("latitude")
	longitude = _as_float("longitude")
	address = str(payload.get("address") or "").strip()
	accuracy = _as_float("accuracy")
	
	# Capturar dados de assinatura digital se fornecidos
	signature_data = str(payload.get("signature_data") or "").strip()
	signature_timestamp = None
	signature_file_path = None
	
	if signature_data:
		signature_timestamp = brasilia_to_utc(get_brasilia_now())
		# Salvar assinatura como arquivo
		signature_file_path = save_signature_file(signature_data, ticket_id, current_user.id)
		if signature_file_path:
			print(f"Assinatura salva em: {signature_file_path}")
		else:
			print("Erro ao salvar assinatura como arquivo")
	
	# Função auxiliar para criar uma entrada de tempo
	def create_time_entry(user_id, is_current_user=True):
		signature_to_use = signature_data if is_current_user else None
		signature_path_to_use = signature_file_path if is_current_user else None
		signature_ts_to_use = signature_timestamp if is_current_user else None
		
		entry = TimeEntry(
			ticket_id=ticket_id, 
			user_id=user_id, 
			hours=delta_hours, 
			comment=comment,
			start_time=brasilia_to_utc(start_dt),
			end_time=brasilia_to_utc(end_dt),
			no_charge=has_contract,  # Não cobrar se tem contrato que contempla o serviço
			latitude=latitude,
			longitude=longitude,
			address=address,
			accuracy=accuracy,
			signature_data=signature_to_use,
			signature_file_path=signature_path_to_use,
			signature_timestamp=signature_ts_to_use
		)
		db.session.add(entry)
		return entry
	
	# Criar entrada para o usuário atual
	entries_created = 1
	create_time_entry(current_user.id, is_current_user=True)
	
	# Se for apontamento em grupo, criar entradas para os usuários selecionados
	if is_group_entry and group_users:
		from ..models import User
		
		# Remover o usuário atual da lista de grupo, se estiver lá
		group_users = [uid for uid in group_users if int(uid) != current_user.id]
		
		# Criar entradas para cada usuário do grupo
		for user_id in group_users:
			try:
				# Verificar se o usuário existe e está ativo
				user = User.query.filter_by(id=user_id, status='1').first()
				if user:
					create_time_entry(user_id, is_current_user=False)
					entries_created += 1
			except Exception as e:
				logging.error(f"Erro ao criar apontamento para usuário {user_id}: {str(e)}")
	
	# Commit de todas as entradas
	try:
		db.session.commit()
		
		if entries_created > 1:
			if has_contract:
				flash(f"{entries_created} apontamentos registrados (sem cobrança - contemplado por contrato).")
			else:
				flash(f"{entries_created} apontamentos registrados com sucesso!")
		else:
			if has_contract:
				if contract_reason:
					flash(f"Apontamento registrado: {format_hours(delta_hours)} (sem cobrança - {contract_reason}).")
				else:
					flash(f"Apontamento registrado: {format_hours(delta_hours)} (sem cobrança - contemplado por contrato).")
			else:
				flash(f"Apontamento registrado: {format_hours(delta_hours)}.")
		
	except Exception as e:
		db.session.rollback()
		logging.error(f"Erro ao salvar apontamentos: {str(e)}")
		if wants_json:
			return jsonify({"error": "Ocorreu um erro ao salvar os apontamentos. Por favor, tente novamente."}), 500
		flash("Ocorreu um erro ao salvar os apontamentos. Por favor, tente novamente.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))

	if wants_json:
		return jsonify(_serialize_ticket_detail(ticket))
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


def _ticket_contract_no_charge(ticket: Ticket) -> tuple[bool, str]:
	no_charge = False
	contract_reason = ""
	if not ticket.external_client_id:
		return no_charge, contract_reason

	try:
		c = get_external_client_by_id(ticket.external_client_id)
		if not c:
			return no_charge, contract_reason

		no_charge = bool(c.get("no_charge")) if c.get("no_charge") is not None else False
		if no_charge:
			contract_reason = "Contrato com isenção geral"

		from ..external_pg import client_has_contract_for_service
		if ticket.service_id and client_has_contract_for_service(ticket.external_client_id, ticket.service_id):
			no_charge = True
			contract_reason = "Serviço contemplado por contrato específico"

		if ticket.service_id == 5:
			if c.get("contract_type") or c.get("extra9") or c.get("extra11"):
				no_charge = True
				contract_reason = "Manutenção interna contemplada por contrato (extra9/extra11)"

		return no_charge, contract_reason
	except Exception:
		return False, ""


def _calculate_ticket_total_cost(ticket: Ticket, *, force_charge: bool, manual) -> tuple[float, bool, str]:
	no_charge, contract_reason = _ticket_contract_no_charge(ticket)
	if force_charge:
		no_charge = False

	total_hours = ticket.total_hours()
	hourly = ticket.service.hourly_rate if ticket.service else 0.0

	if no_charge:
		return 0.0, no_charge, contract_reason
	if manual is not None:
		return float(max(0.0, manual)), no_charge, contract_reason
	return float(total_hours * (hourly or 0.0)), no_charge, contract_reason


def _replace_ticket_products(ticket: Ticket, product_details: list[dict]) -> None:
	TicketProduct.query.filter_by(ticket_id=ticket.id).delete()
	for p in product_details:
		db.session.add(TicketProduct(
			ticket_id=ticket.id,
			product_id=p["id"],
			codigo=p.get("codigo"),
			nome=p["nome"],
			unidademedida=p.get("unidademedida"),
			preco=p.get("preco", 0.0),
			quantidade=p.get("quantidade", 0.0),
		))


def _ticket_products_payload(ticket: Ticket) -> list[dict]:
	return [{"id": p.product_id, "quantidade": p.quantidade} for p in ticket.products]


def _send_ticket_whatsapp(ticket: Ticket, send_whatsapp: bool, whatsapp_number: str | None, whatsapp_message: str | None) -> str | None:
	if whatsapp_message:
		current_user.whatsapp_message_template = whatsapp_message

	if not send_whatsapp:
		return None
	if not whatsapp_number:
		return "Número de WhatsApp não fornecido."

	import re
	import json
	import requests

	clean_phone = re.sub(r"\D", "", str(whatsapp_number))
	if len(clean_phone) < 10:
		return "O número de WhatsApp fornecido é inválido ou incompleto."

	client_name = ticket.display_client_name()
	formatted_msg = (whatsapp_message or "").replace("{cliente}", client_name)\
		.replace("{ticket_id}", str(ticket.id))\
		.replace("{valor}", f"{ticket.total_cost:.2f}")

	try:
		response = requests.post(
			"https://api.compuchat.cloud/api/messages/send",
			data=json.dumps({"number": clean_phone, "body": formatted_msg}),
			headers={
				"Content-Type": "application/json",
				"Authorization": "Bearer c3lzdGVtY2FsbGdlbmVyYXRlYnVyc3RlbGVtZW50",
			},
			timeout=10,
		)
		if response.status_code in [200, 201]:
			return "WhatsApp enviado com sucesso."
		return f"Erro ao enviar WhatsApp: {response.text}"
	except Exception as e:
		return f"Erro na conexão com API WhatsApp: {str(e)}"


@bp.route("/produtos")
@login_required
def search_ticket_products():
	try:
		q = request.args.get("q", "").strip()
		products = search_products_pg(q)
		return jsonify({"products": products})
	except ConnectionError as e:
		return jsonify({"error": str(e)}), 500
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar produtos: {str(e)}"}), 500


@bp.route("/<int:ticket_id>/produtos", methods=["GET"])
@login_required
def list_ticket_products(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	return jsonify({
		"products": [p.to_dict() for p in ticket.products],
		"dav_id": ticket.dav_id,
		"dav_codigo": ticket.dav_codigo,
		"editable": ticket.status not in ("fechado", "cancelado"),
	})


@bp.route("/<int:ticket_id>/produtos", methods=["PUT"])
@login_required
def save_ticket_products(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if ticket.status in ("fechado", "cancelado"):
		return jsonify({"error": "Não é possível alterar produtos de um ticket fechado ou cancelado."}), 400

	data = request.get_json() or {}
	produtos = data.get("produtos", [])

	if not produtos:
		TicketProduct.query.filter_by(ticket_id=ticket.id).delete()
		db.session.commit()
		return jsonify({"message": "Produtos removidos.", "products": []})

	conn = connect_postgres()
	if not conn:
		return jsonify({"error": "Erro de conexão com o banco de faturamento"}), 500

	cursor = conn.cursor()
	try:
		product_details, product_error = validate_products(cursor, produtos)
		if product_error:
			return jsonify({"error": product_error}), 400
		_replace_ticket_products(ticket, product_details or [])
		db.session.commit()
		return jsonify({
			"message": "Produtos salvos com sucesso.",
			"products": [p.to_dict() for p in ticket.products],
		})
	finally:
		cursor.close()
		conn.close()


@bp.route("/<int:ticket_id>/processar-fechamento", methods=["POST"])
@login_required
def process_ticket_close(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if not ticket.time_entries:
		return jsonify({"error": "Adicione ao menos um apontamento antes de fechar o ticket."}), 400
	if ticket.status == "fechado":
		return jsonify({"error": "Ticket já está fechado."}), 400
	if ticket.status == "cancelado":
		return jsonify({"error": "Ticket cancelado não pode ser fechado."}), 400

	data = request.get_json() or {}
	force_charge = bool(data.get("force_charge"))
	manual = data.get("manual_total_cost")
	if manual is not None and manual != "":
		manual = float(manual)
	else:
		manual = None

	produtos = data.get("produtos")
	if produtos is None:
		produtos = _ticket_products_payload(ticket)

	product_details: list[dict] = []
	dav_id = None
	dav_codigo = None

	if produtos:
		if not ticket.external_client_id:
			return jsonify({"error": "Cliente externo não informado no ticket. Não é possível criar pedido de faturamento sem cliente."}), 400

		conn = connect_postgres()
		if not conn:
			return jsonify({"error": "Erro de conexão com o banco de faturamento"}), 500

		cursor = conn.cursor()
		original_autocommit = conn.autocommit
		conn.autocommit = False
		try:
			conn.rollback()
			product_details, product_error = validate_products(cursor, produtos)
			if product_error:
				return jsonify({"error": product_error}), 400
			product_details = product_details or []

			if product_details:
				dav_id, dav_codigo = create_dav(
					cursor,
					client_id=ticket.external_client_id,
					reference_label="Ticket",
					reference_code=str(ticket.id),
					product_details=product_details,
					local_user=current_user,
				)
			conn.commit()
		except ValueError as e:
			conn.rollback()
			return jsonify({"error": str(e)}), 400
		except Exception as e:
			conn.rollback()
			return jsonify({"error": f"Erro ao criar pedido de faturamento: {str(e)}"}), 500
		finally:
			if not conn.closed:
				conn.autocommit = original_autocommit
			cursor.close()
			conn.close()

	total_cost, no_charge, contract_reason = _calculate_ticket_total_cost(
		ticket, force_charge=force_charge, manual=manual,
	)
	ticket.total_cost = total_cost
	ticket.status = "fechado"
	ticket.closed_at = brasilia_to_utc(get_brasilia_now())

	if product_details:
		_replace_ticket_products(ticket, product_details)
		ticket.dav_id = dav_id
		ticket.dav_codigo = dav_codigo
		for item in ticket.products:
			item.dav_id = dav_id
			item.dav_codigo = dav_codigo
	else:
		TicketProduct.query.filter_by(ticket_id=ticket.id).delete()
		ticket.dav_id = None
		ticket.dav_codigo = None

	whatsapp_status = _send_ticket_whatsapp(
		ticket,
		bool(data.get("send_whatsapp")),
		data.get("whatsapp_number"),
		data.get("whatsapp_message"),
	)

	db.session.commit()

	total_hours = ticket.total_hours()
	message = "Ticket fechado com sucesso."
	if dav_codigo:
		message += f" Pedido de faturamento #{dav_codigo} criado."

	return jsonify({
		"message": message,
		"whatsapp_status": whatsapp_status,
		"dav_id": dav_id,
		"dav_codigo": dav_codigo,
		"no_charge": no_charge,
		"contract_reason": contract_reason,
		"total_cost": ticket.total_cost,
		"total_hours": format_hours(total_hours),
		"products": [p.to_dict() for p in ticket.products],
	})


@bp.route("/<int:ticket_id>/fechar", methods=["POST"])
@login_required
def close_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if not ticket.time_entries or len(ticket.time_entries) == 0:
		flash("Adicione ao menos um apontamento antes de fechar o ticket.")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))

	force_charge = request.form.get("force_charge") == "1"
	manual = request.form.get("manual_total_cost", type=float)
	total_hours = ticket.total_hours()

	ticket.total_cost, no_charge, contract_reason = _calculate_ticket_total_cost(
		ticket, force_charge=force_charge, manual=manual,
	)
	ticket.status = "fechado"
	ticket.closed_at = brasilia_to_utc(get_brasilia_now())

	whatsapp_status = _send_ticket_whatsapp(
		ticket,
		request.form.get("send_whatsapp") == "on",
		request.form.get("whatsapp_number"),
		request.form.get("whatsapp_message"),
	)

	db.session.commit()
	notify_helpdesk_ticket(ticket.id, f"Ticket #{ticket.id} encerrado", internal=True)
	
	if whatsapp_status:
		flash(whatsapp_status, "info")
	if no_charge:
		# Mostrar mensagem específica baseada no motivo do contrato
		if contract_reason:
			flash(f"Ticket fechado. {contract_reason}: sem cobrança. Horas: {format_hours(total_hours)}")
		else:
			flash(f"Ticket fechado. Sem cobrança por contrato. Horas: {format_hours(total_hours)}")
	elif manual is not None:
		flash(f"Ticket fechado. Horas: {format_hours(total_hours)} | Custo definido manualmente: R$ {ticket.total_cost:.2f}")
	else:
		flash(f"Ticket fechado. Horas: {format_hours(total_hours)} | Custo: R$ {ticket.total_cost:.2f}")
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/cancelar", methods=["POST"])
@login_required
def cancel_ticket(ticket_id: int):
	"""Cancela um ticket (apenas se não foi fechado) e apaga todos os apontamentos"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Verificar se o ticket pode ser cancelado
	if ticket.status == "fechado":
		flash("Não é possível cancelar um ticket que já foi fechado.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Contar apontamentos antes de apagar
	apontamentos_count = len(ticket.time_entries)
	
	# Obter motivo do cancelamento
	cancel_reason = request.form.get("cancel_reason", "").strip()
	
	# Apagar todos os apontamentos do ticket
	for entry in ticket.time_entries:
		db.session.delete(entry)
	
	# Atualizar status do ticket para cancelado
	ticket.status = "cancelado"
	ticket.closed_at = brasilia_to_utc(get_brasilia_now())
	ticket.closed_by_id = current_user.id
	
	# Salvar motivo do cancelamento no comentário se fornecido
	if cancel_reason:
		ticket.comment = f"TICKET CANCELADO - Motivo: {cancel_reason}"
	
	# Limpar campos de andamento
	ticket.in_progress_started_at = None
	
	db.session.commit()
	
	# Mensagem de sucesso
	if apontamentos_count > 0:
		flash(f"Ticket cancelado com sucesso. {apontamentos_count} apontamento(s) removido(s).", "success")
	else:
		flash("Ticket cancelado com sucesso.", "success")
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/reabrir", methods=["POST"])
@login_required
def reopen_ticket(ticket_id: int):
	"""Reabre um ticket fechado (apenas se fechado há menos de 7 dias)"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Verificar se o ticket está fechado
	if ticket.status != "fechado":
		flash("Apenas tickets fechados podem ser reabertos.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar permissão de admin
	if not current_user.has_role('admin'):
		flash("Apenas administradores podem reabrir tickets.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar se o ticket foi fechado há menos de 7 dias
	if not ticket.closed_at:
		flash("Não foi possível determinar quando o ticket foi fechado.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Calcular diferença de tempo
	now = get_brasilia_now()
	closed_at_brasilia = utc_to_brasilia(ticket.closed_at)
	time_diff = now - closed_at_brasilia
	
	# Verificar se passou de 7 dias
	if time_diff.days >= 7:
		flash(f"Ticket não pode ser reaberto. Foi fechado há {time_diff.days} dias. Máximo permitido: 7 dias.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Obter motivo da reabertura
	reopen_reason = request.form.get("reopen_reason", "").strip()
	
	# Reabrir o ticket
	ticket.status = "aberto"
	ticket.closed_at = None  # Limpar data de fechamento
	ticket.in_progress_started_at = None  # Limpar início de andamento
	
	# Adicionar comentário sobre a reabertura
	original_description = ticket.description or ""
	reopen_comment = f"TICKET REABERTO - Motivo: {reopen_reason}" if reopen_reason else "TICKET REABERTO"
	
	if original_description:
		ticket.description = f"{original_description}\n\n{reopen_comment}"
	else:
		ticket.description = reopen_comment
	
	db.session.commit()
	
	# Mensagem de sucesso
	days_ago = time_diff.days
	hours_ago = time_diff.seconds // 3600
	if days_ago > 0:
		time_str = f"{days_ago} dia{'s' if days_ago > 1 else ''}"
	else:
		time_str = f"{hours_ago} hora{'s' if hours_ago > 1 else ''}"
	
	flash(f"Ticket reaberto com sucesso! Foi fechado há {time_str}.", "success")
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/observations")
@login_required
def get_ticket_observations(ticket_id: int):
	"""Retorna as observações dos apontamentos de um ticket"""
	from ..models import TimeEntry
	time_entries = TimeEntry.query.filter_by(ticket_id=ticket_id).all()
	observations = [entry.comment for entry in time_entries if entry.comment]
	return {"observations": observations}


@bp.route("/<int:ticket_id>/client-data")
@login_required
def get_ticket_client_data(ticket_id: int):
	"""Retorna os dados do cliente externo de um ticket"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	if not ticket.external_client_id:
		return jsonify({"error": "Ticket não possui cliente externo"}), 404
	
	# Buscar dados do cliente no PostgreSQL
	try:
		from .utils import connect_postgres
		conn = connect_postgres()
		if not conn:
			return jsonify({"error": "Erro ao conectar com banco externo"}), 500
		
		cursor = conn.cursor()
		cursor.execute("""
			SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra9, extra10 
			FROM entidade 
			WHERE id = %s
		""", (ticket.external_client_id,))
		row = cursor.fetchone()
		
		if row:
			client_data = {
				"id": row[0],
				"name": row[1],
				"document": row[2],
				"phone": row[3],
				"email": row[4],
				"address": row[5],
				"address_number": row[6],
				"contract_type": row[7],
				"no_charge": bool(row[8]) if row[8] is not None else False
			}
			cursor.close()
			conn.close()
			return jsonify(client_data)
		else:
			cursor.close()
			conn.close()
			return jsonify({"error": "Cliente não encontrado"}), 404
			
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar cliente: {str(e)}"}), 500


@bp.route("/<int:ticket_id>/can-print")
@login_required
def can_print_ticket(ticket_id: int):
	"""Verifica se o ticket pode ser impresso (tem cobrança e não tem flag 'não cobra atendimento')"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Verificar se a PS já foi impressa
	if ticket.ps_printed:
		return jsonify({"can_print": False, "reason": "PS já foi impressa anteriormente"})
	
	# Só pode imprimir se ticket está fechado e tem custo
	if ticket.status != 'fechado' or not ticket.total_cost or ticket.total_cost <= 0:
		return jsonify({"can_print": False, "reason": "Ticket não fechado ou sem custo"})
	
	# Se não tem external_client_id, pode imprimir se tem custo
	if not ticket.external_client_id:
		return jsonify({"can_print": True, "reason": "Ticket com custo"})
	
	# Verificar flag "não cobra atendimento" no contrato
	try:
		from .utils import connect_postgres
		conn = connect_postgres()
		if not conn:
			return jsonify({"can_print": True, "reason": "Erro ao conectar - assumindo que pode imprimir"})
		
		cursor = conn.cursor()
		cursor.execute("SELECT extra10 FROM entidade WHERE id = %s", (ticket.external_client_id,))
		row = cursor.fetchone()
		
		if row:
			no_charge = bool(row[0]) if row[0] is not None else False
			cursor.close()
			conn.close()
			
			if no_charge:
				return jsonify({"can_print": False, "reason": "Contrato com flag 'não cobra atendimento'"})
			else:
				return jsonify({"can_print": True, "reason": "Ticket com custo e sem flag 'não cobra atendimento'"})
		else:
			cursor.close()
			conn.close()
			return jsonify({"can_print": True, "reason": "Cliente não encontrado - assumindo que pode imprimir"})
			
	except Exception as e:
		return jsonify({"can_print": True, "reason": f"Erro ao verificar contrato: {str(e)} - assumindo que pode imprimir"})


@bp.route("/api/notifications")
@login_required
def get_notifications():
	"""API para verificar novos tickets não visualizados"""
	try:
		# Buscar tickets não vistos para o usuário atual
		unseen_tickets = Ticket.query.filter(
			Ticket.assigned_to_id == current_user.id,
			Ticket.visto == False
		).order_by(Ticket.created_at.desc()).all()
		
		notifications = []
		for ticket in unseen_tickets:
			notifications.append({
				"id": ticket.id,
				"title": ticket.title,
				"client_name": ticket.display_client_name(),
				"status": ticket.status,
				"created_at": ticket.created_at.isoformat(),
				"url": url_for("tickets.view_ticket", ticket_id=ticket.id)
			})
		
		return jsonify({
			"count": len(notifications),
			"notifications": notifications
		})
		
	except Exception as e:
		return jsonify({"error": str(e)}), 500


@bp.route("/api/mark-as-seen", methods=["POST"])
@login_required
def mark_as_seen():
	"""API para marcar tickets como visualizados"""
	try:
		data = request.get_json()
		ticket_ids = data.get("ticket_ids", [])
		
		if not ticket_ids:
			return jsonify({"error": "Nenhum ticket especificado"}), 400
		
		# Marcar tickets como vistos
		updated_count = Ticket.query.filter(
			Ticket.id.in_(ticket_ids),
			Ticket.assigned_to_id == current_user.id
		).update({Ticket.visto: True}, synchronize_session=False)
		
		db.session.commit()
		
		return jsonify({
			"success": True,
			"updated_count": updated_count
		})
		
	except Exception as e:
		db.session.rollback()
		return jsonify({"error": str(e)}), 500


@bp.route("/<int:ticket_id>/mark-seen", methods=["POST"])
@login_required
def mark_ticket_seen(ticket_id: int):
	"""Marcar um ticket específico como visualizado"""
	try:
		ticket = Ticket.query.get_or_404(ticket_id)
		
		# Verificar se o usuário tem permissão para marcar este ticket
		if ticket.assigned_to_id != current_user.id:
			return jsonify({"error": "Sem permissão para marcar este ticket"}), 403
		
		ticket.visto = True
		db.session.commit()
		
		return jsonify({"success": True})
		
	except Exception as e:
		db.session.rollback()
		return jsonify({"error": str(e)}), 500


def resolve_ticket_ps_filename(ticket: Ticket) -> str | None:
	return ticket.resolved_ps_filename()


@bp.route("/<int:ticket_id>/ver-ps")
@login_required
def view_ticket_ps(ticket_id: int):
	"""Abre o PDF da PS do ticket em nova aba (via redirect interno)."""
	ticket = Ticket.query.get_or_404(ticket_id)
	filename = resolve_ticket_ps_filename(ticket)
	if not filename:
		flash("Arquivo da PS não encontrado para este ticket.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	return redirect(url_for("tickets.serve_pdf", filename=filename))


@bp.route("/pdf/<filename>")
@login_required
def serve_pdf(filename):
	"""Serve PDF files for printing"""
	try:
		# Caminho base da pasta PS (caminho absoluto)
		from .ps import _ps_root, find_ps_file_path
		ps_path = _ps_root()
		
		# Verificar se o arquivo existe na pasta ps-do-dia
		pdf_path = ps_path / "ps-do-dia" / filename
		if not pdf_path.exists():
			found = find_ps_file_path(filename)
			if found:
				pdf_path = found
			else:
				return jsonify({"error": "Arquivo PDF não encontrado"}), 404
		
		# Verificar se o arquivo está dentro da pasta PS
		if not pdf_path.resolve().is_relative_to(ps_path.resolve()):
			return jsonify({"error": "Acesso negado"}), 403
		
		# Enviar o arquivo PDF
		return send_file(str(pdf_path), as_attachment=False, mimetype='application/pdf')
		
	except Exception as e:
		return jsonify({"error": f"Erro ao abrir PDF: {str(e)}"}), 500


@bp.route("/<int:ticket_id>/edit")
@login_required
def edit_ticket(ticket_id: int):
	"""Página de edição de ticket"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Verificar se o ticket pode ser editado (não finalizado)
	if ticket.status == "fechado":
		flash("Tickets fechados não podem ser editados.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Buscar dados para o formulário
	users = User.query.filter_by(status="1").order_by(User.name.asc()).all()
	services = Service.query.order_by(Service.name.asc()).all()
	clients = Client.query.order_by(Client.name.asc()).all()
	
	# Buscar clientes externos
	ext_clients = fetch_external_clients()
	
	return render_template("tickets/edit.html", 
		ticket=ticket,
		users=users,
		services=services,
		clients=clients,
		ext_clients=ext_clients
	)


@bp.route("/<int:ticket_id>/edit", methods=["POST"])
@login_required
def update_ticket(ticket_id: int):
	"""Atualizar ticket"""
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Verificar se o ticket pode ser editado (não finalizado)
	if ticket.status == "fechado":
		flash("Tickets fechados não podem ser editados.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	try:
		# Atualizar campos básicos
		ticket.title = request.form.get("title", "").strip()
		ticket.description = request.form.get("description", "").strip()
		ticket.assigned_to_id = request.form.get("assigned_to_id", type=int)
		ticket.service_id = request.form.get("service_id", type=int)
		
		# Atualizar cliente
		client_id = request.form.get("client_id", type=int)
		if client_id:
			ticket.client_id = client_id
			ticket.external_client_id = None
			ticket.external_client_name = None
		else:
			ticket.client_id = None
			ext_client_id = request.form.get("external_client_id", type=int)
			if ext_client_id:
				ticket.external_client_id = ext_client_id
				# Buscar nome do cliente externo
				ext_clients = fetch_external_clients()
				ext_client = next((c for c in ext_clients if c.get("id") == ext_client_id), None)
				if ext_client:
					ticket.external_client_name = ext_client.get("name", "")
		
		# Atualizar contrato
		contract_id = request.form.get("contract_id", type=int)
		ticket.contract_id = contract_id if contract_id else None
		
		db.session.commit()
		flash("Ticket atualizado com sucesso!", "success")
		
	except Exception as e:
		db.session.rollback()
		flash(f"Erro ao atualizar ticket: {str(e)}", "error")
	
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/time-entry/<int:entry_id>/edit")
@login_required
def edit_time_entry(ticket_id: int, entry_id: int):
	"""Página de edição de apontamento"""
	ticket = Ticket.query.get_or_404(ticket_id)
	time_entry = TimeEntry.query.get_or_404(entry_id)
	
	# Verificar se o ticket pode ser editado (não finalizado)
	if ticket.status == "fechado":
		flash("Apontamentos de tickets fechados não podem ser editados.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar se o apontamento pertence ao ticket
	if time_entry.ticket_id != ticket_id:
		flash("Apontamento não encontrado neste ticket.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	return render_template("tickets/edit_time_entry.html", 
		ticket=ticket,
		time_entry=time_entry
	)


@bp.route("/<int:ticket_id>/time-entry/<int:entry_id>/edit", methods=["POST"])
@login_required
def update_time_entry(ticket_id: int, entry_id: int):
	"""Atualizar apontamento"""
	ticket = Ticket.query.get_or_404(ticket_id)
	time_entry = TimeEntry.query.get_or_404(entry_id)
	
	# Verificar se o ticket pode ser editado (não finalizado)
	if ticket.status == "fechado":
		flash("Apontamentos de tickets fechados não podem ser editados.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar se o apontamento pertence ao ticket
	if time_entry.ticket_id != ticket_id:
		flash("Apontamento não encontrado neste ticket.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	try:
		# Atualizar comentário
		comment = request.form.get("comment", "").strip()
		time_entry.comment = comment
		
		# Atualizar datas e calcular horas automaticamente
		start_date = request.form.get("start_date")
		start_time = request.form.get("start_time")
		end_date = request.form.get("end_date")
		end_time = request.form.get("end_time")
		
		if not all([start_date, start_time, end_date, end_time]):
			flash("Todos os campos de data e hora são obrigatórios.", "error")
			return redirect(url_for("tickets.edit_time_entry", ticket_id=ticket_id, entry_id=entry_id))
		
		try:
			# Converter para datetime
			start_datetime_str = f"{start_date} {start_time}"
			end_datetime_str = f"{end_date} {end_time}"
			
			start_datetime = datetime.fromisoformat(start_datetime_str)
			end_datetime = datetime.fromisoformat(end_datetime_str)
			
			# Verificar se horário de fim é maior que início
			if end_datetime <= start_datetime:
				flash("Horário de fim deve ser maior que o de início.", "error")
				return redirect(url_for("tickets.edit_time_entry", ticket_id=ticket_id, entry_id=entry_id))
			
			# Calcular horas automaticamente
			delta_hours = (end_datetime - start_datetime).total_seconds() / 3600.0
			
			# Atualizar campos
			time_entry.start_time = brasilia_to_utc(start_datetime)
			time_entry.end_time = brasilia_to_utc(end_datetime)
			time_entry.hours = delta_hours
			
			db.session.commit()
			flash(f"Apontamento atualizado com sucesso! Duração: {format_hours(delta_hours)}", "success")
			
		except ValueError as e:
			flash("Data/hora inválida.", "error")
			return redirect(url_for("tickets.edit_time_entry", ticket_id=ticket_id, entry_id=entry_id))
		
	except Exception as e:
		db.session.rollback()
		flash(f"Erro ao atualizar apontamento: {str(e)}", "error")
	
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/<int:ticket_id>/time-entry/<int:entry_id>/delete", methods=["POST"])
@login_required
def delete_time_entry(ticket_id: int, entry_id: int):
	"""Deletar apontamento"""
	from flask import request
	import logging
	
	logging.info(f"delete_time_entry called: ticket_id={ticket_id}, entry_id={entry_id}")
	logging.info(f"Request headers: {dict(request.headers)}")
	
	ticket = Ticket.query.get_or_404(ticket_id)
	time_entry = TimeEntry.query.get_or_404(entry_id)
	
	logging.info(f"Ticket found: {ticket.id}, status: {ticket.status}")
	logging.info(f"Time entry found: {time_entry.id}, ticket_id: {time_entry.ticket_id}")
	
	# Verificar se o ticket pode ser editado (não finalizado)
	if ticket.status == "fechado":
		logging.info("Ticket is closed, cannot delete time entry")
		if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
			return jsonify({'success': False, 'message': 'Apontamentos de tickets fechados não podem ser deletados.'}), 400
		flash("Apontamentos de tickets fechados não podem ser deletados.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	# Verificar se o apontamento pertence ao ticket
	if time_entry.ticket_id != ticket_id:
		logging.info(f"Time entry ticket_id ({time_entry.ticket_id}) doesn't match requested ticket_id ({ticket_id})")
		if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
			return jsonify({'success': False, 'message': 'Apontamento não encontrado neste ticket.'}), 400
		flash("Apontamento não encontrado neste ticket.", "error")
		return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))
	
	try:
		logging.info("Attempting to delete time entry")
		db.session.delete(time_entry)
		db.session.commit()
		logging.info("Time entry deleted successfully")
		
		if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
			return jsonify({'success': True, 'message': 'Apontamento deletado com sucesso!'})
		
		flash("Apontamento deletado com sucesso!", "success")
		
	except Exception as e:
		logging.error(f"Error deleting time entry: {str(e)}")
		db.session.rollback()
		
		if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
			return jsonify({'success': False, 'message': f'Erro ao deletar apontamento: {str(e)}'}), 500
		
		flash(f"Erro ao deletar apontamento: {str(e)}", "error")
	
	return redirect(url_for("tickets.view_ticket", ticket_id=ticket_id))


@bp.route("/api/check-service-contract")
@login_required
def check_service_contract():
	"""Verifica se um serviço é contemplado pelo contrato do cliente"""
	try:
		client_id = request.args.get('client_id', type=int)
		service_id = request.args.get('service_id', type=int)
		
		if not client_id or not service_id:
			return jsonify({'error': 'client_id e service_id são obrigatórios'}), 400
		
		# Verificar se o cliente tem contrato que contempla o serviço
		from ..external_pg import client_has_contract_for_service
		has_contract = client_has_contract_for_service(client_id, service_id)
		
		return jsonify({
			'has_contract': has_contract,
			'client_id': client_id,
			'service_id': service_id
		})
		
	except Exception as e:
		return jsonify({'error': str(e)}), 500


@bp.route("/<int:ticket_id>/add_signature", methods=["POST"])
@login_required
def add_signature(ticket_id):
    """Adiciona uma assinatura digital ao ticket"""
    try:
        data = request.get_json()
        signature_data = data.get('signature_data')
        comment = data.get('comment', '')
        
        if not signature_data:
            return jsonify({"error": "Dados de assinatura não fornecidos"}), 400
        
        # Buscar o ticket
        ticket = Ticket.query.get(ticket_id)
        if not ticket:
            return jsonify({"error": "Ticket não encontrado"}), 404
        
        # Salvar arquivo de assinatura
        signature_file_path = save_signature_file(signature_data, ticket_id, current_user.id)
        
        if not signature_file_path:
            return jsonify({"error": "Erro ao salvar arquivo de assinatura"}), 500
        
        # Criar entrada de tempo com assinatura
        signature_timestamp = brasilia_to_utc(get_brasilia_now())
        
        time_entry = TimeEntry(
            ticket_id=ticket_id,
            user_id=current_user.id,
            hours=0,  # Assinatura sem horas
            comment=comment,
            signature_data=signature_data,
            signature_file_path=signature_file_path,
            signature_timestamp=signature_timestamp,
            start_time=signature_timestamp,
            end_time=signature_timestamp
        )
        
        db.session.add(time_entry)
        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": "Assinatura salva com sucesso",
            "signature_id": time_entry.id
        })
        
    except Exception as e:
        print(f"Erro ao salvar assinatura: {e}")
        return jsonify({"error": f"Erro interno: {str(e)}"}), 500


@bp.route("/api/clients")
@login_required
def api_clients():
	"""API para buscar clientes externos com filtro opcional"""
	try:
		external_clients = fetch_external_clients()
		
		# Filtro opcional por ID
		cid = request.args.get("id", type=int)
		if cid:
			external_clients = [c for c in external_clients if c.get("id") == cid]
		
		# Filtro opcional por query string
		q = (request.args.get("q") or "").strip().lower()
		if q:
			def match(c):
				name = (c.get("name") or "").lower()
				doc = (c.get("document") or "").lower()
				phone = (c.get("phone") or "").lower()
				email = (c.get("email") or "").lower()
				return q in name or q in doc or q in phone or q in email
			external_clients = [c for c in external_clients if match(c)]
		
		return jsonify({
			"success": True,
			"clients": external_clients,
			"total": len(external_clients)
		})
		
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar clientes: {str(e)}"}), 500


@bp.route("/api/users")
@login_required
def api_users():
	"""API para buscar usuários ativos"""
	try:
		print(f"🔍 API Users chamada por: {current_user.name}")
		# Filtrar apenas usuários ativos (status = '1')
		users = User.query.filter_by(status='1').order_by(User.name).all()
		print(f"🔍 Usuários ativos encontrados: {len(users)}")
		
		users_data = []
		for u in users:
			user_data = {"id": u.id, "name": u.name, "email": u.email}
			users_data.append(user_data)
			print(f"🔍 Usuário ativo: {user_data}")
		
		result = {
			"success": True,
			"users": users_data,
			"total": len(users_data)
		}
		
		print(f"🔍 Resultado API Users: {result}")
		return jsonify(result)
		
	except Exception as e:
		print(f"❌ Erro na API Users: {str(e)}")
		return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/api/services")
@login_required
def api_services():
	"""API para buscar serviços"""
	try:
		print(f"🔍 API Services chamada por: {current_user.name}")
		services = Service.query.order_by(Service.name).all()
		print(f"🔍 Serviços encontrados: {len(services)}")
		
		services_data = []
		for s in services:
			service_data = {"id": s.id, "name": s.name, "hourly_rate": s.hourly_rate}
			services_data.append(service_data)
			print(f"🔍 Serviço: {service_data}")
		
		result = {
			"success": True,
			"services": services_data,
			"total": len(services_data)
		}
		
		print(f"🔍 Resultado API Services: {result}")
		return jsonify(result)
		
	except Exception as e:
		print(f"❌ Erro na API Services: {str(e)}")
		return jsonify({"error": f"Erro ao buscar serviços: {str(e)}"}), 500


@bp.route("/<int:ticket_id>/cancel-ps", methods=["POST"])
@login_required
def cancel_ps(ticket_id):
	"""Cancelar PS de um ticket com extrema cautela"""
	# Verificar se o usuário tem permissão (apenas admin)
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem cancelar PS"}), 403
	
	# Buscar o ticket
	ticket = Ticket.query.get_or_404(ticket_id)
	
	# Validações de segurança
	if not ticket.ps_printed:
		return jsonify({"error": "Este ticket não possui PS impressa"}), 400
	
	if not ticket.ps_number:
		return jsonify({"error": "Número da PS não encontrado"}), 400
	
	if ticket.total_cost <= 0:
		return jsonify({"error": "Ticket não possui valor para cancelar"}), 400
	
	# Salvar dados antes de limpar
	ps_number = ticket.ps_number
	previous_value = ticket.total_cost
	
	# Log da operação
	print(f"🚨 INICIANDO CANCELAMENTO DE PS - Ticket: {ticket_id}, PS: {ps_number}, Valor: {previous_value}")
	print(f"🚨 Usuário: {current_user.name} ({current_user.email})")
	
	try:
		# 1. ATUALIZAR SQLITE (ticket)
		print(f"📝 Atualizando SQLite - Ticket {ticket_id}")
		ticket.total_cost = 0.0
		ticket.ps_printed = False
		ticket.ps_number = None
		ticket.ps_file = None
		db.session.flush()

		# 2. EXCLUIR DO POSTGRESQL/UNICO (financeiro)
		print(f"🗑️ Excluindo do PostgreSQL - PS: {ps_number}")
		pg_conn = None
		try:
			from ..uniplus_jobs import agent_enabled, enqueue_and_wait
			if agent_enabled():
				enqueue_and_wait("delete_finance_ps", {"document": ps_number, "ps_number": ps_number})
				print(f"✅ Registro excluído do PostgreSQL via agente")
			else:
				pg_conn = connect_postgres()
				if not pg_conn:
					raise RuntimeError("Não foi possível conectar ao PostgreSQL/Unico")
				pg_cursor = pg_conn.cursor()
				
				# Buscar o registro no PostgreSQL pelo documento
				pg_cursor.execute("SELECT * FROM financeiro WHERE documento = %s", (ps_number,))
				pg_record = pg_cursor.fetchone()
				
				if pg_record:
					print(f"📋 Registro encontrado no PostgreSQL: {pg_record}")
					
					# Excluir o registro
					pg_cursor.execute("DELETE FROM financeiro WHERE documento = %s", (ps_number,))
					pg_conn.commit()
					print(f"✅ Registro excluído do PostgreSQL")
				else:
					print(f"⚠️ Registro não encontrado no PostgreSQL para documento: {ps_number}")
				
		except Exception as e:
			print(f"❌ Erro ao excluir do PostgreSQL: {e}")
			if pg_conn:
				pg_conn.rollback()
			raise e
		finally:
			if pg_conn:
				pg_conn.close()

		db.session.commit()
		print(f"✅ Ticket local atualizado com sucesso")
		
		# Log de sucesso
		print(f"🎉 CANCELAMENTO DE PS CONCLUÍDO COM SUCESSO - Ticket: {ticket_id}")
		
		return jsonify({
			"success": True, 
			"message": f"PS cancelada com sucesso para o ticket #{ticket_id}",
			"details": {
				"ticket_id": ticket_id,
				"ps_number": ps_number,
				"previous_value": previous_value,
				"cancelled_by": current_user.name,
				"cancelled_at": get_brasilia_now().isoformat()
			}
		})
		
	except Exception as e:
		# Rollback em caso de erro
		db.session.rollback()
		print(f"💥 ERRO NO CANCELAMENTO DE PS - Ticket: {ticket_id}, Erro: {e}")
		
		return jsonify({
			"error": f"Erro ao cancelar PS: {str(e)}",
			"details": "Operação foi revertida. Verifique os logs para mais detalhes."
		}), 500


@bp.route("/vendas-avulsas")
@login_required
def list_vendas_avulsas():
	return render_template("tickets/vendas_avulsas.html")


@bp.route("/api/vendas-avulsas-list")
@login_required
def api_vendas_avulsas_list():
	conn = connect_postgres()
	if not conn:
		return jsonify({"success": False, "error": "Erro de conexão com o banco de faturamento"}), 500
	cursor = conn.cursor()
	try:
		# Query financeiro records with observacaoboleto = 'Avulso'
		query = """
			SELECT 
				f.id, 
				f.emissao, 
				f.identidade, 
				e.nome as client_name, 
				f.documento, 
				f.historico, 
				f.valor, 
				f.status, 
				f.vencimento,
				f.idrepresentante,
				rep.nome as seller_name,
				f.devolucaodescricao
			FROM financeiro f
			LEFT JOIN entidade e ON f.identidade = e.id
			LEFT JOIN entidade rep ON f.idrepresentante = rep.id
			WHERE f.observacaoboleto = 'Avulso' AND f.idcodigocontabil = 71 AND f.documento NOT LIKE 'PS%%' AND f.documento NOT LIKE 'NFSe%%'
			ORDER BY f.emissao DESC, f.id DESC
		"""
		cursor.execute(query)
		rows = cursor.fetchall()
		
		# Parse e monta a lista de vendas
		sales = []
		
		for r in rows:
			fid = r[0]
			emissao_date = r[1]
			client_id = r[2]
			client_name = r[3] or "Cliente Não Identificado"
			documento = r[4]
			historico = r[5]
			valor = float(r[6]) if r[6] is not None else 0.0
			status = r[7].strip() if r[7] else 'A'
			vencimento = r[8]
			seller_name = r[10] or "Não Informado"
			cancel_reason = r[11]
			
			# Parse do historico
			pname = "Produto Avulso"
			qty = 1.0
			uprice = valor
			
			if historico:
				import re
				match = re.match(r"^(.+?)\s+x\s+([\d\.,]+)\s+\(R\$\s+([\d\.,\s]+)\)$", historico.strip())
				if match:
					pname = match.group(1).strip()
					try:
						qty = float(match.group(2).replace(",", "."))
					except ValueError:
						qty = 1.0
					try:
						uprice = float(match.group(3).replace(",", ".").replace(" ", ""))
					except ValueError:
						uprice = valor / qty if qty > 0 else valor
				else:
					continue
			else:
				continue
			
			sales.append({
				"id": fid,
				"finance_id": fid,
				"emissao": emissao_date.isoformat() if hasattr(emissao_date, 'isoformat') else str(emissao_date),
				"vencimento": vencimento.isoformat() if hasattr(vencimento, 'isoformat') else str(vencimento),
				"client_id": client_id,
				"client_name": client_name,
				"product_name": pname,
				"quantity": qty,
				"unit_price": uprice,
				"total_price": valor,
				"valor": valor,
				"documento": documento,
				"seller_name": seller_name,
				"status": status,
				"cancel_reason": cancel_reason
			})

		q = (request.args.get("q") or "").strip().lower()
		if q:
			sales = [
				s for s in sales
				if q in (s.get("client_name") or "").lower()
				or q in (s.get("documento") or "").lower()
				or q in (s.get("product_name") or "").lower()
				or q in (s.get("seller_name") or "").lower()
			]
		from ..query_filters import filter_dicts
		sales = filter_dicts(sales)
		try:
			page = max(1, int(request.args.get("page", 1)))
		except (TypeError, ValueError):
			page = 1
		try:
			per_page = min(50, max(10, int(request.args.get("per_page", 25))))
		except (TypeError, ValueError):
			per_page = 25
		total = len(sales)
		start = (page - 1) * per_page
		return jsonify({
			"success": True,
			"sales": sales[start:start + per_page],
			"items": sales[start:start + per_page],
			"total": total,
			"page": page,
			"per_page": per_page,
		})
	except Exception as e:
		print("Erro ao listar vendas avulsas:", e)
		return jsonify({"success": False, "error": str(e)}), 500
	finally:
		cursor.close()
		conn.close()


@bp.route("/api/vendas-avulsas/<int:sale_id>/cancel", methods=["POST"])
@login_required
def api_vendas_avulsas_cancel(sale_id):
	data = request.get_json() or {}
	reason = data.get("reason", "").strip() or "Não informado"
	
	conn = connect_postgres()
	if not conn:
		return jsonify({"success": False, "error": "Erro de conexão com o banco de faturamento"}), 500
	cursor = conn.cursor()
	try:
		from datetime import date
		today_str = date.today().isoformat()

		from ..uniplus_jobs import agent_enabled, enqueue_and_wait
		if agent_enabled():
			enqueue_and_wait("cancel_finance_avulso", {
				"sale_id": sale_id,
				"reason": reason,
			})
			return jsonify({"success": True, "message": "Venda cancelada com sucesso!"})

		# Confirm the record is a Venda Avulsa first
		cursor.execute("SELECT id FROM financeiro WHERE id = %s AND observacaoboleto = 'Avulso' AND idcodigocontabil = 71 AND documento NOT LIKE 'PS%%' AND documento NOT LIKE 'NFSe%%'", (sale_id,))
		if not cursor.fetchone():
			return jsonify({"success": False, "error": "Lançamento não encontrado ou não é uma venda avulsa"}), 404
			
		cursor.execute(
			"""
			UPDATE financeiro 
			SET status = 'C', devolucaodescricao = %s, devolucaocodigo = 1, devolucaodata = %s
			WHERE id = %s
			""",
			(reason, today_str, sale_id)
		)
		conn.commit()
		return jsonify({"success": True, "message": "Venda cancelada com sucesso!"})
	except Exception as e:
		conn.rollback()
		print("Erro ao cancelar venda avulsa:", e)
		return jsonify({"success": False, "error": str(e)}), 500
	finally:
		cursor.close()
		conn.close()


@bp.route("/api/venda-avulsa/imprimir")
@login_required
def api_venda_avulsa_imprimir():
	ids_str = request.args.get("ids", "").strip()
	if not ids_str:
		return "Nenhum ID informado para impressão", 400
		
	try:
		ids = [int(i) for i in ids_str.split(",") if i.strip().isdigit()]
	except ValueError:
		return "IDs de lançamento inválidos", 400
		
	if not ids:
		return "Nenhum ID válido informado", 400
		
	conn = connect_postgres()
	if not conn:
		return "Erro de conexão com o faturamento", 500
		
	cursor = conn.cursor()
	try:
		# Query the records and their associated client / rep names and client details
		query = """
			SELECT 
				f.id, f.emissao, f.valor, f.documento, f.vencimento, f.historico,
				e.nome as cliente_name, e.celular as cliente_fone, e.endereco as cliente_endereco,
				e.cnpjcpf as cliente_doc,
				rep.nome as vendedor_name
			FROM financeiro f
			LEFT JOIN entidade e ON f.identidade = e.id
			LEFT JOIN entidade rep ON f.idrepresentante = rep.id
			WHERE f.id = ANY(%s) AND f.observacaoboleto = 'Avulso' AND f.idcodigocontabil = 71 AND f.documento NOT LIKE 'PS%%' AND f.documento NOT LIKE 'NFSe%%'
		"""
		cursor.execute(query, (ids,))
		rows = cursor.fetchall()
		
		if not rows:
			return "Nenhuma venda avulsa correspondente encontrada", 404
			
		# Map query rows to data dictionaries for ReportLab
		data_list = []
		for r in rows:
			fid = r[0]
			emissao = r[1].strftime('%d/%m/%Y') if hasattr(r[1], 'strftime') else str(r[1])
			valor = float(r[2]) if r[2] is not None else 0.0
			documento = r[3]
			vencimento = r[4].strftime('%d/%m/%Y') if hasattr(r[4], 'strftime') else str(r[4])
			historico = r[5] or ""
			
			cliente_nome = r[6] or ""
			cliente_fone = r[7] or ""
			cliente_endereco = r[8] or ""
			cliente_doc = r[9] or ""
			vendedor = r[10] or ""
			
			# Formata observação / produto
			obs = historico
			
			data_list.append({
				'emissao': emissao,
				'valor': valor,
				'documento': documento,
				'vencimento': vencimento,
				'cliente_nome': cliente_nome,
				'cliente_fone': cliente_fone,
				'cliente_endereco': cliente_endereco,
				'cliente_bairro': "", 
				'cliente_cidade': "", 
				'cliente_cep': "",
				'cliente_uf': "",
				'cliente_doc': cliente_doc,
				'cliente_ie': "",
				'obs': obs,
				'vendedor': vendedor
			})
			
		from app.services.duplicata_pdf import build_duplicata_pdf_list
		pdf_buffer = build_duplicata_pdf_list(data_list)
		
		return send_file(
			pdf_buffer,
			mimetype="application/pdf",
			as_attachment=False,
			download_name=f"duplicata_venda_avulsa_{ids_str.replace(',', '_')}.pdf"
		)
	except Exception as e:
		print("Erro ao gerar PDF de venda avulsa:", e)
		return f"Erro ao gerar PDF: {str(e)}", 500
	finally:
		cursor.close()
		conn.close()


@bp.route("/api/produto-fora-estoque-direto", methods=["POST"])
@login_required
def api_produto_fora_estoque_direto():
	data = request.get_json() or {}
	client_id = data.get("client_id")
	seller_id = data.get("seller_id")
	items = data.get("items", [])
	
	if not client_id:
		return jsonify({"success": False, "error": "Cliente é obrigatório."}), 400
	if not seller_id:
		return jsonify({"success": False, "error": "Vendedor é obrigatório."}), 400
	if not items:
		return jsonify({"success": False, "error": "É necessário ao menos um produto."}), 400
		
	# Find local user to map to PostgreSQL seller representative
	local_user = User.query.get(seller_id)
	if not local_user:
		return jsonify({"success": False, "error": "Vendedor local inválido."}), 400
		
	conn = connect_postgres()
	if not conn:
		return jsonify({"success": False, "error": "Erro de conexão com o banco de faturamento"}), 500
		
	cursor = conn.cursor()
	try:
		# Map local user to PostgreSQL representative ID
		from app.services.faturamento_products import get_external_user_data, create_out_of_stock_finance_record
		_, rep_id = get_external_user_data(cursor, local_user)
		
		finance_ids = []
		for item in items:
			pname = item.get("product_name", "").strip()
			if not pname:
				continue
			try:
				qty = float(item.get("quantity", 1))
			except (ValueError, TypeError):
				qty = 1.0
			try:
				price = float(item.get("unit_price", 0))
			except (ValueError, TypeError):
				price = 0.0
				
			fid = create_out_of_stock_finance_record(
				cursor,
				client_id=int(client_id),
				product_name=pname,
				quantity=qty,
				unit_price=price,
				idrepresentante=rep_id
			)
			finance_ids.append(fid)
			
		conn.commit()
		return jsonify({
			"success": True, 
			"message": "Venda lançada com sucesso!", 
			"finance_ids": finance_ids
		})
	except Exception as e:
		conn.rollback()
		print("Erro ao lançar produto fora de estoque direto:", e)
		return jsonify({"success": False, "error": str(e)}), 500
	finally:
		cursor.close()
		conn.close()


def _fmt_ticket_dt(dt):
	if not dt:
		return None
	try:
		local = utc_to_brasilia(dt)
		return local.strftime("%d/%m/%y %H:%M")
	except Exception:
		return str(dt)


def _fmt_ticket_dt_local_input(dt):
	"""Formato para input datetime-local (Brasília): YYYY-MM-DDTHH:MM."""
	if not dt:
		return None
	try:
		local = utc_to_brasilia(dt)
		return local.strftime("%Y-%m-%dT%H:%M")
	except Exception:
		return None


def _helpdesk_linked_at(ticket: Ticket):
	"""Horário em que ESTE chamado foi anexado (HelpDeskTicketLink.created_at)."""
	link = HelpDeskTicketLink.query.filter_by(computicket_ticket_id=ticket.id).order_by(
		HelpDeskTicketLink.created_at.desc()
	).first()
	return link.created_at if link else None


def _ticket_base_price(ticket: Ticket) -> float:
	if ticket.service and ticket.service.hourly_rate:
		return float(ticket.service.hourly_rate or 0)
	return float(ticket.total_cost or 0)


def _ticket_addons_total(ticket: Ticket) -> float:
	return float(sum((a.value or 0) for a in (ticket.addons or [])))


def _serialize_ticket_card(ticket: Ticket) -> dict:
	client_name = ticket.display_client_name() or "—"
	base = _ticket_base_price(ticket)
	hours = float(ticket.total_hours() or 0)
	hourly = float(ticket.service.hourly_rate or 0) if ticket.service else 0.0
	value = float(ticket.total_cost or 0) if ticket.status == "fechado" else (hours * hourly if hourly else 0.0)
	return {
		"id": ticket.id,
		"code": f"{ticket.id:05d}",
		"title": ticket.title,
		"description": ticket.description or "",
		"status": ticket.status,
		"category": ticket.service.name if ticket.service else "—",
		"created_at": _fmt_ticket_dt(ticket.created_at),
		"updated_at": _fmt_ticket_dt(ticket.closed_at or ticket.in_progress_started_at or ticket.created_at),
		"base_price": base,
		"client_name": client_name,
		"solicitante": ticket.solicitante,
		"assigned_to_id": ticket.assigned_to_id,
		"assigned_to_name": ticket.assigned_to_user.name if ticket.assigned_to_user else None,
		"hours": hours,
		"hours_label": ticket.formatted_total_hours(),
		"time_entries_count": len(ticket.time_entries or []),
		"hourly_rate": hourly,
		"value": value,
		"total_cost": float(ticket.total_cost or 0),
		"ps_printed": bool(ticket.ps_printed),
		"ps_number": ticket.ps_number,
	}


def _serialize_time_entry(entry: TimeEntry) -> dict:
	user = entry.user
	return {
		"id": entry.id,
		"user_id": entry.user_id,
		"user_name": user.name if user else None,
		"hours": float(entry.hours or 0),
		"hours_label": entry.formatted_hours(),
		"comment": entry.comment or "",
		"start_time": _fmt_ticket_dt(entry.start_time),
		"end_time": _fmt_ticket_dt(entry.end_time),
		"no_charge": bool(entry.no_charge),
		"created_at": _fmt_ticket_dt(entry.created_at),
	}


def _ticket_client_phone(ticket: Ticket):
	if ticket.external_client_id:
		try:
			c = get_external_client_by_id(ticket.external_client_id)
			if c:
				return c.get("phone")
		except Exception:
			pass
	if ticket.client:
		return ticket.client.phone
	return None


def _serialize_ticket_detail(ticket: Ticket) -> dict:
	base = _ticket_base_price(ticket)
	addons = [a.to_dict() for a in (ticket.addons or [])]
	addons_total = _ticket_addons_total(ticket)
	tech = ticket.assigned_to_user
	no_charge, charge_reason = _ticket_contract_no_charge(ticket)
	entries = list(ticket.time_entries or [])
	def _entry_key(e):
		dt = e.start_time or e.created_at
		if dt is None:
			return datetime.min
		return dt.replace(tzinfo=None) if getattr(dt, "tzinfo", None) else dt
	entries.sort(key=_entry_key)
	return {
		**_serialize_ticket_card(ticket),
		"solicitante": ticket.solicitante,
		"external_client_id": ticket.external_client_id,
		"service_id": ticket.service_id,
		"addons": addons,
		"addons_total": addons_total,
		"total": base + addons_total,
		"technician": {
			"id": tech.id,
			"name": tech.name,
			"email": tech.email,
		} if tech else None,
		"time_entries_count": len(entries),
		"time_entries": [_serialize_time_entry(e) for e in entries],
		"hours": float(ticket.total_hours() or 0),
		"hourly_rate": float(ticket.service.hourly_rate or 0) if ticket.service else 0.0,
		"no_charge": no_charge,
		"charge_reason": charge_reason,
		"should_show_costs": not no_charge,
		"client_phone": _ticket_client_phone(ticket),
		"ps_printed": bool(ticket.ps_printed),
		"ps_number": ticket.ps_number,
		"ps_file": ticket.ps_file,
		"helpdesk_conversation": _helpdesk_conversation_payload(ticket),
		"in_progress_started_at": _fmt_ticket_dt_local_input(ticket.in_progress_started_at),
		"created_at_input": _fmt_ticket_dt_local_input(ticket.created_at),
		"helpdesk_linked_at": _fmt_ticket_dt_local_input(_helpdesk_linked_at(ticket)),
	}


@bp.route("/api/list")
@login_required
def api_list_tickets():
	"""Lista plana no mesmo modelo da página Jinja /tickets (filtros + paginação)."""
	status_raw = (request.args.get("status") or "").strip()
	all_statuses = status_raw in {"all", "todos", "*"}
	status = "" if all_statuses else status_raw
	assigned_raw = request.args.get("assigned_to_id")
	try:
		assigned_to_id = int(assigned_raw) if assigned_raw not in (None, "") else None
	except (TypeError, ValueError):
		assigned_to_id = None
	q = (request.args.get("q") or "").strip()
	date_from = (request.args.get("date_from") or "").strip()
	date_to = (request.args.get("date_to") or "").strip()
	ps_pending = _parse_bool_param(request.args.get("ps_pending"))
	# Como o HTML: sem filtro de status → abertos.
	query = _build_tickets_query(
		status=status or None,
		assigned_to_id=assigned_to_id,
		q=q,
		date_from=date_from,
		date_to=date_to,
		ps_pending=ps_pending,
		default_open_only=not all_statuses and not status and not ps_pending,
	)
	from ..query_filters import filter_query
	query = query.outerjoin(Service, Ticket.service_id == Service.id)
	query = query.outerjoin(User, Ticket.assigned_to_id == User.id)
	query = filter_query(query, {
		"id": Ticket.id,
		"title": Ticket.title,
		"client_name": Ticket.external_client_name,
		"solicitante": Ticket.solicitante,
		"category": Service.name,
		"technician_name": User.name,
		"status": Ticket.status,
		"value": Ticket.total_cost,
		"created_at": Ticket.created_at,
	})
	try:
		page = max(1, int(request.args.get("page", 1)))
	except (TypeError, ValueError):
		page = 1
	try:
		per_page = min(50, max(10, int(request.args.get("per_page", 20))))
	except (TypeError, ValueError):
		per_page = 20
	pagination = query.order_by(Ticket.created_at.desc()).paginate(
		page=page, per_page=per_page, error_out=False,
	)
	return jsonify({
		"items": [_serialize_ticket_card(t) for t in pagination.items],
		"total": pagination.total,
		"page": pagination.page,
		"per_page": per_page,
	})


@bp.route("/api/<int:ticket_id>")
@login_required
def api_get_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	return jsonify(_serialize_ticket_detail(ticket))


@bp.route("/api", methods=["POST"])
@login_required
def api_create_ticket():
	data = request.get_json(silent=True) or {}
	title = (data.get("title") or "").strip()
	description = (data.get("description") or "").strip()
	solicitante = (data.get("solicitante") or "").strip()
	external_client_id = data.get("external_client_id")
	fallback_name = (data.get("external_client_name") or "").strip()
	service_id = data.get("service_id")
	assigned_to_id = data.get("assigned_to_id")
	if not title:
		return jsonify({"error": "Título é obrigatório."}), 400
	if not solicitante:
		return jsonify({"error": "Informe o nome do solicitante."}), 400
	if not external_client_id:
		return jsonify({"error": "Selecione um cliente."}), 400
	try:
		ext_id = int(external_client_id)
	except (TypeError, ValueError):
		return jsonify({"error": "Cliente inválido."}), 400

	selected_ext = None
	try:
		selected_ext = get_external_client_by_id(ext_id)
	except ExternalPgError as e:
		if fallback_name:
			selected_ext = {"id": ext_id, "name": fallback_name}
		else:
			return jsonify({"error": str(e)}), 503
	except Exception as e:
		if fallback_name:
			selected_ext = {"id": ext_id, "name": fallback_name}
		else:
			return jsonify({"error": f"Erro ao validar cliente: {e}"}), 503

	if not selected_ext:
		if fallback_name:
			selected_ext = {"id": ext_id, "name": fallback_name}
		else:
			return jsonify({"error": "Cliente não encontrado."}), 400

	try:
		ticket = Ticket(
			title=title,
			description=description,
			external_client_id=ext_id,
			external_client_name=selected_ext.get("name") or fallback_name or None,
			solicitante=solicitante,
			service_id=int(service_id) if service_id else None,
			opened_by_id=current_user.id,
			assigned_to_id=int(assigned_to_id) if assigned_to_id else None,
		)
		db.session.add(ticket)
		db.session.commit()
	except Exception as e:
		db.session.rollback()
		return jsonify({"error": f"Erro ao criar chamado: {e}"}), 500

	try:
		from ..notification_service import create_notifications, ticket_recipient_ids
		create_notifications(
			ticket_recipient_ids(ticket.assigned_to_id),
			notification_type="ticket",
			title=f"Novo ticket #{ticket.id}",
			message=f"{ticket.title} · {ticket.display_client_name() or 'Cliente não informado'}",
			url=f"/tickets/{ticket.id}",
			entity_type="ticket",
			entity_id=ticket.id,
		)
	except Exception:
		pass

	try:
		return jsonify(_serialize_ticket_detail(ticket)), 201
	except Exception as e:
		# Chamado já gravado — não falhar a abertura por erro de serialização.
		return jsonify({
			"id": ticket.id,
			"title": ticket.title,
			"status": ticket.status,
			"solicitante": ticket.solicitante,
			"external_client_id": ticket.external_client_id,
			"external_client_name": ticket.external_client_name,
			"warning": f"Chamado criado, mas a resposta detalhada falhou: {e}",
		}), 201


@bp.route("/api/<int:ticket_id>", methods=["PATCH"])
@login_required
def api_update_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if ticket.status == "fechado":
		return jsonify({"error": "Tickets fechados não podem ser editados."}), 400
	data = request.get_json(silent=True) or {}
	if "title" in data:
		ticket.title = (data.get("title") or "").strip()
	if "description" in data:
		ticket.description = (data.get("description") or "").strip()
	if "solicitante" in data:
		ticket.solicitante = (data.get("solicitante") or "").strip()
	if "service_id" in data:
		ticket.service_id = data.get("service_id") or None
	if "assigned_to_id" in data:
		ticket.assigned_to_id = data.get("assigned_to_id") or None
	if data.get("external_client_id"):
		try:
			ext_id = int(data["external_client_id"])
		except (TypeError, ValueError):
			return jsonify({"error": "Cliente inválido."}), 400
		fallback_name = (data.get("external_client_name") or "").strip()
		try:
			selected_ext = get_external_client_by_id(ext_id)
		except ExternalPgError as e:
			if not fallback_name and not ticket.external_client_name:
				return jsonify({"error": str(e)}), 503
			selected_ext = {"id": ext_id, "name": fallback_name or ticket.external_client_name}
		if selected_ext:
			ticket.external_client_id = ext_id
			ticket.external_client_name = selected_ext.get("name") or fallback_name or ticket.external_client_name
			ticket.client_id = None
	db.session.commit()
	return jsonify(_serialize_ticket_detail(ticket))


@bp.route("/api/<int:ticket_id>/close-preview")
@login_required
def api_close_preview(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	no_charge, charge_reason = _ticket_contract_no_charge(ticket)
	hours = float(ticket.total_hours() or 0)
	hourly = float(ticket.service.hourly_rate or 0) if ticket.service else 0.0
	computed, _, _ = _calculate_ticket_total_cost(ticket, force_charge=False, manual=None)
	forced, _, _ = _calculate_ticket_total_cost(ticket, force_charge=True, manual=None)
	return jsonify({
		"id": ticket.id,
		"code": f"{ticket.id:05d}",
		"title": ticket.title,
		"client_name": ticket.display_client_name() or "—",
		"client_phone": _ticket_client_phone(ticket),
		"category": ticket.service.name if ticket.service else "—",
		"hours": hours,
		"hours_label": ticket.formatted_total_hours(),
		"hourly_rate": hourly,
		"no_charge": no_charge,
		"charge_reason": charge_reason,
		"should_show_costs": not no_charge,
		"computed_total": float(computed),
		"forced_total": float(forced),
		"has_external_client": bool(ticket.external_client_id),
		"time_entries_count": len(ticket.time_entries or []),
		"status": ticket.status,
	})


@bp.route("/api/<int:ticket_id>/start", methods=["POST"])
@login_required
def api_start_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if ticket.status in ("fechado", "cancelado"):
		return jsonify({"error": "Não é possível iniciar este chamado."}), 400
	ticket.status = "em_andamento"
	ticket.assigned_to_id = current_user.id
	ticket.in_progress_started_at = brasilia_to_utc(get_brasilia_now())
	db.session.commit()
	return jsonify(_serialize_ticket_detail(ticket))


def _parse_local_datetime_payload(raw: str | None):
	"""Interpreta datetime enviado pelo front (Brasília) e converte para UTC."""
	text = str(raw or "").strip()
	if not text:
		return None
	formats = (
		"%Y-%m-%dT%H:%M:%S",
		"%Y-%m-%dT%H:%M",
		"%Y-%m-%d %H:%M:%S",
		"%Y-%m-%d %H:%M",
		"%d/%m/%Y %H:%M",
		"%d/%m/%Y %H:%M:%S",
	)
	for fmt in formats:
		try:
			return brasilia_to_utc(datetime.strptime(text, fmt))
		except ValueError:
			continue
	try:
		return brasilia_to_utc(datetime.fromisoformat(text))
	except ValueError:
		return None


@bp.route("/api/<int:ticket_id>/stop", methods=["POST"])
@login_required
def api_stop_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if not ticket.in_progress_started_at:
		return jsonify({"error": "Ticket não estava em andamento."}), 400
	if ticket.assigned_to_id != current_user.id:
		return jsonify({"error": "Apenas quem iniciou a sessão pode encerrá-la."}), 403
	data = request.get_json(silent=True) or {}
	start_dt = _parse_local_datetime_payload(data.get("start_time")) or ticket.in_progress_started_at
	end_dt = _parse_local_datetime_payload(data.get("end_time")) or brasilia_to_utc(get_brasilia_now())
	if start_dt.tzinfo is None:
		from pytz import utc
		start_dt = utc.localize(start_dt)
	if end_dt.tzinfo is None:
		from pytz import utc
		end_dt = utc.localize(end_dt)
	if end_dt < start_dt:
		return jsonify({"error": "Horário final deve ser após o início."}), 400
	delta_hours = (end_dt - start_dt).total_seconds() / 3600.0
	comment = (data.get("comment") or "").strip() or "Encerrado pelo botão"
	entry = TimeEntry(
		ticket_id=ticket.id,
		user_id=current_user.id,
		hours=max(0.0, delta_hours),
		comment=comment,
		start_time=start_dt,
		end_time=end_dt,
	)
	db.session.add(entry)
	ticket.in_progress_started_at = None
	ticket.status = "aberto"
	db.session.commit()
	return jsonify(_serialize_ticket_detail(ticket))


@bp.route("/api/<int:ticket_id>/assume", methods=["POST"])
@login_required
def api_assume_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if ticket.status in ("fechado", "cancelado"):
		return jsonify({"error": "Não é possível assumir um ticket fechado ou cancelado."}), 400
	if ticket.status == "em_andamento" and ticket.assigned_to_id != current_user.id:
		return jsonify({"error": "Este ticket já está em andamento por outro usuário."}), 400
	ticket.assigned_to_id = current_user.id
	db.session.commit()
	return jsonify(_serialize_ticket_detail(ticket))


@bp.route("/api/<int:ticket_id>/close", methods=["POST"])
@login_required
def api_close_ticket(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if ticket.status == "fechado":
		return jsonify({"error": "Ticket já está fechado."}), 400
	if ticket.status == "cancelado":
		return jsonify({"error": "Ticket cancelado não pode ser fechado."}), 400
	data = request.get_json(silent=True) or {}
	force_charge = bool(data.get("force_charge"))
	manual = data.get("manual_total_cost")
	if manual is not None and manual != "":
		manual = float(manual)
	else:
		manual = None
	if ticket.time_entries:
		total_cost, _no_charge, _reason = _calculate_ticket_total_cost(
			ticket, force_charge=force_charge, manual=manual,
		)
		ticket.total_cost = total_cost
	else:
		ticket.total_cost = _ticket_base_price(ticket) + _ticket_addons_total(ticket)
	ticket.status = "fechado"
	ticket.closed_at = brasilia_to_utc(get_brasilia_now())
	db.session.commit()
	notify_helpdesk_ticket(ticket.id, f"Ticket #{ticket.id} encerrado", internal=True)
	return jsonify(_serialize_ticket_detail(ticket))


def _delete_ticket_ps_from_unico(ps_number: str) -> None:
	from ..uniplus_jobs import agent_enabled, enqueue_and_wait

	if agent_enabled():
		enqueue_and_wait("delete_finance_ps", {"document": ps_number, "ps_number": ps_number})
		return

	conn = connect_postgres()
	if not conn:
		raise RuntimeError("Não foi possível conectar ao PostgreSQL/Unico")
	cursor = None
	try:
		cursor = conn.cursor()
		cursor.execute("DELETE FROM financeiro WHERE documento = %s", (ps_number,))
		conn.commit()
	except Exception:
		conn.rollback()
		raise
	finally:
		if cursor:
			cursor.close()
		conn.close()


@bp.route("/api/<int:ticket_id>/cancel", methods=["POST"])
@login_required
def api_cancel_closed_ticket(ticket_id: int):
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem cancelar tickets fechados."}), 403

	ticket = Ticket.query.get_or_404(ticket_id)
	if ticket.status == "cancelado" and not ticket.ps_number:
		return jsonify({
			"success": True,
			"already_cancelled": True,
			"message": f"Ticket #{ticket_id} já estava cancelado.",
			"ticket": _serialize_ticket_detail(ticket),
		})
	if ticket.status not in ("fechado", "cancelado"):
		return jsonify({"error": "Apenas tickets fechados podem ser cancelados por esta ação."}), 400

	data = request.get_json(silent=True) or {}
	reason = (data.get("reason") or "").strip()
	ps_number = ticket.ps_number

	try:
		if ps_number:
			_delete_ticket_ps_from_unico(ps_number)

		cancelled_at = get_brasilia_now()
		ticket.status = "cancelado"
		ticket.cancelled_at = brasilia_to_utc(cancelled_at)
		ticket.cancelled_by_id = current_user.id
		ticket.cancellation_reason = reason or None
		ticket.ps_printed = False
		ticket.ps_number = None
		ticket.ps_file = None
		ticket.ps_registration_status = "cancelled"
		ticket.ps_registration_updated_at = cancelled_at.replace(tzinfo=None)
		ticket.ps_job_id = None
		db.session.commit()
	except Exception as exc:
		db.session.rollback()
		current_app.logger.exception("Falha ao cancelar ticket fechado #%s", ticket_id)
		return jsonify({
			"error": f"Não foi possível cancelar o ticket: {exc}",
			"details": "O ticket local foi preservado. Verifique a conexão com o Unico.",
		}), 502

	notify_helpdesk_ticket(
		ticket.id,
		f"Ticket #{ticket.id} cancelado por {current_user.name}."
		+ (f"\nMotivo: {reason}" if reason else ""),
	)
	return jsonify({
		"success": True,
		"message": (
			f"Ticket #{ticket.id} cancelado com sucesso"
			+ (f" e PS {ps_number} removida do Unico." if ps_number else ".")
		),
		"ticket": _serialize_ticket_detail(ticket),
	})


@bp.route("/api/<int:ticket_id>/addons", methods=["GET", "POST"])
@login_required
def api_ticket_addons(ticket_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	if request.method == "GET":
		return jsonify([a.to_dict() for a in ticket.addons])
	if ticket.status in ("fechado", "cancelado"):
		return jsonify({"error": "Não é possível alterar serviços de um chamado encerrado."}), 400
	data = request.get_json(silent=True) or {}
	description = (data.get("description") or "").strip()
	raw = data.get("value")
	value = 0.0
	if isinstance(raw, (int, float)):
		value = float(raw)
	elif isinstance(raw, str):
		cleaned = raw.replace("R$", "").strip()
		if "," in cleaned:
			cleaned = cleaned.replace(".", "").replace(",", ".")
		try:
			value = float(cleaned)
		except ValueError:
			value = 0.0
	if not description:
		return jsonify({"error": "Descrição é obrigatória."}), 400
	addon = TicketAddon(ticket_id=ticket.id, description=description, value=value)
	db.session.add(addon)
	db.session.commit()
	return jsonify(_serialize_ticket_detail(ticket)), 201


@bp.route("/api/<int:ticket_id>/addons/<int:addon_id>", methods=["PATCH", "DELETE"])
@login_required
def api_ticket_addon_item(ticket_id: int, addon_id: int):
	ticket = Ticket.query.get_or_404(ticket_id)
	addon = TicketAddon.query.filter_by(id=addon_id, ticket_id=ticket_id).first_or_404()
	if ticket.status in ("fechado", "cancelado"):
		return jsonify({"error": "Não é possível alterar serviços de um chamado encerrado."}), 400
	if request.method == "DELETE":
		db.session.delete(addon)
		db.session.commit()
		return jsonify(_serialize_ticket_detail(ticket))
	data = request.get_json(silent=True) or {}
	if "description" in data:
		addon.description = (data.get("description") or "").strip()
	if "value" in data:
		try:
			addon.value = float(data.get("value") or 0)
		except (TypeError, ValueError):
			addon.value = 0.0
	db.session.commit()
	return jsonify(_serialize_ticket_detail(ticket))
