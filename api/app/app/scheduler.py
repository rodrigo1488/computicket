"""
Scheduler para envio automático de lembretes de agendamentos
Executa a cada minuto para verificar agendamentos que precisam de lembretes
Envia lembretes 30 minutos antes de cada evento
"""

import schedule
import time
import threading
from datetime import datetime, timedelta
from app import create_app
from app.models import Appointment, db
from app.external_pg import fetch_external_clients
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

_helpdesk_message_versions = {}
_helpdesk_poll_initialized = False


def verificar_novas_mensagens_helpdesk():
    """Consulta o motor para que Web Push funcione mesmo sem navegador aberto."""
    global _helpdesk_poll_initialized
    app = create_app()
    with app.app_context():
        try:
            from app.blueprints.helpdesk import _normalize_messages
            from app.engine_client import admin_request
            from app.models import AppNotification, HelpDeskAgentMap, User
            from app.notification_service import create_notifications

            active = []
            for status in ("pending", "open"):
                page = 1
                while page <= 20:
                    data = admin_request(
                        "GET",
                        "/tickets",
                        params={"status": status, "showAll": "true", "pageNumber": str(page)},
                    )
                    chunk = data.get("tickets") if isinstance(data, dict) else data
                    active.extend(item for item in (chunk or []) if isinstance(item, dict))
                    if not (isinstance(data, dict) and data.get("hasMore")):
                        break
                    page += 1

            current_versions = {}
            for ticket in active:
                try:
                    if int(ticket.get("unreadMessages") or 0) <= 0:
                        continue
                    ticket_id = int(ticket["id"])
                except (KeyError, TypeError, ValueError):
                    continue

                version = "|".join(
                    str(value or "")
                    for value in (
                        ticket.get("updatedAt"),
                        ticket.get("unreadMessages"),
                        ticket.get("lastMessage"),
                    )
                )
                current_versions[ticket_id] = version
                if not _helpdesk_poll_initialized or _helpdesk_message_versions.get(ticket_id) == version:
                    continue

                raw = admin_request("GET", f"/messages/{ticket_id}", params={"pageNumber": "1"})
                messages = _normalize_messages(raw, ticket_id).get("messages") or []
                incoming = next((item for item in reversed(messages) if not item.get("fromMe")), None)
                if not incoming or incoming.get("id") is None:
                    continue

                message_id = str(incoming["id"])

                engine_user_id = ticket.get("userId")
                if engine_user_id is None and isinstance(ticket.get("user"), dict):
                    engine_user_id = ticket["user"].get("id")
                mapping = (
                    HelpDeskAgentMap.query.filter_by(engine_user_id=int(engine_user_id)).first()
                    if engine_user_id
                    else None
                )
                if mapping:
                    recipients = [mapping.computicket_user_id]
                else:
                    recipients = [
                        user.id
                        for user in User.query.filter(
                            User.status == "1",
                            User.role.in_(["admin", "administrador", "tecnico"]),
                        ).all()
                    ]
                recipients = [
                    user_id
                    for user_id in recipients
                    if not AppNotification.query.filter_by(
                        user_id=user_id,
                        entity_type="message",
                        entity_id=message_id,
                    ).first()
                ]
                if not recipients:
                    continue

                contact = ticket.get("contact") if isinstance(ticket.get("contact"), dict) else {}
                contact_name = contact.get("name") or contact.get("number") or "Novo contato"
                body = incoming.get("body") or ticket.get("lastMessage") or "Nova mensagem"
                waiting = str(ticket.get("status") or status or "").lower() == "pending"
                create_notifications(
                    recipients,
                    notification_type="helpdesk_pending" if waiting else "message",
                    title=(
                        f"Nova conversa de {contact_name}"
                        if waiting
                        else f"Nova mensagem de {contact_name}"
                    ),
                    message=str(body)[:1000],
                    url=f"/helpdesk?c={ticket_id}",
                    entity_type="message",
                    entity_id=message_id,
                    send_push=True,
                    force_push=True,
                )

            _helpdesk_message_versions.clear()
            _helpdesk_message_versions.update(current_versions)
            _helpdesk_poll_initialized = True
        except Exception as e:
            app.logger.warning("Falha ao verificar novas mensagens do helpdesk: %s", e)


