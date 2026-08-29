try:
    import pyodbc
except ImportError:  # ambiente Linux sem driver ODBC
    pyodbc = None
try:
    import psycopg2
except ImportError:
    psycopg2 = None
from datetime import datetime
from flask import Blueprint, current_app, render_template
from flask_mail import Message
from threading import Thread

bp = Blueprint("utils", __name__)

def connect_sql_server():
  if pyodbc is None:
    raise RuntimeError("pyodbc não está instalado neste ambiente")
  return pyodbc.connect(
    'DRIVER={SQL Server};'
    'SERVER=winserver,1433;'
    'DATABASE=Chamado;'
    'UID=sa;'
    'PWD=C33511861@;'
    'Encrypt=no;'
    'TrustServerCertificate=yes;'
  )

DATA_BASE_POSTGRES_CONFIG = {
  'host': 'winserver',
  'port': 5432,
  'database': 'unico',
  'user': 'postgres',
  'password': 'postgres',
  'options': '-c default_transaction_isolation=read_committed'
}

def connect_postgres():
  if psycopg2 is None:
    print("psycopg2 não está instalado neste ambiente")
    return None
  try:
    return psycopg2.connect(
      host=DATA_BASE_POSTGRES_CONFIG["host"],
      port=DATA_BASE_POSTGRES_CONFIG["port"],
      database=DATA_BASE_POSTGRES_CONFIG["database"],
      user=DATA_BASE_POSTGRES_CONFIG["user"],
      password=DATA_BASE_POSTGRES_CONFIG["password"]
    )
  except Exception as e:
    print(f"Erro ao conectar ao banco PostgreSQL: {e}")
    return None


def send_async_email(app, msg):
    """Envia email de forma assíncrona"""
    with app.app_context():
        try:
            print(f"DEBUG: Tentando enviar email para: {msg.recipients}")
            print(f"DEBUG: Assunto: {msg.subject}")
            print(f"DEBUG: Remetente: {msg.sender}")
            
            from .. import mail
            mail.send(msg)
            print(f"✅ Email enviado com sucesso para: {msg.recipients}")
        except Exception as e:
            print(f"❌ Erro ao enviar email: {e}")
            import traceback
            traceback.print_exc()


def send_ticket_notification_email(technician_email, technician_name, ticket_data):
    """
    Envia email de notificação para o técnico quando um novo ticket é criado
    
    Args:
        technician_email (str): Email do técnico
        technician_name (str): Nome do técnico
        ticket_data (dict): Dados do ticket (id, title, description, client_name, priority, service_name)
    """
    print(f"DEBUG: Iniciando envio de notificação de ticket #{ticket_data.get('id', 'N/A')}")
    print(f"  Técnico: {technician_name} ({technician_email})")
    print(f"  Título: {ticket_data.get('title', 'N/A')}")
    
    if not technician_email:
        print("ERRO: Email do técnico não informado, pulando envio de notificação")
        return
    
    # Verificar se notificações por email estão habilitadas
    from ..models import SystemConfig
    if SystemConfig.get('email_notifications', 'true').lower() != 'true':
        print("AVISO: Notificações por email desabilitadas")
        return
    
    try:
        # Atualizar configurações do Flask-Mail com as configurações do banco
        mail_port = int(SystemConfig.get('mail_port', '587'))
        mail_use_tls = SystemConfig.get('mail_use_tls', 'true').lower() == 'true'
        
        # Para Gmail, porta 587 sempre requer TLS
        if mail_port == 587:
            mail_use_tls = True
        
        current_app.config['MAIL_SERVER'] = SystemConfig.get('mail_server', 'smtp.gmail.com')
        current_app.config['MAIL_PORT'] = mail_port
        current_app.config['MAIL_USE_TLS'] = mail_use_tls
        current_app.config['MAIL_USERNAME'] = SystemConfig.get('mail_username', '')
        current_app.config['MAIL_PASSWORD'] = SystemConfig.get('mail_password', '')
        current_app.config['MAIL_DEFAULT_SENDER'] = SystemConfig.get('mail_default_sender', '')
        
        # Verificar se as configurações de email estão completas
        if not current_app.config.get('MAIL_USERNAME') or not current_app.config.get('MAIL_PASSWORD'):
            print("ERRO: Configurações de email incompletas, pulando envio de notificação")
            print(f"  Usuário: {'OK' if current_app.config.get('MAIL_USERNAME') else 'FALTANDO'}")
            print(f"  Senha: {'OK' if current_app.config.get('MAIL_PASSWORD') else 'FALTANDO'}")
            return
        
        print("DEBUG: Configurações de email OK, criando mensagem...")
        
        # Criar mensagem de email
        msg = Message(
            subject=f"Novo Ticket #{ticket_data['id']} - {ticket_data['title']}",
            recipients=[technician_email],
            sender=current_app.config.get('MAIL_DEFAULT_SENDER')
        )
        
        # Renderizar template HTML do email
        msg.html = render_template('emails/ticket_notification.html', 
                                 technician_name=technician_name,
                                 ticket=ticket_data)
        
        # Enviar email de forma assíncrona
        print("DEBUG: Iniciando envio assíncrono do email...")
        thread = Thread(target=send_async_email, args=(current_app._get_current_object(), msg))
        thread.start()
        print("DEBUG: Thread de envio de email iniciada com sucesso")
        
    except Exception as e:
        print(f"ERRO ao preparar email de notificação: {e}")
        import traceback
        traceback.print_exc()


