from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for
from flask_login import login_required, current_user
from datetime import datetime, timedelta
from app import db
from app.models import User, Client, Service, Ticket, Appointment, ShiftSwap
from app.timezone_utils import get_brasilia_now, brasilia_to_utc, utc_to_brasilia
from app.external_pg import fetch_external_clients
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

agenda_bp = Blueprint('agenda', __name__, url_prefix='/agenda')

# Cores para cada usuário
USER_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
    '#14b8a6', '#eab308', '#dc2626', '#7c3aed', '#059669'
]


def get_easter_date(year: int):
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return datetime(year, month, day).date()


def get_brazil_national_holidays(year: int):
    easter = get_easter_date(year)
    return {
        datetime(year, 1, 1).date(): 'Confraternização Universal (Ano Novo)',
        easter - timedelta(days=47): 'Carnaval',
        easter - timedelta(days=2): 'Sexta-feira Santa',
        easter: 'Páscoa',
        datetime(year, 4, 21).date(): 'Tiradentes',
        datetime(year, 5, 1).date(): 'Dia do Trabalhador',
        easter + timedelta(days=60): 'Corpus Christi',
        datetime(year, 9, 7).date(): 'Independência do Brasil',
        datetime(year, 10, 12).date(): 'Nossa Senhora Aparecida',
        datetime(year, 11, 2).date(): 'Finados',
        datetime(year, 11, 15).date(): 'Proclamação da República',
        datetime(year, 11, 20).date(): 'Dia Nacional de Zumbi e da Consciência Negra',
        datetime(year, 12, 25).date(): 'Natal',
    }


def generate_national_holiday_events(start_dt, end_dt):
    """
    Gera eventos de feriados nacionais no Brasil para o período entre start_dt e end_dt.
    """
    events = []
    start_date = start_dt.date()
    end_date = end_dt.date()

    for year in range(start_date.year, end_date.year + 1):
        holidays = get_brazil_national_holidays(year)
        for holiday_date, name in holidays.items():
            if start_date <= holiday_date <= end_date:
                events.append({
                    'id': f'holiday-{holiday_date.isoformat()}',
                    'title': f'🇧🇷 Feriado: {name}',
                    'start': holiday_date.isoformat(),
                    'allDay': True,
                    'color': '#ef4444',  # Vermelho destaque para feriados
                    'textColor': '#ffffff',
                    'extendedProps': {
                        'type': 'national_holiday',
                        'name': name,
                        'date_str': holiday_date.strftime('%d/%m/%Y'),
                        'description': f'Feriado Nacional no Brasil: {name}'
                    }
                })
    return events


def generate_saturday_shift_events(start_dt, end_dt, user_filter=False, user=None):
    """
    Gera eventos de folga/plantão aos sábados entre start_dt e end_dt.
    Referência: 25/07/2026 -> Equipe 1 em Folga.
    """
    events = []
    ref_saturday = datetime(2026, 7, 25).date()
    
    # Buscar usuários ativos por equipe
    equipe1_users_base = User.query.filter_by(team='Equipe 1', status='1').order_by(User.name).all()
    equipe2_users_base = User.query.filter_by(team='Equipe 2', status='1').order_by(User.name).all()

    user_team = getattr(user, 'team', None)

    cur = start_dt.date()
    end_date = end_dt.date()

    # Avançar cur para o primeiro sábado no intervalo
    days_ahead = (5 - cur.weekday()) % 7
    cur = cur + timedelta(days=days_ahead)

    while cur <= end_date:
        weeks_diff = (cur - ref_saturday).days // 7
        if weeks_diff % 2 == 0:
            off_team = "Equipe 1"
            work_team = "Equipe 2"
            off_users_base = list(equipe1_users_base)
            work_users_base = list(equipe2_users_base)
            color = "#8b5cf6"  # Roxo
        else:
            off_team = "Equipe 2"
            work_team = "Equipe 1"
            off_users_base = list(equipe2_users_base)
            work_users_base = list(equipe1_users_base)
            color = "#f59e0b"  # Laranja

        # Aplicar trocas temporárias para esta data (apenas aceitas)
        swaps = ShiftSwap.query.filter_by(swap_date=cur, status='accepted').all()
        user_is_swapped_to_work = False
        user_is_swapped_to_off = False
        swap_info_list = []

        for swap in swaps:
            u1 = next((u for u in off_users_base if u.id == swap.user_1_id or u.id == swap.user_2_id), None)
            u2 = next((u for u in work_users_base if u.id == swap.user_1_id or u.id == swap.user_2_id), None)

            if u1 and u2:
                off_users_base.remove(u1)
                work_users_base.append(u1)

                work_users_base.remove(u2)
                off_users_base.append(u2)

                swap_info_list.append(f"{u1.name} ⇄ {u2.name}")

                if user and user.id == u1.id:
                    user_is_swapped_to_work = True
                elif user and user.id == u2.id:
                    user_is_swapped_to_off = True

        off_users_names = [u.name for u in off_users_base]
        work_users_names = [u.name for u in work_users_base]

        is_my_team = user_team in ["Equipe 1", "Equipe 2"]
        is_my_team_off = (user_team == off_team)
        if user_is_swapped_to_work:
            is_my_team_off = False
        elif user_is_swapped_to_off:
            is_my_team_off = True

        if user_filter and is_my_team:
            if is_my_team_off:
                title = f"🏖️ Minha Folga ({off_team})"
                display_color = "#10b981"  # Verde
            else:
                title = f"🔧 Meu Plantão ({work_team})"
                display_color = "#3b82f6"  # Azul
        else:
            title = f"🏖️ Folga: {off_team}"
            display_color = color

        desc = f"Folga: {off_team} | Plantão: {work_team}"
        if swap_info_list:
            desc += f" (Trocas: {', '.join(swap_info_list)})"

        events.append({
            'id': f'shift-{cur.isoformat()}',
            'title': title,
            'start': cur.isoformat(),
            'allDay': True,
            'color': display_color,
            'textColor': '#ffffff',
            'extendedProps': {
                'type': 'saturday_shift',
                'date_str': cur.strftime('%d/%m/%Y'),
                'off_team': off_team,
                'work_team': work_team,
                'off_users': off_users_names,
                'work_users': work_users_names,
                'is_my_team_off': is_my_team_off,
                'swaps': swap_info_list,
                'description': desc
            }
        })
        cur += timedelta(days=7)

    return events