def enviar_lembretes_automaticos():
    """Função para enviar lembretes automaticamente - 30 minutos antes de cada evento"""
    print(f"🕕 [{datetime.now()}] Verificando agendamentos que precisam de lembretes...")
    
    app = create_app()
    with app.app_context():
        try:
            # Calcular janelas em UTC para compatibilizar com datas salvas (geralmente em UTC)
            from app.timezone_utils import get_brasilia_now, brasilia_to_utc
            agora_brasilia = get_brasilia_now()
            agora_utc = brasilia_to_utc(agora_brasilia)
            agora_utc_db = agora_utc.replace(tzinfo=None)
            
            # Janela alvo: agendamentos que começarão entre 25 e 35 minutos.
            tempo_limite_inferior = agora_utc_db + timedelta(minutes=25)
            tempo_limite_superior = agora_utc_db + timedelta(minutes=35)
            
            print(f"📅 Verificando agendamentos entre {tempo_limite_inferior.strftime('%H:%M')} e {tempo_limite_superior.strftime('%H:%M')}")
            
            # Buscar agendamentos que estão no intervalo de 30 minutos antes e ainda não tiveram lembretes enviados
            appointments = Appointment.query.filter(
                Appointment.appointment_date >= tempo_limite_inferior,
                Appointment.appointment_date <= tempo_limite_superior,
                Appointment.reminder_sent == False  # Só processar se não foi enviado
            ).all()
            
            print(f"📋 Agendamentos encontrados para lembrete (30min antes): {len(appointments)}")
            
            emails_enviados = 0
            tickets_criados = 0
            
            for appointment in appointments:
                print(f"📝 Processando agendamento: {appointment.title} - {appointment.get_formatted_date()}")
                
                # Verificar se realmente está 30 minutos antes (com margem de erro)
                # Usar base UTC para diferença
                diferenca_minutos = (appointment.appointment_date - agora_utc_db).total_seconds() / 60
                print(f"⏰ Tempo restante: {diferenca_minutos:.1f} minutos")
                
                # Só processar se estiver entre 20-40 minutos antes (margem de segurança)
                if 20 <= diferenca_minutos <= 40:
                    from app.notification_service import create_notifications
                    create_notifications(
                        [appointment.user_id],
                        notification_type="appointment",
                        title="Agendamento em breve",
                        message=f"{appointment.title} começa em aproximadamente {int(diferenca_minutos)} minutos.",
                        url="/agenda",
                        entity_type="appointment_reminder",
                        entity_id=appointment.id,
                    )

                    # Enviar email de lembrete
                    if enviar_email_lembrete_automatico(appointment):
                        emails_enviados += 1
                        print(f"✅ Email enviado para: {appointment.user.name}")
                    else:
                        print(f"❌ Falha ao enviar email para: {appointment.user.name}")

                    # O push e o pop-up não dependem do envio de e-mail.
                    appointment.reminder_sent = True
                    db.session.commit()
                    
                    # Criar ticket automaticamente (só se não existir)
                    if criar_ticket_automatico_scheduler(appointment):
                        tickets_criados += 1
                        print(f"✅ Ticket criado para: {appointment.title}")
                    else:
                        print(f"❌ Falha ao criar ticket para: {appointment.title}")
                else:
                    print(f"⏰ Agendamento fora do intervalo ideal: {diferenca_minutos:.1f} minutos")
            
            if emails_enviados > 0 or tickets_criados > 0:
                print(f"📊 Resultado: {emails_enviados} emails enviados, {tickets_criados} tickets criados")
            else:
                print("📊 Nenhum agendamento processado neste ciclo")
            
            # Limpar lembretes de agendamentos que já passaram (executar apenas a cada hora)
            if agora_brasilia.minute == 0:  # Só executar no início de cada hora
                limpar_lembretes_antigos()
            
        except Exception as e:
            print(f"❌ Erro no envio automático de lembretes: {e}")
            db.session.rollback()

def limpar_lembretes_antigos():
    """Limpar flag de lembretes de agendamentos que já passaram há mais de 2 horas"""
    try:
        from app.timezone_utils import get_brasilia_now, brasilia_to_utc
        agora_brasilia = get_brasilia_now()
        limite_tempo_utc = brasilia_to_utc(agora_brasilia) - timedelta(hours=2)
        
        # Buscar agendamentos que já passaram há mais de 2 horas e ainda têm flag de lembrete
        appointments_antigos = Appointment.query.filter(
            Appointment.appointment_date < limite_tempo_utc,
            Appointment.reminder_sent == True
        ).all()
        
        if appointments_antigos:
            print(f"🧹 Limpando {len(appointments_antigos)} flags de lembretes antigos...")
            
            for appointment in appointments_antigos:
                appointment.reminder_sent = False
                print(f"🧹 Limpando flag de lembrete: {appointment.title} - {appointment.get_formatted_date()}")
            
            db.session.commit()
            print(f"✅ {len(appointments_antigos)} flags de lembretes limpos com sucesso")
        else:
            print("🧹 Nenhum lembrete antigo para limpar")
            
    except Exception as e:
        print(f"❌ Erro ao limpar lembretes antigos: {e}")
        db.session.rollback()

