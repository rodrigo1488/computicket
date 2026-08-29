from collections import defaultdict

from flask import Blueprint, render_template, jsonify
from flask_login import login_required
from sqlalchemy import func, and_
from datetime import datetime, date
from ..models import Ticket, TimeEntry, Client, User, ServiceOrder
from ..timezone_utils import get_brasilia_now

bp = Blueprint("dashboard", __name__)


def _as_int(value, default=0):
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _empty_helpdesk(error=None):
    return {
        "ok": False,
        "error": error,
        "status_counts": {"waiting": 0, "active": 0, "closed": 0},
        "chats_em_risco": [],
        "chats_sem_resposta": [],
        "chats_finalizados_hoje": 0,
        "technician_ranking": [],
        "summary": {
            "active": 0,
            "pending": 0,
            "closed": 0,
            "unread": 0,
            "returns": 0,
            "potentials": 0,
            "online_attendants": 0,
        },
        "queues": [],
        "connections": [],
        "users": [],
    }


def _normalize_whatsapps(raw):
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        if isinstance(raw.get("whatsapps"), list):
            return raw["whatsapps"]
        if raw.get("id"):
            return [raw]
    return []


def get_helpdesk_dashboard_data():
    """Métricas do inbox WhatsApp via engine Compuchat (:4000)."""
    from ..engine_client import EngineError, admin_request, agent_request

    try:
        overview = agent_request("GET", "/tickets/overview", params={"showAll": "true"}) or {}
    except EngineError as exc:
        return _empty_helpdesk(str(exc))
    except Exception as exc:
        return _empty_helpdesk(str(exc))

    if not isinstance(overview, dict):
        overview = {}

    connections = []
    try:
        for item in _normalize_whatsapps(admin_request("GET", "/whatsapp/") or []):
            connections.append({
                "id": item.get("id"),
                "name": item.get("name") or "WhatsApp",
                "status": item.get("status") or "DISCONNECTED",
                "number": item.get("number"),
            })
    except EngineError:
        connections = []

    closed = 0
    try:
        closed_data = agent_request(
            "GET",
            "/tickets",
            params={"status": "closed", "showAll": "true", "pageNumber": "1"},
        )
        if isinstance(closed_data, dict):
            closed = _as_int(closed_data.get("count"))
    except EngineError:
        closed = 0

    summary_raw = overview.get("summary") or {}
    active = _as_int(summary_raw.get("active"))
    pending = _as_int(summary_raw.get("pending"))
    unread = _as_int(summary_raw.get("newMessages"))
    returns = _as_int(summary_raw.get("returns"))
    potentials = _as_int(summary_raw.get("potentials"))
    online_attendants = _as_int(summary_raw.get("onlineAttendants"))

    queues = []
    for row in overview.get("queues") or []:
        q_active = _as_int(row.get("active"))
        q_pending = _as_int(row.get("pending"))
        queues.append({
            "id": row.get("id"),
            "name": row.get("name") or "Fila",
            "color": row.get("color") or "#7C7C7C",
            "active": q_active,
            "pending": q_pending,
            "unread": _as_int(row.get("newMessages")),
            "count": q_active + q_pending,
        })
    queues.sort(key=lambda q: q["count"], reverse=True)

    users = []
    ranking = []
    for row in overview.get("users") or []:
        u_active = _as_int(row.get("active"))
        u_pending = _as_int(row.get("pending"))
        count = u_active + u_pending
        name = row.get("name") or "Atendente"
        users.append({
            "id": row.get("id"),
            "name": name,
            "online": bool(row.get("online")),
            "active": u_active,
            "pending": u_pending,
            "unread": _as_int(row.get("newMessages")),
            "count": count,
        })
        ranking.append({"name": name, "tickets_count": count})
    users.sort(key=lambda u: u["count"], reverse=True)
    ranking.sort(key=lambda x: x["tickets_count"], reverse=True)

    return {
        "ok": True,
        "error": None,
        "status_counts": {"waiting": pending, "active": active, "closed": closed},
        "chats_em_risco": [],
        "chats_sem_resposta": [],
        "chats_finalizados_hoje": 0,
        "technician_ranking": ranking,
        "summary": {
            "active": active,
            "pending": pending,
            "closed": closed,
            "unread": unread,
            "returns": returns,
            "potentials": potentials,
            "online_attendants": online_attendants,
        },
        "queues": queues,
        "connections": connections,
        "users": users,
    }