@agenda_bp.route('/')
@login_required
def index():
    """Página principal da agenda com calendário"""
    today = get_brasilia_now().date()
    if today.weekday() == 6:  # Domingo
        saturday = today - timedelta(days=1)
    else:
        saturday = today + timedelta(days=(5 - today.weekday()))

    ref_saturday = datetime(2026, 7, 25).date()
    weeks_diff = (saturday - ref_saturday).days // 7

    if weeks_diff % 2 == 0:
        off_team = "Equipe 1"
        work_team = "Equipe 2"
    else:
        off_team = "Equipe 2"
        work_team = "Equipe 1"

    # Aplicar trocas temporárias para este sábado específico (apenas aceitas)
    swaps = ShiftSwap.query.filter_by(swap_date=saturday, status='accepted').all()
    equipe_1_users_base = list(User.query.filter_by(team='Equipe 1', status='1').order_by(User.name).all())
    equipe_2_users_base = list(User.query.filter_by(team='Equipe 2', status='1').order_by(User.name).all())

    off_users_list = equipe_1_users_base if off_team == "Equipe 1" else equipe_2_users_base
    work_users_list = equipe_2_users_base if off_team == "Equipe 1" else equipe_1_users_base

    swap_descriptions = []
    for swap in swaps:
        u1 = next((u for u in off_users_list if u.id == swap.user_1_id or u.id == swap.user_2_id), None)
        u2 = next((u for u in work_users_list if u.id == swap.user_1_id or u.id == swap.user_2_id), None)
        if u1 and u2:
            off_users_list.remove(u1)
            work_users_list.append(u1)

            work_users_list.remove(u2)
            off_users_list.append(u2)
            swap_descriptions.append({
                'id': swap.id,
                'user1_name': u1.name,
                'user2_name': u2.name
            })

    saturday_info = {
        'date_str': saturday.strftime('%d/%m/%Y'),
        'off_team': off_team,
        'work_team': work_team,
        'off_users': off_users_list,
        'work_users': work_users_list,
        'swaps': swap_descriptions
    }

    # Buscar solicitações de troca pendentes direcionadas ao usuário atual (ou todas se for admin)
    if current_user.has_role('admin'):
        pending_swaps = ShiftSwap.query.filter_by(status='pending').all()
    else:
        pending_swaps = ShiftSwap.query.filter(
            (ShiftSwap.status == 'pending') &
            ((ShiftSwap.user_1_id == current_user.id) | (ShiftSwap.user_2_id == current_user.id)) &
            (ShiftSwap.requested_by_id != current_user.id)
        ).all()

    return render_template('agenda/index.html', saturday_info=saturday_info, pending_swaps=pending_swaps)