def send_email_test():
    """Função para testar o envio de emails"""
    try:
        # Verificar se as configurações estão completas
        mail_server = current_app.config.get('MAIL_SERVER')
        mail_port = current_app.config.get('MAIL_PORT')
        mail_username = current_app.config.get('MAIL_USERNAME')
        mail_password = current_app.config.get('MAIL_PASSWORD')
        mail_sender = current_app.config.get('MAIL_DEFAULT_SENDER')
        mail_use_tls = current_app.config.get('MAIL_USE_TLS')
        
        print(f"DEBUG: Testando configurações de email:")
        print(f"  Servidor: {mail_server}")
        print(f"  Porta: {mail_port}")
        print(f"  Usuário: {mail_username}")
        print(f"  Senha: {'***' if mail_password else 'NÃO CONFIGURADA'}")
        print(f"  Remetente: {mail_sender}")
        print(f"  TLS: {mail_use_tls}")
        print(f"  Tamanho da senha: {len(mail_password) if mail_password else 0} caracteres")
        
        if not mail_username or not mail_password:
            print("ERRO: Usuário ou senha não configurados")
            return False
            
        if not mail_sender:
            print("ERRO: Remetente padrão não configurado")
            return False
        
        # Verificar se a senha parece ser uma senha de aplicativo do Gmail
        if mail_username.endswith('@gmail.com') and len(mail_password) != 16:
            print("AVISO: Para Gmail, a senha de aplicativo deve ter 16 caracteres")
            print(f"  Senha atual tem {len(mail_password)} caracteres")
        
        # Testar conexão SMTP diretamente
        print("DEBUG: Testando conexão SMTP...")
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        # Configurar servidor SMTP
        if mail_port == 465:
            # SSL
            server = smtplib.SMTP_SSL(mail_server, mail_port)
            print("  Usando SSL (porta 465)")
        else:
            # TLS - Para Gmail, porta 587 sempre requer TLS
            server = smtplib.SMTP(mail_server, mail_port)
            if mail_port == 587 or mail_use_tls:
                server.starttls()
                print("  Usando TLS (obrigatório para porta 587)")
            else:
                print("  Sem TLS")
        
        # Tentar fazer login
        print("  Tentando fazer login...")
        server.login(mail_username, mail_password)
        print("  ✅ Login bem-sucedido!")
        
        # Criar mensagem
        msg = MIMEMultipart('alternative')
        msg['Subject'] = "Teste de Email - Sistema de Tickets"
        msg['From'] = mail_sender
        msg['To'] = mail_username
        
        # Texto simples
        text = "Este é um email de teste do sistema de tickets."
        
        # HTML
        html = f"""
        <html>
        <body>
            <h2>Teste de Email - Sistema de Tickets</h2>
            <p>Este é um email de teste para verificar se as configurações de SMTP estão funcionando corretamente.</p>
            <p><strong>Configurações testadas:</strong></p>
            <ul>
                <li>Servidor: {mail_server}</li>
                <li>Porta: {mail_port}</li>
                <li>Usuário: {mail_username}</li>
                <li>Remetente: {mail_sender}</li>
                <li>TLS: {mail_use_tls}</li>
            </ul>
            <p>Se você recebeu este email, as configurações estão funcionando!</p>
            <hr>
            <p><small>Enviado em: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}</small></p>
        </body>
        </html>
        """
        
        # Anexar partes
        part1 = MIMEText(text, 'plain')
        part2 = MIMEText(html, 'html')
        msg.attach(part1)
        msg.attach(part2)
        
        # Enviar email
        print("  Enviando email...")
        server.send_message(msg)
        server.quit()
        
        print("SUCCESS: Email de teste enviado com sucesso!")
        return True
        
    except Exception as e:
        print(f"ERRO no teste de email: {e}")
        import traceback
        traceback.print_exc()
        
        # Sugestões baseadas no erro
        if "535" in str(e) and "BadCredentials" in str(e):
            print("\n💡 SUGESTÕES PARA GMAIL:")
            print("1. Verifique se está usando uma senha de aplicativo (16 caracteres)")
            print("2. Certifique-se de que a autenticação de 2 fatores está ativada")
            print("3. Gere uma nova senha de aplicativo em: https://myaccount.google.com/apppasswords")
            print("4. Para Gmail, use porta 587 com TLS ou porta 465 com SSL")
            print("\n🔧 TESTE MANUAL:")
            print("Tente estas configurações:")
            print("  - Servidor: smtp.gmail.com")
            print("  - Porta: 587, TLS: Ativado")
            print("  - OU Porta: 465, TLS: Desativado (SSL)")
            print("  - Usuário: seu-email@gmail.com")
            print("  - Senha: senha-de-aplicativo-16-chars")
        elif "SMTP AUTH extension not supported" in str(e):
            print("\n🚨 PROBLEMA IDENTIFICADO:")
            print("A porta 587 do Gmail SEMPRE requer TLS ativado!")
            print("O sistema foi corrigido automaticamente para usar TLS na porta 587.")
            print("\n✅ SOLUÇÃO:")
            print("1. Vá para Configurações → Configurações de Email")
            print("2. Certifique-se de que 'Usar TLS' está marcado")
            print("3. OU mude para porta 465 (SSL)")
            print("4. Teste novamente")
        
        return False