def get_dashboard_data():
    """Função auxiliar para obter dados do dashboard"""
    # Contagens de tickets por status
    status_counts = (
        Ticket.query.with_entities(Ticket.status, func.count(Ticket.id))
        .group_by(Ticket.status)
        .all()
    )
    status_counts = {status: count for status, count in status_counts}

    # Horas por usuário
    hours_by_user = (
        TimeEntry.query.with_entities(TimeEntry.user_id, func.sum(TimeEntry.hours))
        .group_by(TimeEntry.user_id)
        .all()
    )
    users = {u.id: u for u in User.query.filter_by(status="1").all()}
    hours_by_user = [(uid, hours) for uid, hours in hours_by_user if uid in users]

    # Tickets por cliente
    tickets_by_client = (
        Ticket.query.with_entities(Ticket.client_id, func.count(Ticket.id))
        .group_by(Ticket.client_id)
        .all()
    )
    clients = {c.id: c for c in Client.query.all()}

    # Ranking do mês: tickets fechados + ordens de serviço finalizadas (por técnico)
    brasilia_now = get_brasilia_now()
    current_month = brasilia_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    technician_ranking = []

    counts_by_user = defaultdict(int)

    technicians_this_month = (
        Ticket.query.with_entities(
            Ticket.assigned_to_id,
            func.count(Ticket.id).label('tickets_count')
        )
        .filter(
            and_(
                Ticket.status == 'fechado',
                Ticket.closed_at >= current_month,
                Ticket.assigned_to_id.isnot(None)
            )
        )
        .group_by(Ticket.assigned_to_id)
        .all()
    )
    for user_id, tickets_count in technicians_this_month:
        counts_by_user[user_id] += tickets_count

    os_this_month = (
        ServiceOrder.query.with_entities(
            ServiceOrder.technician_id,
            func.count(ServiceOrder.id).label('os_count')
        )
        .filter(
            and_(
                ServiceOrder.completion_date >= current_month,
                ServiceOrder.technician_id.isnot(None),
                ServiceOrder.status.in_((3, 5)),
            )
        )
        .group_by(ServiceOrder.technician_id)
        .all()
    )
    for user_id, os_count in os_this_month:
        counts_by_user[user_id] += os_count

    for user_id, total in counts_by_user.items():
        user = users.get(user_id)
        if user:
            technician_ranking.append({
                'name': user.name,
                'tickets_count': total,
            })

    technician_ranking.sort(key=lambda x: x['tickets_count'], reverse=True)

    # Tickets em andamento por técnico com informações detalhadas
    technicians_in_progress = []
    in_progress_tickets = (
        Ticket.query.filter(
            and_(
                Ticket.status == 'em_andamento',
                Ticket.assigned_to_id.isnot(None)
            )
        )
        .all()
    )
    
    # Agrupar por técnico
    technician_tickets = {}
    for ticket in in_progress_tickets:
        user_id = ticket.assigned_to_id
        if user_id not in technician_tickets:
            technician_tickets[user_id] = []
        technician_tickets[user_id].append(ticket)
    
    # Criar lista de técnicos com seus tickets e informações detalhadas
    for user_id, tickets in technician_tickets.items():
        user = users.get(user_id)
        if not user:
            continue
        # Calcular total de horas apontadas para este técnico
        total_hours = 0
        for ticket in tickets:
            ticket_hours = (
                TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
                .filter(TimeEntry.ticket_id == ticket.id)
                .scalar() or 0
            )
            total_hours += ticket_hours

        # Enriquecer tickets com informações adicionais
        enriched_tickets = []
        for ticket in tickets:
            # Buscar cliente (interno ou externo)
            if ticket.external_client_name:
                client_name = ticket.external_client_name
            elif ticket.client_id:
                client = clients.get(ticket.client_id)
                client_name = client.name if client else "Cliente não encontrado"
            else:
                client_name = "Cliente não encontrado"

            # Calcular horas do ticket
            ticket_hours = (
                TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
                .filter(TimeEntry.ticket_id == ticket.id)
                .scalar() or 0
            )

            # Calcular tempo em andamento para determinar cor do card
            now = get_brasilia_now()
            ticket_created_at = ticket.created_at

            # Se o ticket.created_at não tem timezone, assumir que é UTC e converter para Brasília
            if ticket_created_at:
                if ticket_created_at.tzinfo is None:
                    from datetime import timezone
                    import pytz
                    ticket_created_at = ticket_created_at.replace(tzinfo=timezone.utc)
                    brasilia_tz = pytz.timezone('America/Sao_Paulo')
                    ticket_created_at = ticket_created_at.astimezone(brasilia_tz)
            else:
                ticket_created_at = now

            time_in_progress = now - ticket_created_at
            hours_in_progress = time_in_progress.total_seconds() / 3600  # Converter para horas

            # Determinar cor baseada no tempo decorrido
            card_color = 'blue'  # Cor padrão
            if hours_in_progress >= 2:  # Vermelho após 2 horas
                card_color = 'red'
            elif hours_in_progress >= 1:  # Laranja após 1 hora
                card_color = 'orange'

            enriched_tickets.append({
                'id': ticket.id,
                'title': ticket.title,
                'client_name': client_name,
                'created_at': ticket.created_at,
                'hours': ticket_hours,
                'card_color': card_color
            })

        # Ordenar tickets por data (mais antigos primeiro)
        enriched_tickets.sort(key=lambda x: x['created_at'], reverse=False)

        # Limitar a 3 tickets por técnico
        enriched_tickets = enriched_tickets[:3]

        technicians_in_progress.append({
            'name': user.name,
            'tickets_count': len(tickets),
            'total_hours': total_hours,
            'tickets': enriched_tickets
        })
    
    # Ordenar técnicos por quantidade de tickets
    technicians_in_progress.sort(key=lambda x: x['tickets_count'], reverse=True)

    # Obter início e fim do dia atual em Brasília
    brasilia_now = get_brasilia_now()
    inicio_dia = brasilia_now.replace(hour=0, minute=0, second=0, microsecond=0)
    fim_dia = brasilia_now.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    # Tickets fechados hoje
    tickets_hoje_count = Ticket.query.filter(
        and_(
            Ticket.status == 'fechado',
            Ticket.closed_at >= inicio_dia,
            Ticket.closed_at <= fim_dia
        )
    ).count()

    # Faturamento do dia - Tickets fechados
    faturamento_tickets_hoje = Ticket.query.with_entities(func.sum(Ticket.total_cost)).filter(
        and_(
            Ticket.status == 'fechado',
            Ticket.closed_at >= inicio_dia,
            Ticket.closed_at <= fim_dia
        )
    ).scalar() or 0
    
    # Faturamento do dia - OS finalizadas
    faturamento_os_hoje = ServiceOrder.query.with_entities(func.sum(ServiceOrder.value)).filter(
        and_(
            ServiceOrder.status == 5,  # Status 5 = Finalizada com cobrança
            ServiceOrder.completion_date >= inicio_dia,
            ServiceOrder.completion_date <= fim_dia
        )
    ).scalar() or 0
    
    # Faturamento total do dia
    faturamento_hoje = faturamento_tickets_hoje + faturamento_os_hoje

    # Tickets finalizados no mês atual
    tickets_mes_count = Ticket.query.filter(
        and_(
            Ticket.status == 'fechado',
            Ticket.closed_at >= current_month
        )
    ).count()

    # OS finalizadas no mês atual
    os_mes_count = ServiceOrder.query.filter(ServiceOrder.completion_date >= current_month).count()

    return {
        'status_counts': status_counts,
        'hours_by_user': hours_by_user,
        'users': {uid: {'name': u.name, 'id': u.id} for uid, u in users.items()},
        'tickets_by_client': tickets_by_client,
        'clients': {cid: {'name': c.name, 'id': c.id} for cid, c in clients.items()},
        'technician_ranking': technician_ranking,
        'technicians_in_progress': technicians_in_progress,
        'total_users': len(users),
        'total_hours': sum(hours for _, hours in hours_by_user) or 0,
        'tickets_hoje_count': tickets_hoje_count,
        'faturamento_hoje': faturamento_hoje,
        'tickets_mes_count': tickets_mes_count,
        'os_mes_count': os_mes_count
    }