@agenda_bp.route('/calendario')
@login_required
def calendario():
    """API para buscar eventos do calendário"""
    print(f"📅 API calendário chamada por: {current_user.name}")
    
    start_date = request.args.get('start')
    end_date = request.args.get('end')
    user_filter = request.args.get('user_filter', 'false').lower() == 'true'
    
    print(f"📅 Período solicitado: {start_date} até {end_date}")
    print(f"👤 Filtro de usuário ativo: {user_filter}")
    
    if not start_date or not end_date:
        print("❌ Datas não fornecidas")
        return jsonify([])
    
    try:
        start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        
        print(f"📅 Datas convertidas: {start} até {end}")
        
        # Query base
        query = Appointment.query.filter(
            Appointment.appointment_date >= start,
            Appointment.appointment_date <= end
        )
        
        # Aplicar filtro de usuário se solicitado
        if user_filter:
            query = query.filter(Appointment.user_id == current_user.id)
            print(f"👤 Aplicando filtro para usuário: {current_user.name} (ID: {current_user.id})")
        
        appointments = query.all()
        
        print(f"📅 Agendamentos encontrados: {len(appointments)}")
        
        events = []
        
        # Buscar clientes externos para mapear nomes
        external_clients = {}
        try:
            clients_data = fetch_external_clients()
            external_clients = {c.get('id'): c.get('name', 'Cliente não encontrado') for c in clients_data}
        except Exception as e:
            print(f"❌ Erro ao buscar clientes externos: {e}")
        
        for appointment in appointments:
            user_color = USER_COLORS[appointment.user_id % len(USER_COLORS)]
            
            # Buscar nome do cliente
            client_name = external_clients.get(appointment.client_id, f'Cliente ID: {appointment.client_id}')
            
            events.append({
                'id': appointment.id,
                'title': appointment.title,
                'start': appointment.appointment_date.isoformat(),
                'end': (appointment.appointment_date + timedelta(hours=1)).isoformat(),
                'color': user_color,
                'description': appointment.description,
                'client_name': client_name,
                'service_name': appointment.service.name if appointment.service else 'Serviço não definido',
                'user_name': appointment.user.name if appointment.user else 'Usuário não definido',
                'client_id': appointment.client_id,
                'user_id': appointment.user_id,
                'service_id': appointment.service_id,
                'extendedProps': {
                    'type': 'appointment',
                    'description': appointment.description,
                    'client_name': client_name,
                    'service_name': appointment.service.name if appointment.service else 'Serviço não definido',
                    'user_name': appointment.user.name if appointment.user else 'Usuário não definido',
                    'appointment_id': appointment.id,
                    'client_id': appointment.client_id,
                    'user_id': appointment.user_id,
                    'service_id': appointment.service_id,
                }
            })
        
        # Adicionar eventos de revezamento de sábados
        shift_events = generate_saturday_shift_events(start, end, user_filter=user_filter, user=current_user)
        events.extend(shift_events)

        # Adicionar eventos de feriados nacionais
        holiday_events = generate_national_holiday_events(start, end)
        events.extend(holiday_events)

        print(f"📅 Eventos processados (incluindo sábados e feriados): {len(events)}")
        
        return jsonify(events)
    
    except Exception as e:
        print(f"❌ Erro na API calendário: {e}")
        return jsonify({'error': str(e)}), 500

@agenda_bp.route('/novo', methods=['GET', 'POST'])
@login_required
def novo_agendamento():
    """Criar novo agendamento"""
    if request.method == 'POST':
        try:
            data = request.get_json()
            print(f"📝 Dados recebidos para novo agendamento: {data}")
            
            # Validar dados
            required_fields = ['title', 'appointment_date', 'client_id', 'user_id']
            for field in required_fields:
                if not data.get(field):
                    print(f"❌ Campo obrigatório ausente: {field}")
                    return jsonify({'error': f'Campo {field} é obrigatório'}), 400
            
            # Converter data
            appointment_date = datetime.fromisoformat(data['appointment_date'].replace('Z', '+00:00'))
            print(f"📅 Data convertida: {appointment_date}")
            
            # Buscar dados do cliente externo
            client_data = None
            if data.get('client_id'):
                try:
                    external_clients = fetch_external_clients()
                    client_data = next((c for c in external_clients if c.get('id') == int(data['client_id'])), None)
                    print(f"👤 Dados do cliente encontrado: {client_data}")
                except Exception as e:
                    print(f"❌ Erro ao buscar cliente externo: {e}")
            
            # Criar agendamento
            appointment = Appointment(
                title=data['title'],
                description=data.get('description', ''),
                appointment_date=appointment_date,
                client_id=data['client_id'],
                user_id=data['user_id'],
                service_id=data.get('service_id'),
                created_by=current_user.id
            )
            
            print(f"📋 Agendamento criado: {appointment}")
            
            db.session.add(appointment)
            db.session.commit()
            
            print(f"✅ Agendamento salvo com sucesso: ID {appointment.id}")
            from ..notification_service import create_notifications
            create_notifications(
                [appointment.user_id],
                notification_type="appointment",
                title="Novo agendamento",
                message=f"{appointment.title} · {appointment.get_formatted_date()}",
                url="/agenda",
                entity_type="appointment",
                entity_id=appointment.id,
            )
            
            # Enviar email de confirmação
            email_enviado = enviar_email_confirmacao(appointment)
            if email_enviado:
                print(f"✅ Email de confirmação enviado para: {appointment.user.email}")
            else:
                print(f"❌ Falha ao enviar email de confirmação para: {appointment.user.email}")
            
            return jsonify({
                'success': True,
                'message': 'Agendamento criado com sucesso!',
                'appointment_id': appointment.id,
                'email_enviado': email_enviado
            })
            
        except Exception as e:
            print(f"❌ Erro ao criar agendamento: {e}")
            db.session.rollback()
            return jsonify({'error': str(e)}), 500
    
    # GET - Mostrar formulário (dados serão carregados via AJAX)
    return render_template('agenda/novo.html')