def enviar_email_lembrete_automatico(appointment):
    """Enviar email de lembrete para o usuário"""
    try:
        print(f"📧 Enviando email de lembrete para: {appointment.user.name if appointment.user else 'Usuário não encontrado'}")
        
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
        
        # Calcular tempo restante
        from app.timezone_utils import get_brasilia_now, brasilia_to_utc
        agora_brasilia = get_brasilia_now()
        agora_utc = brasilia_to_utc(agora_brasilia)
        diferenca_minutos = (appointment.appointment_date - agora_utc).total_seconds() / 60
        
        # Criar mensagem
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = appointment.user.email
        msg['Subject'] = f'⏰ Lembrete: {appointment.title} em {int(diferenca_minutos)} minutos - {appointment.appointment_date.strftime("%d/%m/%Y às %H:%M")}'
        
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
                        Este é um lembrete do seu agendamento:
                    </p>
                    
                    <!-- Tempo Restante -->
                    <div style="background: linear-gradient(135deg, #ff6b6b, #ee5a24); border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center; color: white;">
                        <h3 style="margin: 0 0 10px 0; font-size: 20px; font-weight: 600;">
                            ⏰ Tempo Restante
                        </h3>
                        <p style="margin: 0; font-size: 24px; font-weight: 700;">
                            {int(diferenca_minutos)} minutos
                        </p>
                        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">
                            Seu agendamento começa em breve!
                        </p>
                    </div>
                    
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
        
        print(f"✅ Email de lembrete enviado com sucesso para: {appointment.user.email}")
        return True
        
    except Exception as e:
        print(f"❌ Erro ao enviar email de lembrete: {e}")
        return False

def criar_ticket_automatico_scheduler(appointment):
    """Criar ticket automaticamente baseado no agendamento"""
    try:
        print(f"🎫 Verificando se já existe ticket para agendamento: {appointment.title}")
        
        # Verificar se já existe um ticket para este agendamento
        from app.models import Ticket
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
            external_client_id=appointment.client_id,
            external_client_name=client_name,
            service_id=appointment.service_id,
            assigned_to_id=appointment.user_id,
            opened_by_id=appointment.created_by
        )
        
        db.session.add(ticket)
        db.session.commit()
        from app.notification_service import create_notifications
        create_notifications(
            [ticket.assigned_to_id],
            notification_type="ticket",
            title=f"Ticket #{ticket.id} criado pelo agendamento",
            message=ticket.title,
            url=f"/tickets/{ticket.id}",
            entity_type="ticket",
            entity_id=ticket.id,
        )
        
        print(f"✅ Ticket criado com sucesso: ID {ticket.id}")
        return True
        
    except Exception as e:
        print(f"❌ Erro ao criar ticket: {e}")
        db.session.rollback()
        return False

# Variável global para controlar se o scheduler já foi iniciado
_scheduler_started = False
_scheduler_lock = threading.Lock()

def run_scheduler():
    """Executar o scheduler em uma thread separada"""
    print("🚀 Iniciando scheduler de lembretes...")
    
    # Agendar execução a cada minuto para verificar agendamentos
    schedule.every().minute.do(enviar_lembretes_automaticos)
    schedule.every(15).seconds.do(verificar_novas_mensagens_helpdesk)
    verificar_novas_mensagens_helpdesk()
    
    print("⏰ Scheduler configurado para executar a cada minuto (verifica agendamentos 30min antes)")
    
    # Loop infinito para manter o scheduler rodando
    while True:
        try:
            schedule.run_pending()
            time.sleep(60)  # Verificar a cada minuto
        except Exception as e:
            print(f"❌ Erro no scheduler: {e}")
            time.sleep(60)  # Continuar mesmo com erro

def testar_scheduler():
    """Função para testar o scheduler manualmente"""
    print("🧪 Testando o novo sistema de scheduler...")
    
    app = create_app()
    with app.app_context():
        try:
            from app.timezone_utils import get_brasilia_now
            agora_brasilia = get_brasilia_now()
            
            print(f"🕐 Hora atual: {agora_brasilia.strftime('%d/%m/%Y %H:%M:%S')}")
            
            # Buscar agendamentos dos próximos 2 dias
            from datetime import timedelta
            futuro = agora_brasilia + timedelta(days=2)
            
            appointments = Appointment.query.filter(
                Appointment.appointment_date >= agora_brasilia,
                Appointment.appointment_date <= futuro,
                Appointment.reminder_sent == False
            ).all()
            
            print(f"📋 Agendamentos encontrados para os próximos 2 dias: {len(appointments)}")
            
            for appointment in appointments:
                diferenca_minutos = (appointment.appointment_date - agora_brasilia).total_seconds() / 60
                print(f"📝 {appointment.title} - {appointment.get_formatted_date()} - {diferenca_minutos:.1f} minutos restantes")
                
                if 20 <= diferenca_minutos <= 40:
                    print(f"✅ Este agendamento seria processado pelo scheduler!")
                else:
                    print(f"⏰ Este agendamento ainda não está no intervalo de 30min")
            
            print("🧪 Teste concluído!")
            
        except Exception as e:
            print(f"❌ Erro no teste: {e}")

def start_scheduler():
    """Iniciar o scheduler em uma thread separada"""
    global _scheduler_started
    
    with _scheduler_lock:
        if _scheduler_started:
            print("⚠️ Scheduler já foi iniciado, ignorando nova inicialização")
            return
        
        _scheduler_started = True
        scheduler_thread = threading.Thread(target=run_scheduler, daemon=True, name="SchedulerThread")
        scheduler_thread.start()
        print("✅ Scheduler iniciado em thread separada")

if __name__ == "__main__":
    # Para teste manual
    print("🧪 Executando teste do scheduler...")
    enviar_lembretes_automaticos()
