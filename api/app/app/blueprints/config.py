import os

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from .. import db
from ..models import SystemConfig

bp = Blueprint("config", __name__)


def _admin_only():
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    return None


def _ai_config_payload():
    from ..services.gemini_client import (
        DEFAULT_GENERATION_MODEL,
        _DEPRECATED_GENERATION_MODELS,
        embedding_model,
        generation_model,
    )

    saved_raw = (SystemConfig.get("gemini_model", "") or "").strip()
    bare = saved_raw.split("/", 1)[-1] if saved_raw.startswith("models/") else saved_raw
    if bare in _DEPRECATED_GENERATION_MODELS:
        SystemConfig.set(
            "gemini_model",
            DEFAULT_GENERATION_MODEL,
            "Modelo Gemini para geração",
            "ai",
        )

    saved_key = bool(SystemConfig.get("gemini_api_key", ""))
    env_key = bool((os.environ.get("GEMINI_API_KEY") or "").strip())
    return {
        "api_key_configured": saved_key or env_key,
        "source": "settings" if saved_key else ("env" if env_key else "none"),
        "model": generation_model(),
        "embedding_model": embedding_model(),
    }


@bp.route("/ai", methods=["GET", "PUT"])
@login_required
def ai_config():
    denied = _admin_only()
    if denied:
        return denied
    if request.method == "GET":
        return jsonify(_ai_config_payload())

    payload = request.get_json(silent=True) or {}
    api_key = str(payload.get("api_key") or "").strip()
    model = str(payload.get("model") or "").strip()
    embedding = str(payload.get("embedding_model") or "").strip()
    if len(api_key) > 500 or len(model) > 120 or len(embedding) > 120:
        return jsonify({"success": False, "error": "Configuração inválida."}), 400

    from ..services.config_secrets import encrypt_secret
    from ..services.gemini_client import _normalize_generation_model

    if payload.get("clear_api_key"):
        row = SystemConfig.query.filter_by(key="gemini_api_key").first()
        if row:
            db.session.delete(row)
            db.session.commit()
    elif api_key:
        SystemConfig.set(
            "gemini_api_key",
            encrypt_secret(api_key),
            "Chave da API Gemini criptografada",
            "ai",
        )
    if model:
        SystemConfig.set(
            "gemini_model",
            _normalize_generation_model(model),
            "Modelo Gemini para geração",
            "ai",
        )
    if embedding:
        SystemConfig.set("gemini_embedding_model", embedding, "Modelo Gemini para embeddings", "ai")
    return jsonify({"success": True, **_ai_config_payload()})


@bp.route("/ai/test", methods=["POST"])
@login_required
def test_ai_config():
    denied = _admin_only()
    if denied:
        return denied
    try:
        from ..services.gemini_client import (
            GeminiConfigError,
            GeminiError,
            embed_texts,
            generation_model,
            get_client,
        )

        response = get_client().models.generate_content(
            model=generation_model(),
            contents="Responda apenas OK.",
        )
        reply = (getattr(response, "text", None) or "").strip()
        vectors = embed_texts(["Teste de conexão do Copiloto Computicket."])
        if not reply or not vectors:
            raise GeminiError("O Gemini retornou uma resposta vazia.")
        return jsonify({"success": True, "message": "Geração e embeddings conectados com sucesso."})
    except GeminiConfigError as exc:
        return jsonify({"success": False, "error": str(exc)}), 503
    except GeminiError as exc:
        return jsonify({"success": False, "error": str(exc)}), 503
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 503


@bp.route("/")
@login_required
def index():
    """Página principal de configurações"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        flash("Acesso negado. Apenas administradores podem acessar as configurações.", "error")
        return redirect(url_for("dashboard.index"))
    
    # Obter configurações por categoria
    email_configs = SystemConfig.get_all_by_category("email")
    general_configs = SystemConfig.get_all_by_category("general")
    system_configs = SystemConfig.get_all_by_category("system")
    
    return render_template("config/index.html", 
                         email_configs=email_configs,
                         general_configs=general_configs,
                         system_configs=system_configs)


@bp.route("/save", methods=["POST"])
@login_required
def save_config():
    """Salva configurações"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        configs = request.get_json()
        
        for key, value in configs.items():
            if key == "gemini_api_key":
                from ..services.config_secrets import encrypt_secret

                value = encrypt_secret(str(value))
            # Determinar categoria baseada na chave
            if key.startswith("mail_"):
                category = "email"
            elif key.startswith("gemini_"):
                category = "ai"
            elif key.startswith("uniplus_"):
                category = "uniplus"
            elif key.startswith("system_"):
                category = "system"
            else:
                category = "general"
            
            # Definir descrições padrão
            descriptions = {
                "mail_server": "Servidor SMTP para envio de emails",
                "mail_port": "Porta do servidor SMTP",
                "mail_use_tls": "Usar TLS para conexão SMTP",
                "mail_username": "Usuário/email para autenticação SMTP",
                "mail_password": "Senha do email ou senha de aplicativo",
                "mail_default_sender": "Email remetente padrão",
                "system_name": "Nome do sistema",
                "system_url": "URL base do sistema",
                "ticket_prefix": "Prefixo para numeração de tickets",
                "auto_assign_tickets": "Atribuir tickets automaticamente",
                "email_notifications": "Enviar notificações por email",
                "backup_enabled": "Habilitar backup automático",
                "backup_frequency": "Frequência do backup (dias)",
                "system_timezone": "Fuso horário do sistema",
                "uniplus_agent_enabled": "Usar agente local para escritas no Unico (1/0)",
                "uniplus_agent_device_id": "Device-Id do agente Uniplus",
                "uniplus_agent_token": "Token Bearer do agente Uniplus",
            }
            
            SystemConfig.set(
                key=key,
                value=str(value),
                description=descriptions.get(key, f"Configuração: {key}"),
                category=category
            )
        
        return jsonify({"success": True, "message": "Configurações salvas com sucesso!"})
        
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao salvar configurações: {str(e)}"}), 500


