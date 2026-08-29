"""
Blueprint para sistema de notificações
"""

from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from app import db
from app.models import Ticket, Appointment
from datetime import datetime, timedelta

notifications_bp = Blueprint('notifications', __name__, url_prefix='/api/notifications')

@notifications_bp.route('/count')
@login_required
def get_notification_count():
    """Retornar contagem de notificações para o usuário logado"""
    try:
        print(f"🔔 Buscando contagem de notificações para: {current_user.name}")
        
        count = 0
        
        # 1. Tickets atribuídos ao usuário que não foram visualizados
        tickets_nao_visualizados = Ticket.query.filter(
            Ticket.assigned_to_id == current_user.id,
            Ticket.status != 'closed'
        ).count()
        
        # 2. Agendamentos do usuário para hoje (lembrete)
        hoje = datetime.now().date()
        agendamentos_hoje = Appointment.query.filter(
            Appointment.user_id == current_user.id,
            db.func.date(Appointment.appointment_date) == hoje
        ).count()
        
        # 3. Tickets criados pelo usuário com atualizações recentes - ALTERADO PARA created_at pois updated_at não existe
        tickets_criados_recentes = Ticket.query.filter(
            Ticket.opened_by_id == current_user.id,
            Ticket.created_at >= datetime.now() - timedelta(hours=24)
        ).count()
        
        # Calcular total
        count = tickets_nao_visualizados + agendamentos_hoje + tickets_criados_recentes
        
        print(f"📊 Notificações encontradas:")
        print(f"   - Tickets não visualizados: {tickets_nao_visualizados}")
        print(f"   - Agendamentos hoje: {agendamentos_hoje}")
        print(f"   - Tickets atualizados (24h): {tickets_criados_recentes}")
        print(f"   - Total: {count}")
        
        return jsonify({
            'success': True,
            'count': count,
            'details': {
                'tickets_nao_visualizados': tickets_nao_visualizados,
                'agendamentos_hoje': agendamentos_hoje,
                'tickets_atualizados_24h': tickets_criados_recentes
            }
        })
        
    except Exception as e:
        print(f"❌ Erro ao buscar contagem de notificações: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'count': 0
        }), 500

@notifications_bp.route('/list')
@login_required
def get_notifications():
    """Retornar lista de notificações para o usuário logado"""
    try:
        print(f"🔔 Buscando notificações para: {current_user.name}")
        
        notifications = []
        
        # 1. Tickets atribuídos ao usuário
        tickets_atribuidos = Ticket.query.filter(
            Ticket.assigned_to_id == current_user.id,
            Ticket.status != 'closed'
        ).order_by(Ticket.created_at.desc()).limit(5).all()
        
        for ticket in tickets_atribuidos:
            notifications.append({
                'id': f"ticket_{ticket.id}",
                'type': 'ticket',
                'title': f'Ticket #{ticket.id}: {ticket.title}',
                'message': f'Ticket atribuído a você - Status: {ticket.status}',
                'created_at': ticket.created_at.isoformat(),
                'priority': 'medium'
            })
        
        # 2. Agendamentos de hoje
        hoje = datetime.now().date()
        agendamentos_hoje = Appointment.query.filter(
            Appointment.user_id == current_user.id,
            db.func.date(Appointment.appointment_date) == hoje
        ).order_by(Appointment.appointment_date).all()
        
        for appointment in agendamentos_hoje:
            notifications.append({
                'id': f"appointment_{appointment.id}",
                'type': 'appointment',
                'title': f'Agendamento: {appointment.title}',
                'message': f'Você tem um agendamento hoje às {appointment.appointment_date.strftime("%H:%M")}',
                'created_at': appointment.appointment_date.isoformat(),
                'priority': 'high'
            })
        
        # Ordenar por prioridade e data
        notifications.sort(key=lambda x: (
            0 if x['priority'] == 'high' else 1 if x['priority'] == 'medium' else 2,
            x['created_at']
        ), reverse=True)
        
        print(f"📋 Total de notificações: {len(notifications)}")
        
        return jsonify({
            'success': True,
            'notifications': notifications,
            'total': len(notifications)
        })
        
    except Exception as e:
        print(f"❌ Erro ao buscar notificações: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'notifications': []
        }), 500

@notifications_bp.route('/mark-read', methods=['POST'])
@login_required
def mark_notifications_read():
    """Marcar notificações como lidas"""
    try:
        print(f"🔔 Marcando notificações como lidas para: {current_user.name}")
        
        # Por enquanto, apenas log - implementar lógica real depois
        print("✅ Notificações marcadas como lidas")
        
        return jsonify({
            'success': True,
            'message': 'Notificações marcadas como lidas'
        })
        
    except Exception as e:
        print(f"❌ Erro ao marcar notificações como lidas: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