@bp.route("/dashboard")
@login_required
def index():
    """Página principal do dashboard"""
    data = get_dashboard_data()

    return render_template(
        "dashboard/index.html",
        status_counts=data['status_counts'],
        hours_by_user=data['hours_by_user'],
        users=list(data['users'].values()),
        tickets_by_client=data['tickets_by_client'],
        clients=list(data['clients'].values()),
        technician_ranking=data['technician_ranking'],
        technicians_in_progress=data['technicians_in_progress'],
        tickets_hoje_count=data['tickets_hoje_count'],
        faturamento_hoje=data['faturamento_hoje'],
        tickets_mes_count=data['tickets_mes_count'],
        os_mes_count=data['os_mes_count']
    )


@bp.route("/dashboard/helpdesk")
@login_required
def helpdesk_dashboard():
    """Dashboard específico do helpdesk"""
    data = get_helpdesk_dashboard_data()
    return render_template("dashboard/helpdesk.html", **data)


@bp.route("/api/dashboard/helpdesk")
@login_required
def api_helpdesk_dashboard():
    """API autenticada das métricas do Help Desk (engine WhatsApp)."""
    data = get_helpdesk_dashboard_data()
    payload = {
        "ok": bool(data.get("ok")),
        "error": data.get("error"),
        "status_counts": data.get("status_counts") or {},
        "summary": data.get("summary") or {},
        "queues": data.get("queues") or [],
        "connections": data.get("connections") or [],
        "users": data.get("users") or [],
        "technician_ranking": data.get("technician_ranking") or [],
        "timestamp": datetime.now().isoformat(),
    }
    return jsonify(payload)