@agenda_bp.route('/<int:appointment_id>')
@login_required
def visualizar(appointment_id):
    """Visualizar detalhes do agendamento"""
    appointment = Appointment.query.get_or_404(appointment_id)
    return render_template('agenda/visualizar.html', appointment=appointment)

@agenda_bp.route('/<int:appointment_id>/editar', methods=['GET', 'POST'])
@login_required
def editar(appointment_id):
    """Editar agendamento"""
    appointment = Appointment.query.get_or_404(appointment_id)
    
    if request.method == 'POST':
        try:
            data = request.get_json()
            
            # Atualizar dados
            appointment.title = data['title']
            appointment.description = data.get('description', '')
            appointment.appointment_date = datetime.fromisoformat(data['appointment_date'].replace('Z', '+00:00'))
            appointment.client_id = data['client_id']
            appointment.user_id = data['user_id']
            appointment.service_id = data.get('service_id')
            
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Agendamento atualizado com sucesso!'
            })
            
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': str(e)}), 500
    
    # GET - Mostrar formulário de edição
    clients = Client.query.filter_by(active=True).order_by(Client.name).all()
    users = User.query.filter_by(active=True).order_by(User.name).all()
    services = Service.query.filter_by(active=True).order_by(Service.name).all()
    
    return render_template('agenda/editar.html', 
                         appointment=appointment,
                         clients=clients, 
                         users=users, 
                         services=services)

@agenda_bp.route('/<int:appointment_id>/excluir', methods=['POST'])
@login_required
def excluir(appointment_id):
    """Excluir agendamento"""
    appointment = Appointment.query.get_or_404(appointment_id)
    
    try:
        db.session.delete(appointment)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Agendamento excluído com sucesso!'
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@agenda_bp.route('/testar-lembretes')
@login_required
def testar_lembretes():
    """Testar envio de lembretes manualmente"""
    try:
        print(f"🧪 Teste manual de lembretes iniciado por: {current_user.name}")
        
        # Buscar todos os agendamentos (para teste)
        appointments = Appointment.query.all()
        
        print(f"📋 Total de agendamentos encontrados: {len(appointments)}")
        
        emails_enviados = 0
        tickets_criados = 0
        
        for appointment in appointments:
            print(f"📝 Testando agendamento: {appointment.title}")
            
            # Testar envio de email
            if enviar_email_lembrete(appointment):
                emails_enviados += 1
                print(f"✅ Email de teste enviado para: {appointment.user.name}")
            else:
                print(f"❌ Falha no email de teste para: {appointment.user.name}")
            
            # Testar criação de ticket
            if criar_ticket_automatico(appointment):
                tickets_criados += 1
                print(f"✅ Ticket de teste criado para: {appointment.title}")
            else:
                print(f"❌ Falha no ticket de teste para: {appointment.title}")
        
        result = {
            'success': True,
            'message': f'Teste concluído - Processados {len(appointments)} agendamentos',
            'emails_enviados': emails_enviados,
            'tickets_criados': tickets_criados
        }
        
        print(f"📊 Resultado do teste: {result}")
        return jsonify(result)
        
    except Exception as e:
        print(f"❌ Erro no teste de lembretes: {e}")
        return jsonify({'error': str(e)}), 500

@agenda_bp.route('/testar-novo-scheduler')
@login_required
def testar_novo_scheduler():
    """Testar o novo sistema de scheduler que envia lembretes 30min antes"""
    try:
        from app.scheduler import testar_scheduler
        
        # Executar teste
        testar_scheduler()
        
        return jsonify({
            'success': True,
            'message': 'Teste do novo scheduler executado com sucesso! Verifique os logs do servidor.'
        })
        
    except Exception as e:
        print(f"❌ Erro no teste do novo scheduler: {e}")
        return jsonify({'error': str(e)}), 500