def test_ticket_notification_email():
    """Testa o envio de email de notificação de ticket"""
    try:
        from ..models import SystemConfig
        
        # Verificar se as configurações estão completas
        mail_username = SystemConfig.get('mail_username', '')
        mail_password = SystemConfig.get('mail_password', '')
        
        if not mail_username or not mail_password:
            print("ERRO: Configurações de email incompletas para teste de notificação")
            return False
        
        # Dados de teste
        test_ticket_data = {
            'id': 999,
            'title': 'Teste de Notificação de Ticket',
            'description': 'Este é um email de teste para verificar se as notificações de tickets estão funcionando corretamente.',
            'client_name': 'Cliente Teste',
            'priority': 'media',
            'service_name': 'Serviço de Teste',
            'created_at': datetime.now()
        }
        
        print("DEBUG: Testando envio de notificação de ticket...")
        print(f"  Email de destino: {mail_username}")
        print(f"  Ticket ID: {test_ticket_data['id']}")
        print(f"  Título: {test_ticket_data['title']}")
        
        # Testar envio
        send_ticket_notification_email(
            technician_email=mail_username,
            technician_name="Técnico Teste",
            ticket_data=test_ticket_data
        )
        
        print("SUCCESS: Email de notificação de ticket enviado com sucesso!")
        return True
        
    except Exception as e:
        print(f"ERRO no teste de notificação de ticket: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_gmail_configurations(username, password, sender):
    """Testa diferentes configurações para Gmail"""
    results = []
    
    # Configurações para testar
    configs_to_test = [
        {
            "name": "Gmail SSL (Porta 465)",
            "server": "smtp.gmail.com",
            "port": 465,
            "use_ssl": True,
            "use_tls": False
        },
        {
            "name": "Gmail TLS (Porta 587)",
            "server": "smtp.gmail.com", 
            "port": 587,
            "use_ssl": False,
            "use_tls": True
        },
        {
            "name": "Gmail TLS (Porta 25)",
            "server": "smtp.gmail.com",
            "port": 25,
            "use_ssl": False,
            "use_tls": True
        }
    ]
    
    for config in configs_to_test:
        result = {
            "name": config["name"],
            "success": False,
            "error": None,
            "details": {}
        }
        
        try:
            print(f"Testando: {config['name']}")
            
            import smtplib
            from email.mime.text import MIMEText
            
            # Configurar servidor
            if config["use_ssl"]:
                server = smtplib.SMTP_SSL(config["server"], config["port"])
                result["details"]["method"] = "SSL"
            else:
                server = smtplib.SMTP(config["server"], config["port"])
                if config["use_tls"]:
                    server.starttls()
                    result["details"]["method"] = "TLS"
                else:
                    result["details"]["method"] = "Sem criptografia"
            
            result["details"]["server"] = config["server"]
            result["details"]["port"] = config["port"]
            
            # Tentar login
            server.login(username, password)
            result["success"] = True
            result["details"]["login"] = "Sucesso"
            
            # Fechar conexão
            server.quit()
            
            print(f"  ✅ {config['name']}: Sucesso")
            
        except Exception as e:
            result["error"] = str(e)
            result["details"]["login"] = f"Falha: {str(e)}"
            print(f"  ❌ {config['name']}: {str(e)}")
        
        results.append(result)
    
    return results


def check_email_config_status():
    """Verifica o status das configurações de email"""
    try:
        from ..models import SystemConfig
        
        # Obter configurações do banco
        mail_server = SystemConfig.get('mail_server', '')
        mail_port = SystemConfig.get('mail_port', '')
        mail_username = SystemConfig.get('mail_username', '')
        mail_password = SystemConfig.get('mail_password', '')
        mail_sender = SystemConfig.get('mail_default_sender', '')
        mail_tls = SystemConfig.get('mail_use_tls', '')
        
        status = {
            'configured': False,
            'missing_fields': [],
            'config': {
                'mail_server': mail_server,
                'mail_port': mail_port,
                'mail_username': mail_username,
                'mail_password': '***' if mail_password else '',
                'mail_default_sender': mail_sender,
                'mail_use_tls': mail_tls
            }
        }
        
        # Verificar campos obrigatórios
        required_fields = {
            'mail_server': mail_server,
            'mail_port': mail_port,
            'mail_username': mail_username,
            'mail_password': mail_password,
            'mail_default_sender': mail_sender
        }
        
        for field, value in required_fields.items():
            if not value or value.strip() == '':
                status['missing_fields'].append(field)
        
        status['configured'] = len(status['missing_fields']) == 0
        
        return status
        
    except Exception as e:
        print(f"Erro ao verificar configurações de email: {e}")
        return {
            'configured': False,
            'missing_fields': ['erro_verificacao'],
            'error': str(e),
            'config': {}
        }