@bp.route("/test-email", methods=["POST"])
@login_required
def test_email():
    """Testa o envio de email com as configurações atuais"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        from ..blueprints.utils import send_email_test
        
        # Atualizar configurações do Flask-Mail com as configurações do banco
        from flask import current_app
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
        
        # Verificar se as configurações estão completas antes de testar
        if not current_app.config.get('MAIL_USERNAME') or not current_app.config.get('MAIL_PASSWORD'):
            return jsonify({
                "success": False, 
                "error": "Configurações incompletas. Verifique se usuário e senha estão preenchidos."
            })
        
        # Testar envio
        success = send_email_test()
        
        if success:
            return jsonify({
                "success": True, 
                "message": "Email de teste enviado com sucesso! Verifique sua caixa de entrada."
            })
        else:
            return jsonify({
                "success": False, 
                "error": "Falha ao enviar email de teste. Verifique as configurações e os logs do servidor."
            })
            
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao testar email: {str(e)}"}), 500


@bp.route("/test-gmail-configs", methods=["POST"])
@login_required
def test_gmail_configs():
    """Testa diferentes configurações para Gmail"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        from ..blueprints.utils import test_gmail_configurations
        
        # Obter configurações atuais
        mail_username = SystemConfig.get('mail_username', '')
        mail_password = SystemConfig.get('mail_password', '')
        mail_sender = SystemConfig.get('mail_default_sender', '')
        
        if not mail_username or not mail_password:
            return jsonify({
                "success": False, 
                "error": "Usuário ou senha não configurados"
            })
        
        # Testar diferentes configurações
        results = test_gmail_configurations(mail_username, mail_password, mail_sender)
        
        return jsonify({
            "success": True,
            "results": results
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao testar configurações: {str(e)}"}), 500


@bp.route("/test-ticket-notification", methods=["POST"])
@login_required
def test_ticket_notification():
    """Testa o envio de email de notificação de ticket"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        from ..blueprints.utils import test_ticket_notification_email
        
        # Testar envio
        success = test_ticket_notification_email()
        
        if success:
            return jsonify({
                "success": True, 
                "message": "Email de notificação de ticket enviado com sucesso! Verifique sua caixa de entrada."
            })
        else:
            return jsonify({
                "success": False, 
                "error": "Falha ao enviar email de notificação de ticket. Verifique as configurações e os logs do servidor."
            })
            
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao testar notificação de ticket: {str(e)}"}), 500


@bp.route("/email-status", methods=["GET"])
@login_required
def email_status():
    """Verifica o status das configurações de email"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        from ..blueprints.utils import check_email_config_status
        
        status = check_email_config_status()
        return jsonify({
            "success": True,
            "status": status
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao verificar status: {str(e)}"}), 500


@bp.route("/reset", methods=["POST"])
@login_required
def reset_config():
    """Reseta configurações para valores padrão"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        # Configurações padrão
        default_configs = {
            "mail_server": ("smtp.gmail.com", "Servidor SMTP para envio de emails", "email"),
            "mail_port": ("587", "Porta do servidor SMTP", "email"),
            "mail_use_tls": ("true", "Usar TLS para conexão SMTP", "email"),
            "mail_username": ("", "Usuário/email para autenticação SMTP", "email"),
            "mail_password": ("", "Senha do email ou senha de aplicativo", "email"),
            "mail_default_sender": ("", "Email remetente padrão", "email"),
            "system_name": ("Sistema de Tickets", "Nome do sistema", "system"),
            "system_url": ("http://localhost:5000", "URL base do sistema", "system"),
            "ticket_prefix": ("TK", "Prefixo para numeração de tickets", "system"),
            "system_timezone": ("America/Sao_Paulo", "Fuso Horário Padrão", "system"),
            "auto_assign_tickets": ("false", "Atribuir tickets automaticamente", "general"),
            "email_notifications": ("true", "Enviar notificações por email", "general"),
            "backup_enabled": ("false", "Habilitar backup automático", "system"),
            "backup_frequency": ("7", "Frequência do backup (dias)", "system")
        }
        
        for key, (value, description, category) in default_configs.items():
            SystemConfig.set(key=key, value=value, description=description, category=category)
        
        return jsonify({"success": True, "message": "Configurações resetadas para valores padrão!"})
        
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao resetar configurações: {str(e)}"}), 500


@bp.route("/diagnose-email", methods=["GET"])
@login_required
def diagnose_email():
    """Diagnostica problemas com configuração de email"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        from ..blueprints.utils import check_email_config_status
        
        # Verificar status das configurações
        config_status = check_email_config_status()
        
        # Verificar se notificações estão habilitadas
        email_notifications = SystemConfig.get('email_notifications', 'true')
        
        # Verificar se há tickets recentes para testar
        from ..models import Ticket
        recent_tickets = Ticket.query.order_by(Ticket.created_at.desc()).limit(5).all()
        
        # Verificar se há usuários com email
        from ..models import User
        users_with_email = User.query.filter(User.email.isnot(None), User.email != '').all()
        
        diagnosis = {
            "success": True,
            "config_status": config_status,
            "email_notifications_enabled": email_notifications.lower() == 'true',
            "recent_tickets_count": len(recent_tickets),
            "users_with_email_count": len(users_with_email),
            "issues": [],
            "recommendations": []
        }
        
        # Identificar problemas
        if not config_status['configured']:
            diagnosis["issues"].append("Configurações de email incompletas")
            diagnosis["recommendations"].append("Configure todos os campos obrigatórios de email")
        
        if email_notifications.lower() != 'true':
            diagnosis["issues"].append("Notificações por email desabilitadas")
            diagnosis["recommendations"].append("Habilite as notificações por email nas configurações")
        
        if len(users_with_email) == 0:
            diagnosis["issues"].append("Nenhum usuário possui email configurado")
            diagnosis["recommendations"].append("Configure emails para os usuários que devem receber notificações")
        
        if len(recent_tickets) == 0:
            diagnosis["issues"].append("Nenhum ticket recente encontrado")
            diagnosis["recommendations"].append("Crie um ticket de teste para verificar o envio de email")
        
        # Verificar configurações específicas
        mail_server = SystemConfig.get('mail_server', '')
        mail_username = SystemConfig.get('mail_username', '')
        mail_password = SystemConfig.get('mail_password', '')
        
        if not mail_server:
            diagnosis["issues"].append("Servidor SMTP não configurado")
            diagnosis["recommendations"].append("Configure o servidor SMTP (ex: smtp.gmail.com)")
        
        if not mail_username:
            diagnosis["issues"].append("Usuário de email não configurado")
            diagnosis["recommendations"].append("Configure o email de envio")
        
        if not mail_password:
            diagnosis["issues"].append("Senha de email não configurada")
            diagnosis["recommendations"].append("Configure a senha ou senha de aplicativo")
        
        return jsonify(diagnosis)
        
    except Exception as e:
        return jsonify({
            "success": False, 
            "error": f"Erro ao diagnosticar configuração de email: {str(e)}"
        }), 500

@bp.route("/export")
@login_required
def export_config():
    """Exporta configurações para JSON"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"error": "Acesso negado"}), 403
    
    try:
        all_configs = SystemConfig.get_all_by_category()
        return jsonify(all_configs)
    except Exception as e:
        return jsonify({"error": f"Erro ao exportar configurações: {str(e)}"}), 500


@bp.route("/import", methods=["POST"])
@login_required
def import_config():
    """Importa configurações de JSON"""
    # Verificar se o usuário é admin
    if not current_user.has_role("admin"):
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    
    try:
        configs = request.get_json()
        
        for key, config_data in configs.items():
            if isinstance(config_data, dict):
                value = config_data.get('value', '')
                description = config_data.get('description', f"Configuração: {key}")
                category = config_data.get('category', 'general')
            else:
                value = str(config_data)
                description = f"Configuração: {key}"
                category = "general"
            if key == "gemini_api_key" and value:
                from ..services.config_secrets import PREFIX, encrypt_secret

                value = value if str(value).startswith(PREFIX) else encrypt_secret(str(value))
                category = "ai"
            
            SystemConfig.set(key=key, value=value, description=description, category=category)
        
        return jsonify({"success": True, "message": "Configurações importadas com sucesso!"})
        
    except Exception as e:
        return jsonify({"success": False, "error": f"Erro ao importar configurações: {str(e)}"}), 500