@agenda_bp.route('/lembretes')
@login_required
def enviar_lembretes():
    """Enviar lembretes de agendamentos do dia"""
    try:
        print(f"📧 Iniciando envio de lembretes por: {current_user.name}")
        
        # Usar timezone do Brasil
        hoje_brasilia = get_brasilia_now().date()
        print(f"📅 Data de hoje (Brasília): {hoje_brasilia}")
        
        # Buscar agendamentos de hoje que ainda não tiveram lembretes enviados
        appointments = Appointment.query.filter(
            db.func.date(Appointment.appointment_date) == hoje_brasilia,
            Appointment.reminder_sent == False  # Só processar se não foi enviado
        ).all()
        
        print(f"📋 Agendamentos encontrados para hoje (sem lembretes): {len(appointments)}")
        
        emails_enviados = 0
        tickets_criados = 0
        
        for appointment in appointments:
            print(f"📝 Processando agendamento: {appointment.title}")
            
            # Enviar email de lembrete
            if enviar_email_lembrete(appointment):
                emails_enviados += 1
                print(f"✅ Email enviado para: {appointment.user.name}")
                
                # Marcar como lembrente enviado
                appointment.reminder_sent = True
                db.session.commit()
            else:
                print(f"❌ Falha ao enviar email para: {appointment.user.name}")
            
            # Criar ticket automaticamente (só se não existir)
            if criar_ticket_automatico(appointment):
                tickets_criados += 1
                print(f"✅ Ticket criado para: {appointment.title}")
            else:
                print(f"❌ Falha ao criar ticket para: {appointment.title}")
        
        result = {
            'success': True,
            'message': f'Processados {len(appointments)} agendamentos',
            'emails_enviados': emails_enviados,
            'tickets_criados': tickets_criados
        }
        
        print(f"📊 Resultado final: {result}")
        return jsonify(result)
        
    except Exception as e:
        print(f"❌ Erro no envio de lembretes: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

def enviar_email_lembrete(appointment):
    """Enviar email de lembrete para o usuário"""
    try:
        print(f"📧 Tentando enviar email para: {appointment.user.name if appointment.user else 'Usuário não encontrado'}")
        
        if not appointment.user or not appointment.user.email:
            print(f"❌ Usuário ou email não encontrado para agendamento: {appointment.title}")
            return False
        
        # Buscar dados do cliente externo
        client_name = f'Cliente ID: {appointment.client_id}'
        try:
            external_clients = fetch_external_clients()
            client_data = next((c for c in external_clients if c.get('id') == appointment.client_id), None)
            if client_data:
                client_name = client_data.get('name', client_name)
        except Exception as e:
            print(f"❌ Erro ao buscar cliente externo: {e}")
        
        # Configurações do email (hardcoded)
        smtp_server = 'smtp.gmail.com'
        smtp_port = 587
        smtp_username = 'rodrigo.compumais@gmail.com'
        smtp_password = 'lbma igfu dpjq ozqd'
        
        print(f"📧 Configurações SMTP: {smtp_server}:{smtp_port}")
        print(f"📧 Username: {smtp_username}")
        print(f"📧 Password configurado: Sim")
        
        # Criar mensagem
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = appointment.user.email
        msg['Subject'] = f'Lembrete: {appointment.title} - {appointment.appointment_date.strftime("%d/%m/%Y às %H:%M")}'
        
        # Corpo do email de lembrete com design melhorado
        body = f"""
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Lembrete de Agendamento</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f7fa;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
                
                <!-- Header -->
                <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 40px 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);">
                        ⏰ Lembrete de Agendamento
                    </h1>
                    <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">
                        Hoje é o dia do seu agendamento
                    </p>
                </div>
                
                <!-- Content -->
                <div style="padding: 40px 30px;">
                    <p style="color: #2d3748; font-size: 18px; margin: 0 0 30px 0; line-height: 1.6;">
                        Olá <strong style="color: #f5576c;">{appointment.user.name}</strong>,
                    </p>
                    
                    <p style="color: #4a5568; font-size: 16px; margin: 0 0 30px 0; line-height: 1.6;">
                        Este é um lembrete do seu agendamento de hoje:
                    </p>
                    
                    <!-- Appointment Card -->
                    <div style="background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; margin: 30px 0; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; right: 0; width: 100px; height: 100px; background: linear-gradient(135deg, #f093fb, #f5576c); opacity: 0.1; border-radius: 0 12px 0 100px;"></div>
                        
                        <h2 style="color: #2d3748; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">
                            {appointment.title}
                        </h2>
                        
                        <div style="display: grid; gap: 15px;">
                            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(245, 87, 108, 0.1);">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f093fb, #f5576c); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                    <span style="color: #ffffff; font-size: 16px;">📅</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Data e Hora</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600;">{appointment.appointment_date.strftime("%d/%m/%Y às %H:%M")}</p>
                                </div>
                            </div>
                            
                            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(245, 87, 108, 0.1);">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f093fb, #f5576c); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                    <span style="color: #ffffff; font-size: 16px;">👤</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Cliente</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600;">{client_name}</p>
                                </div>
                            </div>
                            
                            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(245, 87, 108, 0.1);">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f093fb, #f5576c); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                    <span style="color: #ffffff; font-size: 16px;">🔧</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Serviço</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600;">{appointment.service.name if appointment.service else 'Não definido'}</p>
                                </div>
                            </div>
                            
                            {f'''
                            <div style="display: flex; align-items: flex-start; padding: 12px 0;">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #f093fb, #f5576c); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px; margin-top: 2px;">
                                    <span style="color: #ffffff; font-size: 16px;">📝</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Descrição</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600; line-height: 1.5;">{appointment.description}</p>
                                </div>
                            </div>
                            ''' if appointment.description else ''}
                        </div>
                    </div>
                    
                    <!-- Alert Box -->
                    <div style="background: linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%); border-left: 4px solid #e53e3e; padding: 20px; border-radius: 8px; margin: 30px 0;">
                        <p style="margin: 0; color: #742a2a; font-size: 14px; line-height: 1.6;">
                            <strong>⚠️ Importante:</strong> Por favor, esteja preparado para o atendimento. Certifique-se de ter todos os materiais e informações necessárias.
                        </p>
                    </div>
                    
                    <!-- Footer -->
                    <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #e2e8f0;">
                        <p style="color: #718096; font-size: 14px; margin: 0 0 10px 0;">
                            Atenciosamente,
                        </p>
                        <p style="color: #f5576c; font-size: 16px; font-weight: 600; margin: 0;">
                            Sistema de Tickets
                        </p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        print(f"📧 Conectando ao servidor SMTP...")
        
        # Enviar email
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        server.quit()
        
        print(f"✅ Email enviado com sucesso para: {appointment.user.email}")
        return True
        
    except Exception as e:
        print(f"❌ Erro ao enviar email: {e}")
        return False

def enviar_email_confirmacao(appointment):
    """Enviar email de confirmação ao criar agendamento"""
    try:
        print(f"📧 Enviando email de confirmação para: {appointment.user.name if appointment.user else 'Usuário não encontrado'}")
        
        if not appointment.user or not appointment.user.email:
            print(f"❌ Usuário ou email não encontrado para agendamento: {appointment.title}")
            return False
        
        # Buscar dados do cliente externo
        client_name = f'Cliente ID: {appointment.client_id}'
        try:
            external_clients = fetch_external_clients()
            client_data = next((c for c in external_clients if c.get('id') == appointment.client_id), None)
            if client_data:
                client_name = client_data.get('name', client_name)
        except Exception as e:
            print(f"❌ Erro ao buscar cliente externo: {e}")
        
        # Configurações do email (hardcoded)
        smtp_server = 'smtp.gmail.com'
        smtp_port = 587
        smtp_username = 'rodrigo.compumais@gmail.com'
        smtp_password = 'lbma igfu dpjq ozqd'
        
        print(f"📧 Configurações SMTP: {smtp_server}:{smtp_port}")
        print(f"📧 Username: {smtp_username}")
        
        # Criar mensagem
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = appointment.user.email
        msg['Subject'] = f'Confirmação de Agendamento: {appointment.title}'
        
        # Corpo do email com design melhorado
        body = f"""
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Novo Agendamento</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f7fa;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
                
                <!-- Header -->
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);">
                        📅 Novo Agendamento
                    </h1>
                    <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">
                        Criado para você
                    </p>
                </div>
                
                <!-- Content -->
                <div style="padding: 40px 30px;">
                    <p style="color: #2d3748; font-size: 18px; margin: 0 0 30px 0; line-height: 1.6;">
                        Olá <strong style="color: #667eea;">{appointment.user.name}</strong>,
                    </p>
                    
                    <p style="color: #4a5568; font-size: 16px; margin: 0 0 30px 0; line-height: 1.6;">
                        Um novo agendamento foi criado para você com as seguintes informações:
                    </p>
                    
                    <!-- Appointment Card -->
                    <div style="background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; margin: 30px 0; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; right: 0; width: 100px; height: 100px; background: linear-gradient(135deg, #667eea, #764ba2); opacity: 0.1; border-radius: 0 12px 0 100px;"></div>
                        
                        <h2 style="color: #2d3748; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">
                            {appointment.title}
                        </h2>
                        
                        <div style="display: grid; gap: 15px;">
                            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(102, 126, 234, 0.1);">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                    <span style="color: #ffffff; font-size: 16px;">📅</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Data e Hora</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600;">{appointment.appointment_date.strftime("%d/%m/%Y às %H:%M")}</p>
                                </div>
                            </div>
                            
                            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(102, 126, 234, 0.1);">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                    <span style="color: #ffffff; font-size: 16px;">👤</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Cliente</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600;">{client_name}</p>
                                </div>
                            </div>
                            
                            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(102, 126, 234, 0.1);">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                    <span style="color: #ffffff; font-size: 16px;">🔧</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Serviço</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600;">{appointment.service.name if appointment.service else 'Não definido'}</p>
                                </div>
                            </div>
                            
                            {f'''
                            <div style="display: flex; align-items: flex-start; padding: 12px 0;">
                                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px; margin-top: 2px;">
                                    <span style="color: #ffffff; font-size: 16px;">📝</span>
                                </div>
                                <div>
                                    <p style="margin: 0; color: #4a5568; font-size: 14px; font-weight: 500;">Descrição</p>
                                    <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 600; line-height: 1.5;">{appointment.description}</p>
                                </div>
                            </div>
                            ''' if appointment.description else ''}
                        </div>
                    </div>
                    
                    <!-- Info Box -->
                    <div style="background: linear-gradient(135deg, #e6fffa 0%, #b2f5ea 100%); border-left: 4px solid #38b2ac; padding: 20px; border-radius: 8px; margin: 30px 0;">
                        <p style="margin: 0; color: #234e52; font-size: 14px; line-height: 1.6;">
                            <strong>💡 Lembrete:</strong> Um email de lembrete será enviado automaticamente no dia do agendamento às 6h da manhã.
                        </p>
                    </div>
                    
                    <!-- Footer -->
                    <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #e2e8f0;">
                        <p style="color: #718096; font-size: 14px; margin: 0 0 10px 0;">
                            Atenciosamente,
                        </p>
                        <p style="color: #667eea; font-size: 16px; font-weight: 600; margin: 0;">
                            Sistema de Tickets
                        </p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        print(f"📧 Conectando ao servidor SMTP...")
        
        # Enviar email
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        server.quit()
        
        print(f"✅ Email de confirmação enviado com sucesso para: {appointment.user.email}")
        return True
        
    except Exception as e:
        print(f"❌ Erro ao enviar email de confirmação: {e}")
        return False