@bp.route("/api/dashboard/data")
@login_required
def api_dashboard_data():
	"""API endpoint para obter dados do dashboard em tempo real"""
	try:
		data = get_dashboard_data()
		return jsonify({
			'success': True,
			'data': data,
			'timestamp': datetime.now().isoformat()
		})
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/tickets-dia")
@login_required
def api_tickets_dia():
	"""API endpoint para obter tickets fechados no dia atual"""
	try:
		# Data de hoje em Brasília
		hoje = get_brasilia_now()
		inicio_dia = hoje.replace(hour=0, minute=0, second=0, microsecond=0)
		fim_dia = hoje.replace(hour=23, minute=59, second=59, microsecond=999999)
		
		# Buscar tickets fechados hoje
		tickets_hoje = Ticket.query.filter(
			and_(
				Ticket.status == 'fechado',
				Ticket.closed_at >= inicio_dia,
				Ticket.closed_at <= fim_dia
			)
		).all()
		
		# Agrupar por usuário
		tickets_por_usuario = {}
		for ticket in tickets_hoje:
			user_id = ticket.assigned_to_id
			if user_id not in tickets_por_usuario:
				user = User.query.get(user_id)
				tickets_por_usuario[user_id] = {
					'nome': user.name if user else 'Usuário não encontrado',
					'tickets_count': 0,
					'tickets': []
				}
			
			# Buscar cliente (interno ou externo)
			if ticket.external_client_name:
				client_name = ticket.external_client_name
			elif ticket.client_id:
				client = Client.query.get(ticket.client_id)
				client_name = client.name if client else "Cliente não encontrado"
			else:
				client_name = "Cliente não encontrado"
			
			# Calcular horas do ticket
			ticket_hours = (
				TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
				.filter(TimeEntry.ticket_id == ticket.id)
				.scalar() or 0
			)
			
			tickets_por_usuario[user_id]['tickets'].append({
				'id': ticket.id,
				'title': ticket.title,
				'client_name': client_name,
				'hours': ticket_hours,
				'total_cost': ticket.total_cost or 0,
				'closed_at': ticket.closed_at.isoformat() if ticket.closed_at else None
			})
			tickets_por_usuario[user_id]['tickets_count'] += 1
		
		# Converter para lista e ordenar por quantidade de tickets
		tickets_por_usuario_list = list(tickets_por_usuario.values())
		tickets_por_usuario_list.sort(key=lambda x: x['tickets_count'], reverse=True)
		
		# Ordenar tickets de cada usuário por data de fechamento
		for usuario in tickets_por_usuario_list:
			usuario['tickets'].sort(key=lambda x: x['closed_at'] or '', reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_tickets': len(tickets_hoje),
				'tickets_por_usuario': tickets_por_usuario_list,
				'data': hoje.strftime('%d/%m/%Y')
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/faturamento-dia")
@login_required
def api_faturamento_dia():
	"""API endpoint para obter faturamento do dia por técnico"""
	try:
		# Data de hoje em Brasília
		hoje = get_brasilia_now()
		inicio_dia = hoje.replace(hour=0, minute=0, second=0, microsecond=0)
		fim_dia = hoje.replace(hour=23, minute=59, second=59, microsecond=999999)
		
		# Buscar tickets fechados hoje com faturamento
		tickets_hoje = Ticket.query.filter(
			and_(
				Ticket.status == 'fechado',
				Ticket.closed_at >= inicio_dia,
				Ticket.closed_at <= fim_dia,
				Ticket.total_cost > 0
			)
		).all()
		
		# Buscar OS finalizadas hoje com faturamento
		os_hoje = ServiceOrder.query.filter(
			and_(
				ServiceOrder.status == 5,  # Status 5 = Finalizada com cobrança
				ServiceOrder.completion_date >= inicio_dia,
				ServiceOrder.completion_date <= fim_dia,
				ServiceOrder.value > 0
			)
		).all()
		
		# Agrupar por usuário
		faturamento_por_usuario = {}
		total_faturamento = 0
		
		# Processar tickets fechados
		for ticket in tickets_hoje:
			user_id = ticket.assigned_to_id
			if user_id not in faturamento_por_usuario:
				user = User.query.get(user_id)
				faturamento_por_usuario[user_id] = {
					'nome': user.name if user else 'Usuário não encontrado',
					'faturamento_total': 0,
					'tickets_count': 0,
					'os_count': 0,
					'tickets': [],
					'os': []
				}
			
			# Buscar cliente (interno ou externo)
			if ticket.external_client_name:
				client_name = ticket.external_client_name
			elif ticket.client_id:
				client = Client.query.get(ticket.client_id)
				client_name = client.name if client else "Cliente não encontrado"
			else:
				client_name = "Cliente não encontrado"
			
			# Calcular horas do ticket
			ticket_hours = (
				TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
				.filter(TimeEntry.ticket_id == ticket.id)
				.scalar() or 0
			)
			
			ticket_value = ticket.total_cost or 0
			faturamento_por_usuario[user_id]['faturamento_total'] += ticket_value
			faturamento_por_usuario[user_id]['tickets_count'] += 1
			total_faturamento += ticket_value
			
			faturamento_por_usuario[user_id]['tickets'].append({
				'id': ticket.id,
				'title': ticket.title,
				'client_name': client_name,
				'hours': ticket_hours,
				'value': ticket_value,
				'closed_at': ticket.closed_at.isoformat() if ticket.closed_at else None,
				'type': 'ticket'
			})
		
		# Processar OS finalizadas
		for os in os_hoje:
			user_id = os.technician_id
			if user_id not in faturamento_por_usuario:
				user = User.query.get(user_id)
				faturamento_por_usuario[user_id] = {
					'nome': user.name if user else 'Usuário não encontrado',
					'faturamento_total': 0,
					'tickets_count': 0,
					'os_count': 0,
					'tickets': [],
					'os': []
				}
			
			os_value = os.value or 0
			faturamento_por_usuario[user_id]['faturamento_total'] += os_value
			faturamento_por_usuario[user_id]['os_count'] += 1
			total_faturamento += os_value
			
			faturamento_por_usuario[user_id]['os'].append({
				'id': os.id,
				'codigo': os.codigo,
				'client_name': os.client_name,
				'value': os_value,
				'completion_date': os.completion_date.isoformat() if os.completion_date else None,
				'type': 'os'
			})
		
		# Converter para lista e ordenar por faturamento
		faturamento_por_usuario_list = list(faturamento_por_usuario.values())
		faturamento_por_usuario_list.sort(key=lambda x: x['faturamento_total'], reverse=True)
		
		# Ordenar tickets e OS de cada usuário por valor
		for usuario in faturamento_por_usuario_list:
			usuario['tickets'].sort(key=lambda x: x['value'], reverse=True)
			usuario['os'].sort(key=lambda x: x['value'], reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_faturamento': total_faturamento,
				'faturamento_por_usuario': faturamento_por_usuario_list,
				'data': hoje.strftime('%d/%m/%Y')
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500
@bp.route("/api/dashboard/tickets-pendentes")
@login_required
def api_tickets_pendentes():
	"""API endpoint para obter tickets pendentes (abertos)"""
	try:
		# Buscar tickets abertos
		tickets_abertos = Ticket.query.filter(Ticket.status == 'aberto').all()
		
		# Agrupar por usuário
		tickets_por_usuario = {}
		
		for ticket in tickets_abertos:
			try:
				user_id = ticket.assigned_to_id
				if user_id not in tickets_por_usuario:
					user = User.query.get(user_id)
					tickets_por_usuario[user_id] = {
						'nome': user.name if user else 'Não atribuído',
						'tickets_count': 0,
						'tickets': []
					}
				
				# Buscar cliente (interno ou externo)
				client_name = "Cliente não encontrado"
				if ticket.external_client_name:
					client_name = ticket.external_client_name
				elif ticket.client_id:
					client = Client.query.get(ticket.client_id)
					if client:
						client_name = client.name
				
				tickets_por_usuario[user_id]['tickets_count'] += 1
				tickets_por_usuario[user_id]['tickets'].append({
					'id': ticket.id,
					'title': ticket.title,
					'client_name': client_name,
					'created_at': ticket.created_at.isoformat() if ticket.created_at else None,
					'priority': ticket.priority or 'normal'
				})
			except Exception as e:
				print(f"ERRO ao processar ticket {ticket.id} em tickets_pendentes: {e}")
				continue
		
		# Converter para lista e ordenar por quantidade de tickets
		tickets_por_usuario_list = list(tickets_por_usuario.values())
		tickets_por_usuario_list.sort(key=lambda x: x['tickets_count'], reverse=True)
		
		# Ordenar tickets de cada usuário por data de criação
		for usuario in tickets_por_usuario_list:
			usuario['tickets'].sort(key=lambda x: x['created_at'] or '', reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_tickets': len(tickets_abertos),
				'tickets_por_usuario': tickets_por_usuario_list
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/tickets-andamento")
@login_required
def api_tickets_andamento():
	"""API endpoint para obter tickets em andamento"""
	try:
		# Buscar tickets em andamento
		tickets_andamento = Ticket.query.filter(Ticket.status == 'em_andamento').all()
		
		# Agrupar por usuário
		tickets_por_usuario = {}
		
		for ticket in tickets_andamento:
			try:
				user_id = ticket.assigned_to_id
				if user_id not in tickets_por_usuario:
					user = User.query.get(user_id)
					tickets_por_usuario[user_id] = {
						'nome': user.name if user else 'Usuário não encontrado',
						'tickets_count': 0,
						'tickets': []
					}
				
				# Buscar cliente (interno ou externo)
				client_name = "Cliente não encontrado"
				if ticket.external_client_name:
					client_name = ticket.external_client_name
				elif ticket.client_id:
					client = Client.query.get(ticket.client_id)
					if client:
						client_name = client.name
				
				# Calcular horas trabalhadas
				ticket_hours = 0
				try:
					ticket_hours = (
						TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
						.filter(TimeEntry.ticket_id == ticket.id)
						.scalar() or 0
					)
				except:
					ticket_hours = 0
				
				# Calcular tempo em andamento para determinar cor do card
				now = get_brasilia_now()
				ticket_created_at = ticket.created_at
				
				# Se o ticket.created_at não tem timezone, assumir que é UTC e converter para Brasília
				if ticket_created_at:
					if ticket_created_at.tzinfo is None:
						from datetime import timezone
						import pytz
						ticket_created_at = ticket_created_at.replace(tzinfo=timezone.utc)
						brasilia_tz = pytz.timezone('America/Sao_Paulo')
						ticket_created_at = ticket_created_at.astimezone(brasilia_tz)
				else:
					# Se não tiver data de criação, assumir agora
					ticket_created_at = now
				
				time_in_progress = now - ticket_created_at
				hours_in_progress = time_in_progress.total_seconds() / 3600  # Converter para horas
				
				# Determinar cor baseada no tempo decorrido
				card_color = 'blue'  # Cor padrão
				if hours_in_progress >= 2:  # Vermelho após 2 horas
					card_color = 'red'
				elif hours_in_progress >= 1:  # Laranja após 1 hora
					card_color = 'orange'
				
				tickets_por_usuario[user_id]['tickets_count'] += 1
				tickets_por_usuario[user_id]['tickets'].append({
					'id': ticket.id,
					'title': ticket.title,
					'client_name': client_name,
					'hours': float(ticket_hours) if ticket_hours else 0,
					'started_at': ticket.in_progress_started_at.isoformat() if ticket.in_progress_started_at else None,
					'priority': ticket.priority or 'normal',
					'card_color': card_color
				})
			except Exception as e:
				print(f"ERRO ao processar ticket {ticket.id} em tickets_andamento: {e}")
				continue
		
		# Converter para lista e ordenar por quantidade de tickets
		tickets_por_usuario_list = list(tickets_por_usuario.values())
		tickets_por_usuario_list.sort(key=lambda x: x['tickets_count'], reverse=True)
		
		# Ordenar tickets de cada usuário por data de início (mais antigos primeiro) e limitar a 3
		for usuario in tickets_por_usuario_list:
			usuario['tickets'].sort(key=lambda x: x['started_at'] or '', reverse=False)
			usuario['tickets'] = usuario['tickets'][:3]
		
		return jsonify({
			'success': True,
			'data': {
				'total_tickets': len(tickets_andamento),
				'tickets_por_usuario': tickets_por_usuario_list
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/tickets-mes")
@login_required
def api_tickets_mes():
	"""API endpoint para obter tickets finalizados no mês atual"""
	try:
		# Início do mês atual em Brasília
		brasilia_now = get_brasilia_now()
		current_month = brasilia_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
		
		# Buscar tickets finalizados no mês atual
		tickets_mes = Ticket.query.filter(
			and_(
				Ticket.status == 'fechado',
				Ticket.closed_at >= current_month
			)
		).all()
		
		# Agrupar por usuário
		tickets_por_usuario = {}
		
		for ticket in tickets_mes:
			try:
				user_id = ticket.assigned_to_id
				if user_id not in tickets_por_usuario:
					user = User.query.get(user_id) if user_id else None
					tickets_por_usuario[user_id] = {
						'nome': user.name if user else 'Não atribuído',
						'tickets_count': 0,
						'tickets': []
					}
				
				# Buscar cliente (interno ou externo)
				client_name = "Cliente não encontrado"
				if ticket.external_client_name:
					client_name = ticket.external_client_name
				elif ticket.client_id:
					client = Client.query.get(ticket.client_id)
					if client:
						client_name = client.name
				
				# Calcular horas trabalhadas
				ticket_hours = 0
				try:
					ticket_hours = (
						TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
						.filter(TimeEntry.ticket_id == ticket.id)
						.scalar() or 0
					)
				except:
					ticket_hours = 0
				
				# Determinar cor baseada no status do ticket
				card_color = 'blue'
				if ticket.status == 'fechado':
					card_color = 'green'
				elif ticket.status == 'em_andamento':
					card_color = 'orange'
				elif ticket.status == 'aberto':
					card_color = 'red'
				
				tickets_por_usuario[user_id]['tickets_count'] += 1
				tickets_por_usuario[user_id]['tickets'].append({
					'id': ticket.id,
					'title': ticket.title,
					'client_name': client_name,
					'hours': float(ticket_hours) if ticket_hours else 0,
					'created_at': ticket.created_at.isoformat() if ticket.created_at else None,
					'closed_at': ticket.closed_at.isoformat() if ticket.closed_at else None,
					'status': ticket.status or 'aberto',
					'priority': ticket.priority or 'normal',
					'card_color': card_color
				})
			except Exception as e:
				print(f"ERRO ao processar ticket {ticket.id} em tickets_mes: {e}")
				continue
		
		# Converter para lista e ordenar por quantidade de tickets
		tickets_por_usuario_list = list(tickets_por_usuario.values())
		tickets_por_usuario_list.sort(key=lambda x: x['tickets_count'], reverse=True)
		
		# Ordenar tickets de cada usuário por data de criação (mais recentes primeiro)
		for usuario in tickets_por_usuario_list:
			usuario['tickets'].sort(key=lambda x: x['created_at'] or '', reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_tickets': len(tickets_mes),
				'tickets_por_usuario': tickets_por_usuario_list
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/os-mes")
@login_required
def api_os_mes():
	"""API endpoint para obter ordens de serviço finalizadas no mês atual"""
	try:
		# Início do mês atual em Brasília
		brasilia_now = get_brasilia_now()
		current_month = brasilia_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
		
		# Buscar OS finalizadas no mês atual
		os_mes = ServiceOrder.query.filter(ServiceOrder.completion_date >= current_month).all()
		
		# Agrupar por usuário
		os_por_usuario = {}
		
		for os in os_mes:
			try:
				user_id = os.technician_id
				if user_id not in os_por_usuario:
					user = User.query.get(user_id) if user_id else None
					os_por_usuario[user_id] = {
						'nome': user.name if user else 'Não atribuído',
						'os_count': 0,
						'os_list': []
					}
				
				os_por_usuario[user_id]['os_count'] += 1
				os_por_usuario[user_id]['os_list'].append({
					'id': os.id,
					'codigo': os.codigo,
					'client_name': os.client_name,
					'value': os.value or 0.0,
					'completion_date': os.completion_date.isoformat() if os.completion_date else None,
					'status': os.status,
					'equipment': os.equipment or 'Não especificado',
					'service_executed': os.service_executed or 'Não especificado',
					'no_charge': os.no_charge
				})
			except Exception as e:
				print(f"ERRO ao processar OS {os.codigo} em os_mes: {e}")
				continue
		
		# Converter para lista e ordenar por quantidade de OS
		os_por_usuario_list = list(os_por_usuario.values())
		os_por_usuario_list.sort(key=lambda x: x['os_count'], reverse=True)
		
		# Ordenar OS de cada usuário por data de conclusão (mais recentes primeiro)
		for usuario in os_por_usuario_list:
			usuario['os_list'].sort(key=lambda x: x['completion_date'] or '', reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_os': len(os_mes),
				'os_por_usuario': os_por_usuario_list
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/tickets-fechados")
@login_required
def api_tickets_fechados():
	"""API endpoint para obter tickets fechados"""
	try:
		# Buscar tickets fechados
		tickets_fechados = Ticket.query.filter(Ticket.status == 'fechado').all()
		
		# Agrupar por usuário
		tickets_por_usuario = {}
		
		for ticket in tickets_fechados:
			try:
				user_id = ticket.assigned_to_id
				if user_id not in tickets_por_usuario:
					user = User.query.get(user_id)
					tickets_por_usuario[user_id] = {
						'nome': user.name if user else 'Usuário não encontrado',
						'tickets_count': 0,
						'tickets': []
					}
				
				# Buscar cliente (interno ou externo)
				client_name = "Cliente não encontrado"
				if ticket.external_client_name:
					client_name = ticket.external_client_name
				elif ticket.client_id:
					client = Client.query.get(ticket.client_id)
					if client:
						client_name = client.name
				
				# Calcular horas trabalhadas
				ticket_hours = 0
				try:
					ticket_hours = (
						TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
						.filter(TimeEntry.ticket_id == ticket.id)
						.scalar() or 0
					)
				except:
					ticket_hours = 0
				
				tickets_por_usuario[user_id]['tickets_count'] += 1
				tickets_por_usuario[user_id]['tickets'].append({
					'id': ticket.id,
					'title': ticket.title,
					'client_name': client_name,
					'hours': float(ticket_hours) if ticket_hours else 0,
					'closed_at': ticket.closed_at.isoformat() if ticket.closed_at else None,
					'value': float(ticket.total_cost) if ticket.total_cost else 0
				})
			except Exception as e:
				print(f"ERRO ao processar ticket {ticket.id} em tickets_fechados: {e}")
				continue
		
		# Converter para lista e ordenar por quantidade de tickets
		tickets_por_usuario_list = list(tickets_por_usuario.values())
		tickets_por_usuario_list.sort(key=lambda x: x['tickets_count'], reverse=True)
		
		# Ordenar tickets de cada usuário por data de fechamento
		for usuario in tickets_por_usuario_list:
			usuario['tickets'].sort(key=lambda x: x['closed_at'] or '', reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_tickets': len(tickets_fechados),
				'tickets_por_usuario': tickets_por_usuario_list
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500


@bp.route("/api/dashboard/total-horas")
@login_required
def api_total_horas():
	"""API endpoint para obter total de horas trabalhadas por usuário"""
	try:
		# Buscar horas por usuário de forma mais simples
		hours_data = []
		total_hours = 0
		
		# Buscar todos os usuários
		users = User.query.filter_by(status="1").all()
		
		for user in users:
			# Buscar horas do usuário
			user_hours = (
				TimeEntry.query.with_entities(func.sum(TimeEntry.hours))
				.join(Ticket, TimeEntry.ticket_id == Ticket.id)
				.filter(
					TimeEntry.user_id == user.id,
					Ticket.status != 'cancelado'
				)
				.scalar() or 0
			)
			
			# Contar apontamentos
			entries_count = (
				TimeEntry.query.join(Ticket, TimeEntry.ticket_id == Ticket.id)
				.filter(
					TimeEntry.user_id == user.id,
					Ticket.status != 'cancelado'
				)
				.count()
			)
			
			if user_hours > 0:  # Só incluir usuários com horas
				hours_data.append({
					'user_id': user.id,
					'nome': user.name,
					'total_hours': float(user_hours),
					'entries_count': entries_count
				})
				total_hours += float(user_hours)
		
		# Ordenar por horas
		hours_data.sort(key=lambda x: x['total_hours'], reverse=True)
		
		return jsonify({
			'success': True,
			'data': {
				'total_hours': total_hours,
				'hours_by_user': hours_data
			},
			'timestamp': datetime.now().isoformat()
		})
		
	except Exception as e:
		return jsonify({
			'success': False,
			'error': str(e),
			'timestamp': datetime.now().isoformat()
		}), 500