def criar_ticket_automatico(appointment):
    """Criar ticket automaticamente baseado no agendamento"""
    try:
        print(f"🎫 Verificando se já existe ticket para agendamento: {appointment.title}")
        
        # Verificar se já existe um ticket para este agendamento
        existing_ticket = Ticket.query.filter(
            Ticket.title.like(f"%[AGENDAMENTO] {appointment.title}%"),
            Ticket.external_client_id == appointment.client_id,
            Ticket.assigned_to_id == appointment.user_id
        ).first()
        
        if existing_ticket:
            print(f"⚠️ Ticket já existe para este agendamento: ID {existing_ticket.id}")
            return False
        
        print(f"🎫 Criando novo ticket para agendamento: {appointment.title}")
        
        # Buscar dados do cliente externo
        client_name = f'Cliente ID: {appointment.client_id}'
        try:
            external_clients = fetch_external_clients()
            client_data = next((c for c in external_clients if c.get('id') == appointment.client_id), None)
            if client_data:
                client_name = client_data.get('name', client_name)
        except Exception as e:
            print(f"❌ Erro ao buscar cliente externo: {e}")
        
        # Criar ticket
        ticket = Ticket(
            title=f"[AGENDAMENTO] {appointment.title}",
            description=f"""
            <strong>Agendamento:</strong> {appointment.title}<br>
            <strong>Cliente:</strong> {client_name}<br>
            <strong>Serviço:</strong> {appointment.service.name if appointment.service else 'Não definido'}<br>
            <strong>Data/Hora:</strong> {appointment.appointment_date.strftime("%d/%m/%Y às %H:%M")}<br>
            <strong>Descrição:</strong> {appointment.description}<br>
            <br>
            <em>Este ticket foi criado automaticamente baseado no agendamento.</em>
            """,
            external_client_id=appointment.client_id,  # Usar external_client_id
            external_client_name=client_name,  # Adicionar nome do cliente externo
            service_id=appointment.service_id,
            assigned_to_id=appointment.user_id,
            opened_by_id=appointment.created_by
        )
        
        db.session.add(ticket)
        db.session.commit()
        
        print(f"✅ Ticket criado com sucesso: ID {ticket.id}")
        return True
        
    except Exception as e:
        print(f"❌ Erro ao criar ticket: {e}")
        db.session.rollback()
        return False

@agenda_bp.route('/deletar/<int:appointment_id>', methods=['DELETE'])
@login_required
def deletar_agendamento(appointment_id):
    """Deletar agendamento"""
    try:
        print(f"🗑️ Tentando deletar agendamento ID: {appointment_id}")
        
        appointment = Appointment.query.get_or_404(appointment_id)
        
        print(f"📝 Agendamento encontrado: {appointment.title}")
        
        db.session.delete(appointment)
        db.session.commit()
        
        print(f"✅ Agendamento deletado com sucesso: ID {appointment_id}")
        
        return jsonify({
            'success': True,
            'message': 'Agendamento deletado com sucesso!'
        })
        
    except Exception as e:
        print(f"❌ Erro ao deletar agendamento: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@agenda_bp.route('/testar-scheduler')
@login_required
def testar_scheduler():
    """Testar scheduler manualmente"""
    try:
        print(f"🧪 Teste manual do scheduler iniciado por: {current_user.name}")
        
        # Importar função do scheduler
        from app.scheduler import enviar_lembretes_automaticos
        enviar_lembretes_automaticos()
        
        return jsonify({
            'success': True,
            'message': 'Scheduler executado com sucesso! Verifique os logs do servidor.'
        })
        
    except Exception as e:
        print(f"❌ Erro no teste do scheduler: {e}")
        return jsonify({'error': str(e)}), 500


@agenda_bp.route('/api/swap', methods=['POST'])
@login_required
def create_swap():
    """Registrar uma troca temporária de plantão"""
    try:
        data = request.get_json()
        swap_date_str = data.get('swap_date')
        user_1_id = data.get('user_1_id')
        user_2_id = data.get('user_2_id')

        if not swap_date_str or not user_1_id or not user_2_id:
            return jsonify({'error': 'Todos os campos são obrigatórios'}), 400

        swap_date = datetime.fromisoformat(swap_date_str).date()
        
        # Validar se a data é um sábado
        if swap_date.weekday() != 5:
            return jsonify({'error': 'A data informada não é um sábado'}), 400

        # Validar usuários
        u1 = User.query.get(user_1_id)
        u2 = User.query.get(user_2_id)
        if not u1 or not u2:
            return jsonify({'error': 'Usuários não encontrados'}), 404

        # Validar se o solicitante está envolvido na troca (se não for admin)
        if not current_user.has_role('admin') and current_user.id not in [user_1_id, user_2_id]:
            return jsonify({'error': 'Você só pode solicitar trocas para si mesmo'}), 403

        # Validar equipes
        if u1.team not in ['Equipe 1', 'Equipe 2'] or u2.team not in ['Equipe 1', 'Equipe 2']:
            return jsonify({'error': 'Os usuários devem pertencer à Equipe 1 ou Equipe 2'}), 400

        if u1.team == u2.team:
            return jsonify({'error': 'Os usuários devem pertencer a equipes diferentes'}), 400

        # Evitar trocas duplicadas para os mesmos usuários no mesmo dia
        existing = ShiftSwap.query.filter_by(swap_date=swap_date).filter(
            ((ShiftSwap.user_1_id == user_1_id) & (ShiftSwap.user_2_id == user_2_id)) |
            ((ShiftSwap.user_1_id == user_2_id) & (ShiftSwap.user_2_id == user_1_id))
        ).first()
        if existing:
            return jsonify({'error': 'Já existe uma troca registrada entre estes usuários nesta data'}), 400

        # Se for admin, a troca é aceita automaticamente. Caso contrário, fica pendente.
        status = 'accepted' if current_user.has_role('admin') else 'pending'

        swap = ShiftSwap(
            swap_date=swap_date,
            user_1_id=user_1_id,
            user_2_id=user_2_id,
            requested_by_id=current_user.id,
            status=status
        )
        db.session.add(swap)
        db.session.commit()

        msg = 'Troca de plantão registrada com sucesso!' if status == 'accepted' else 'Solicitação de troca enviada para confirmação!'

        return jsonify({
            'success': True,
            'message': msg,
            'swap': swap.to_dict()
        })
    except Exception as e:
        print(f"❌ Erro ao criar troca de plantão: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@agenda_bp.route('/api/swap/<int:swap_id>/accept', methods=['POST'])
@login_required
def accept_swap(swap_id):
    """Aceitar uma solicitação de troca temporária"""
    try:
        swap = ShiftSwap.query.get_or_404(swap_id)
        
        # Validar se o usuário logado é o destinatário ou admin
        is_involved = current_user.id in [swap.user_1_id, swap.user_2_id]
        is_requester = current_user.id == swap.requested_by_id
        
        if not current_user.has_role('admin') and (not is_involved or is_requester):
            return jsonify({'error': 'Você não tem permissão para aceitar esta troca'}), 403

        swap.status = 'accepted'
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Troca de plantão confirmada com sucesso!'
        })
    except Exception as e:
        print(f"❌ Erro ao aceitar troca de plantão: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@agenda_bp.route('/api/swap/<int:swap_id>/decline', methods=['POST'])
@login_required
def decline_swap(swap_id):
    """Recusar uma solicitação de troca temporária"""
    try:
        swap = ShiftSwap.query.get_or_404(swap_id)
        
        # Validar permissão (destinatário ou admin)
        is_involved = current_user.id in [swap.user_1_id, swap.user_2_id]
        is_requester = current_user.id == swap.requested_by_id
        
        if not current_user.has_role('admin') and (not is_involved or is_requester):
            return jsonify({'error': 'Você não tem permissão para recusar esta troca'}), 403

        db.session.delete(swap)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Solicitação de troca recusada com sucesso!'
        })
    except Exception as e:
        print(f"❌ Erro ao recusar troca de plantão: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@agenda_bp.route('/api/swap/<int:swap_id>', methods=['DELETE'])
@login_required
def delete_swap(swap_id):
    """Deletar/Cancelar uma troca de plantão"""
    try:
        swap = ShiftSwap.query.get_or_404(swap_id)
        
        # Permitir apenas se for admin ou um dos usuários envolvidos
        if not current_user.has_role('admin') and current_user.id not in [swap.user_1_id, swap.user_2_id]:
            return jsonify({'error': 'Você não tem permissão para cancelar esta troca'}), 403

        db.session.delete(swap)
        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'Troca de plantão desfeita com sucesso!'
        })
    except Exception as e:
        print(f"❌ Erro ao deletar troca de plantão: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@agenda_bp.route('/api/users-by-team')
@login_required
def get_users_by_team():
    """Retorna a lista de usuários ativos divididos por equipe"""
    equipe1 = [{'id': u.id, 'name': u.name} for u in User.query.filter_by(team='Equipe 1', status='1').order_by(User.name).all()]
    equipe2 = [{'id': u.id, 'name': u.name} for u in User.query.filter_by(team='Equipe 2', status='1').order_by(User.name).all()]
    return jsonify({
        'equipe_1': equipe1,
        'equipe_2': equipe2
    })
