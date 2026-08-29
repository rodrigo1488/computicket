"""
Blueprint para gestão de sistemas e planos de suporte
"""

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from app import db
from app.models import System, Plan, ClientPlan, PlanUsage, Client
from app.timezone_utils import get_brasilia_now
from datetime import datetime, timedelta
import os
from werkzeug.utils import secure_filename

plans_bp = Blueprint('plans', __name__, url_prefix='/plans')

# Verificação simples de schema (SQLite/Postgres) para coluna support_included
_plan_schema_checked = False
_custom_plan_schema_checked = False
_plan_additional_schema_checked = False

def _ensure_plan_support_included_column():
    global _plan_schema_checked
    if _plan_schema_checked:
        return
    try:
        from app.schema_utils import ensure_column
        dialect = db.session.bind.dialect.name if db.session.bind else ""
        default = "FALSE" if dialect == "postgresql" else "0"
        ensure_column("plan", "support_included", f"BOOLEAN DEFAULT {default}")
        _plan_schema_checked = True
    except Exception as e:
        print(f"⚠️ Erro ao garantir coluna support_included: {e}")


def _ensure_custom_plan_tables():
    """Cria tabelas para planos personalizados e seus itens se não existirem."""
    global _custom_plan_schema_checked
    if _custom_plan_schema_checked:
        return
    try:
        from app.schema_utils import ensure_tables_from_metadata
        # Garante modelos registrados
        from app.models import CustomPlan, CustomPlanItem  # noqa: F401
        ensure_tables_from_metadata(["custom_plan", "custom_plan_item"])
        _custom_plan_schema_checked = True
    except Exception as e:
        print(f"⚠️ Erro ao garantir tabelas de planos personalizados: {e}")


def _ensure_plan_additional_table():
    """Cria tabela de adicionais por plano se não existir."""
    global _plan_additional_schema_checked
    if _plan_additional_schema_checked:
        return
    try:
        from app.schema_utils import ensure_tables_from_metadata
        from app.models import PlanAdditional  # noqa: F401
        ensure_tables_from_metadata(["plan_additional"])
        _plan_additional_schema_checked = True
    except Exception as e:
        print(f"⚠️ Erro ao garantir tabela plan_additional: {e}")

@plans_bp.before_request
def _plans_before_request():
    _ensure_plan_support_included_column()
    _ensure_custom_plan_tables()
    _ensure_plan_additional_table()

# ===== SISTEMAS =====

@plans_bp.route('/')
@login_required
def index():
    """Página principal dos planos"""
    # Garantir schema antes de qualquer acesso a Plan
    _ensure_plan_support_included_column()

    systems = System.query.filter_by(is_active=True).all()
    
    # Calcular estatísticas sem selecionar todas as colunas (evita erro se coluna nova ainda não existir)
    from sqlalchemy import func
    total_plans = db.session.query(func.count(Plan.id)).filter(Plan.is_active == True).scalar() or 0
    active_client_plans = db.session.query(func.count(ClientPlan.id)).filter(ClientPlan.is_active == True).scalar() or 0
    
    # Planos expirando em 30 dias
    from datetime import timedelta
    thirty_days_from_now = get_brasilia_now() + timedelta(days=30)
    expiring_plans = ClientPlan.query.filter(
        ClientPlan.is_active == True,
        ClientPlan.end_date <= thirty_days_from_now,
        ClientPlan.end_date > get_brasilia_now()
    ).count()
    
    # Contagens por sistema sem carregar colunas de Plan
    from sqlalchemy import func
    system_counts = {}
    for s in systems:
        total = db.session.query(func.count(Plan.id)).filter(Plan.system_id == s.id).scalar() or 0
        active = db.session.query(func.count(Plan.id)).filter(Plan.system_id == s.id, Plan.is_active == True).scalar() or 0
        system_counts[s.id] = { 'total': total, 'active': active }

    return render_template('plans/index.html', 
                         systems=systems,
                         total_plans=total_plans,
                         active_client_plans=active_client_plans,
                         expiring_plans=expiring_plans,
                         system_counts=system_counts)

@plans_bp.route('/systems')
@login_required
def list_systems():
    """Listar todos os sistemas"""
    systems = System.query.all()
    return render_template('plans/systems/list.html', systems=systems)

@plans_bp.route('/systems/create', methods=['GET', 'POST'])
@login_required
def create_system():
    """Criar novo sistema"""
    if request.method == 'POST':
        try:
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            version = request.form.get('version', '').strip()
            company = request.form.get('company', '').strip()
            
            if not name:
                flash('Nome do sistema é obrigatório!', 'error')
                return render_template('plans/systems/create.html')
            
            # Verificar se já existe sistema com este nome
            existing_system = System.query.filter_by(name=name).first()
            if existing_system:
                flash('Já existe um sistema com este nome!', 'error')
                return render_template('plans/systems/create.html')
            
            system = System(
                name=name,
                description=description,
                version=version,
                company=company,
                is_active=True
            )
            
            db.session.add(system)
            db.session.commit()
            
            flash(f'Sistema "{name}" criado com sucesso!', 'success')
            return redirect(url_for('plans.list_systems'))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao criar sistema: {str(e)}', 'error')
            return render_template('plans/systems/create.html')
    
    return render_template('plans/systems/create.html')

@plans_bp.route('/systems/<int:system_id>')
@login_required
def view_system(system_id):
    """Visualizar sistema e seus planos"""
    _ensure_plan_support_included_column()
    system = System.query.get_or_404(system_id)
    return render_template('plans/systems/view.html', system=system)

@plans_bp.route('/systems/<int:system_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_system(system_id):
    """Editar sistema"""
    system = System.query.get_or_404(system_id)
    
    if request.method == 'POST':
        try:
            system.name = request.form.get('name', '').strip()
            system.description = request.form.get('description', '').strip()
            system.version = request.form.get('version', '').strip()
            system.company = request.form.get('company', '').strip()
            system.is_active = request.form.get('is_active') == 'on'
            
            if not system.name:
                flash('Nome do sistema é obrigatório!', 'error')
                return render_template('plans/systems/edit.html', system=system)
            
            db.session.commit()
            flash(f'Sistema "{system.name}" atualizado com sucesso!', 'success')
            return redirect(url_for('plans.view_system', system_id=system.id))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao atualizar sistema: {str(e)}', 'error')
            return render_template('plans/systems/edit.html', system=system)
    
    return render_template('plans/systems/edit.html', system=system)

@plans_bp.route('/systems/<int:system_id>/delete', methods=['POST'])
@login_required
def delete_system(system_id):
    """Deletar sistema"""
    system = System.query.get_or_404(system_id)
    
    try:
        # Verificar se há planos associados
        if system.plans:
            flash('Não é possível deletar sistema que possui planos associados!', 'error')
            return redirect(url_for('plans.view_system', system_id=system.id))
        
        db.session.delete(system)
        db.session.commit()
        flash(f'Sistema "{system.name}" deletado com sucesso!', 'success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Erro ao deletar sistema: {str(e)}', 'error')
    
    return redirect(url_for('plans.list_systems'))

# ===== PLANOS =====

@plans_bp.route('/systems/<int:system_id>/plans')
@login_required
def list_plans(system_id):
    """Listar planos de um sistema"""
    _ensure_plan_support_included_column()
    system = System.query.get_or_404(system_id)
    plans = Plan.query.filter_by(system_id=system_id).all()
    return render_template('plans/plans/list.html', system=system, plans=plans)

@plans_bp.route('/systems/<int:system_id>/plans/create', methods=['GET', 'POST'])
@login_required
def create_plan(system_id):
    """Criar novo plano"""
    system = System.query.get_or_404(system_id)
    
    if request.method == 'POST':
        try:
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            monthly_hours = int(request.form.get('monthly_hours', 0))
            additional_hour_rate = float(request.form.get('additional_hour_rate', 0))
            monthly_value = float(request.form.get('monthly_value', 0))
            setup_fee = float(request.form.get('setup_fee', 0))
            response_time_hours = int(request.form.get('response_time_hours', 24))
            resolution_time_hours = int(request.form.get('resolution_time_hours', 72))
            priority_level = int(request.form.get('priority_level', 3))
            
            # Tipos de suporte
            includes_remote_support = request.form.get('includes_remote_support') == 'on'
            includes_on_site_support = request.form.get('includes_on_site_support') == 'on'
            includes_phone_support = request.form.get('includes_phone_support') == 'on'
            includes_email_support = request.form.get('includes_email_support') == 'on'
            support_included = request.form.get('support_included') == 'on'
            
            # Status
            is_active = request.form.get('is_active') == 'on'
            is_featured = request.form.get('is_featured') == 'on'
            
            if not name:
                flash('Nome do plano é obrigatório!', 'error')
                return render_template('plans/plans/create.html', system=system)
            
            plan = Plan(
                system_id=system_id,
                name=name,
                description=description,
                monthly_hours=monthly_hours,
                additional_hour_rate=additional_hour_rate,
                monthly_value=monthly_value,
                setup_fee=setup_fee,
                response_time_hours=response_time_hours,
                resolution_time_hours=resolution_time_hours,
                priority_level=priority_level,
                includes_remote_support=includes_remote_support,
                includes_on_site_support=includes_on_site_support,
                includes_phone_support=includes_phone_support,
                includes_email_support=includes_email_support,
                is_active=is_active,
                is_featured=is_featured,
                support_included=support_included
            )
            
            db.session.add(plan)
            db.session.commit()
            
            # Adicionais (opcionais) enviados como listas paralelas
            from sqlalchemy import text
            _ensure_plan_additional_table()
            additional_descs = request.form.getlist('additional_description[]')
            additional_values = request.form.getlist('additional_value[]')
            now_iso = get_brasilia_now()
            for desc, val in zip(additional_descs, additional_values):
                d = (desc or '').strip()
                try:
                    v = float(val or 0)
                except Exception:
                    v = 0.0
                if d and v >= 0:
                    db.session.execute(
                        text("INSERT INTO plan_additional (plan_id, description, value, created_at) VALUES (:pid, :d, :v, :created_at)"),
                        { 'pid': plan.id, 'd': d, 'v': v, 'created_at': now_iso }
                    )
            db.session.commit()
            
            flash(f'Plano "{name}" criado com sucesso!', 'success')
            return redirect(url_for('plans.list_plans', system_id=system_id))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao criar plano: {str(e)}', 'error')
            return render_template('plans/plans/create.html', system=system)
    
    return render_template('plans/plans/create.html', system=system)

@plans_bp.route('/plans/<int:plan_id>')
@login_required
def view_plan(plan_id):
    """Visualizar plano"""
    _ensure_plan_support_included_column()
    _ensure_plan_additional_table()
    plan = Plan.query.get_or_404(plan_id)
    from sqlalchemy import text
    try:
        additionals = db.session.execute(
            text("SELECT description, value FROM plan_additional WHERE plan_id = :pid ORDER BY id ASC"),
            { 'pid': plan_id }
        ).mappings().all()
    except Exception:
        additionals = []
    return render_template('plans/plans/view.html', plan=plan, additionals=additionals)

@plans_bp.route('/plans/<int:plan_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_plan(plan_id):
    """Editar plano"""
    plan = Plan.query.get_or_404(plan_id)
    
    if request.method == 'POST':
        try:
            plan.name = request.form.get('name', '').strip()
            plan.description = request.form.get('description', '').strip()
            plan.monthly_hours = int(request.form.get('monthly_hours', 0))
            plan.additional_hour_rate = float(request.form.get('additional_hour_rate', 0))
            plan.monthly_value = float(request.form.get('monthly_value', 0))
            plan.setup_fee = float(request.form.get('setup_fee', 0))
            plan.response_time_hours = int(request.form.get('response_time_hours', 24))
            plan.resolution_time_hours = int(request.form.get('resolution_time_hours', 72))
            plan.priority_level = int(request.form.get('priority_level', 3))
            
            # Tipos de suporte
            plan.includes_remote_support = request.form.get('includes_remote_support') == 'on'
            plan.includes_on_site_support = request.form.get('includes_on_site_support') == 'on'
            plan.includes_phone_support = request.form.get('includes_phone_support') == 'on'
            plan.includes_email_support = request.form.get('includes_email_support') == 'on'
            plan.support_included = request.form.get('support_included') == 'on'
            
            # Status
            plan.is_active = request.form.get('is_active') == 'on'
            plan.is_featured = request.form.get('is_featured') == 'on'
            
            if not plan.name:
                flash('Nome do plano é obrigatório!', 'error')
                return render_template('plans/plans/edit.html', plan=plan)
            
            db.session.commit()
            flash(f'Plano "{plan.name}" atualizado com sucesso!', 'success')
            return redirect(url_for('plans.view_plan', plan_id=plan.id))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao atualizar plano: {str(e)}', 'error')
            return render_template('plans/plans/edit.html', plan=plan)
    
    return render_template('plans/plans/edit.html', plan=plan)

@plans_bp.route('/plans/<int:plan_id>/delete', methods=['POST'])
@login_required
def delete_plan(plan_id):
    """Deletar plano"""
    plan = Plan.query.get_or_404(plan_id)
    system_id = plan.system_id
    
    try:
        # Verificar se há clientes com este plano
        if plan.client_plans:
            flash('Não é possível deletar plano que possui clientes associados!', 'error')
            return redirect(url_for('plans.view_plan', plan_id=plan.id))
        
        db.session.delete(plan)
        db.session.commit()
        flash(f'Plano "{plan.name}" deletado com sucesso!', 'success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Erro ao deletar plano: {str(e)}', 'error')
    
    return redirect(url_for('plans.list_plans', system_id=system_id))

# ===== CLIENTES E PLANOS =====

@plans_bp.route('/clients')
@login_required
def list_client_plans():
    """Listar planos dos clientes"""
    client_plans = ClientPlan.query.all()
    return render_template('plans/clients/list.html', client_plans=client_plans)

@plans_bp.route('/clients/<int:client_id>/plans')
@login_required
def list_client_plans_by_client(client_id):
    """Listar planos de um cliente específico"""
    client = Client.query.get_or_404(client_id)
    client_plans = ClientPlan.query.filter_by(client_id=client_id).all()
    return render_template('plans/clients/client_plans.html', client=client, client_plans=client_plans)

@plans_bp.route('/clients/<int:client_id>/plans/create', methods=['GET', 'POST'])
@login_required
def create_client_plan(client_id):
    """Criar plano para cliente"""
    client = Client.query.get_or_404(client_id)
    plans = Plan.query.filter_by(is_active=True).all()
    
    if request.method == 'POST':
        try:
            plan_id = int(request.form.get('plan_id'))
            start_date = datetime.strptime(request.form.get('start_date'), '%Y-%m-%d')
            end_date = datetime.strptime(request.form.get('end_date'), '%Y-%m-%d')
            
            # Configurações personalizadas (opcionais)
            custom_monthly_hours = request.form.get('custom_monthly_hours')
            custom_hour_rate = request.form.get('custom_hour_rate')
            
            custom_monthly_hours = int(custom_monthly_hours) if custom_monthly_hours else None
            custom_hour_rate = float(custom_hour_rate) if custom_hour_rate else None
            
            # Status
            is_active = request.form.get('is_active') == 'on'
            is_auto_renew = request.form.get('is_auto_renew') == 'on'
            
            if start_date >= end_date:
                flash('Data de fim deve ser posterior à data de início!', 'error')
                return render_template('plans/clients/create.html', client=client, plans=plans)
            
            client_plan = ClientPlan(
                client_id=client_id,
                plan_id=plan_id,
                start_date=start_date,
                end_date=end_date,
                custom_monthly_hours=custom_monthly_hours,
                custom_hour_rate=custom_hour_rate,
                is_active=is_active,
                is_auto_renew=is_auto_renew
            )
            
            db.session.add(client_plan)
            db.session.commit()
            
            flash(f'Plano contratado para "{client.name}" com sucesso!', 'success')
            return redirect(url_for('plans.list_client_plans_by_client', client_id=client_id))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao contratar plano: {str(e)}', 'error')
            return render_template('plans/clients/create.html', client=client, plans=plans)
    
    return render_template('plans/clients/create.html', client=client, plans=plans)

@plans_bp.route('/client-plans/<int:client_plan_id>')
@login_required
def view_client_plan(client_plan_id):
    """Visualizar plano do cliente"""
    client_plan = ClientPlan.query.get_or_404(client_plan_id)
    
    # Buscar uso do plano nos últimos 6 meses
    from datetime import datetime
    current_date = get_brasilia_now()
    six_months_ago = current_date - timedelta(days=180)
    
    usage_records = PlanUsage.query.filter(
        PlanUsage.client_plan_id == client_plan_id,
        PlanUsage.created_at >= six_months_ago
    ).order_by(PlanUsage.month_year.desc()).all()
    
    return render_template('plans/clients/view.html', client_plan=client_plan, usage_records=usage_records)

@plans_bp.route('/client-plans/<int:client_plan_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_client_plan(client_plan_id):
    """Editar plano do cliente"""
    client_plan = ClientPlan.query.get_or_404(client_plan_id)
    
    if request.method == 'POST':
        try:
            start_date = datetime.strptime(request.form.get('start_date'), '%Y-%m-%d')
            end_date = datetime.strptime(request.form.get('end_date'), '%Y-%m-%d')
            
            # Configurações personalizadas
            custom_monthly_hours = request.form.get('custom_monthly_hours')
            custom_hour_rate = request.form.get('custom_hour_rate')
            
            client_plan.custom_monthly_hours = int(custom_monthly_hours) if custom_monthly_hours else None
            client_plan.custom_hour_rate = float(custom_hour_rate) if custom_hour_rate else None
            client_plan.start_date = start_date
            client_plan.end_date = end_date
            client_plan.is_active = request.form.get('is_active') == 'on'
            client_plan.is_auto_renew = request.form.get('is_auto_renew') == 'on'
            
            if start_date >= end_date:
                flash('Data de fim deve ser posterior à data de início!', 'error')
                return render_template('plans/clients/edit.html', client_plan=client_plan)
            
            db.session.commit()
            flash(f'Plano do cliente "{client_plan.client.name}" atualizado com sucesso!', 'success')
            return redirect(url_for('plans.view_client_plan', client_plan_id=client_plan.id))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao atualizar plano: {str(e)}', 'error')
            return render_template('plans/clients/edit.html', client_plan=client_plan)
    
    return render_template('plans/clients/edit.html', client_plan=client_plan)

# ===== CONTROLE DE USO =====

@plans_bp.route('/usage/<int:client_plan_id>')
@login_required
def view_usage(client_plan_id):
    """Visualizar uso de horas do plano"""
    client_plan = ClientPlan.query.get_or_404(client_plan_id)
    
    # Buscar uso dos últimos 12 meses
    current_date = get_brasilia_now()
    twelve_months_ago = current_date - timedelta(days=365)
    
    usage_records = PlanUsage.query.filter(
        PlanUsage.client_plan_id == client_plan_id,
        PlanUsage.created_at >= twelve_months_ago
    ).order_by(PlanUsage.month_year.desc()).all()
    
    return render_template('plans/usage/view.html', client_plan=client_plan, usage_records=usage_records)

@plans_bp.route('/usage/<int:client_plan_id>/add', methods=['GET', 'POST'])
@login_required
def add_usage(client_plan_id):
    """Adicionar uso de horas manualmente"""
    client_plan = ClientPlan.query.get_or_404(client_plan_id)
    
    if request.method == 'POST':
        try:
            hours_used = float(request.form.get('hours_used', 0))
            month_year = request.form.get('month_year')  # Formato: YYYY-MM
            ticket_id = request.form.get('ticket_id')
            
            if not month_year or hours_used <= 0:
                flash('Horas e mês/ano são obrigatórios!', 'error')
                return render_template('plans/usage/add.html', client_plan=client_plan)
            
            # Verificar se já existe registro para este mês
            existing_usage = PlanUsage.query.filter(
                PlanUsage.client_plan_id == client_plan_id,
                PlanUsage.month_year == month_year
            ).first()
            
            if existing_usage:
                existing_usage.hours_used += hours_used
                if ticket_id:
                    existing_usage.ticket_id = ticket_id
            else:
                usage = PlanUsage(
                    client_plan_id=client_plan_id,
                    hours_used=hours_used,
                    month_year=month_year,
                    ticket_id=ticket_id if ticket_id else None
                )
                db.session.add(usage)
            
            db.session.commit()
            flash(f'Uso de {hours_used}h adicionado com sucesso!', 'success')
            return redirect(url_for('plans.view_usage', client_plan_id=client_plan_id))
            
        except Exception as e:
            db.session.rollback()
            flash(f'Erro ao adicionar uso: {str(e)}', 'error')
            return render_template('plans/usage/add.html', client_plan=client_plan)
    
    return render_template('plans/usage/add.html', client_plan=client_plan)

# ===== API ENDPOINTS =====

@plans_bp.route('/api/systems/<int:system_id>/plans')
@login_required
def api_system_plans(system_id):
    """API para buscar planos de um sistema"""
    system = System.query.get_or_404(system_id)
    plans = Plan.query.filter_by(system_id=system_id, is_active=True).all()
    
    return jsonify({
        'system': {
            'id': system.id,
            'name': system.name,
            'version': system.version
        },
        'plans': [{
            'id': plan.id,
            'name': plan.name,
            'description': plan.description,
            'monthly_hours': plan.monthly_hours,
            'additional_hour_rate': plan.additional_hour_rate,
            'monthly_value': plan.monthly_value,
            'priority_level': plan.priority_level,
            'priority_text': plan.get_priority_text(),
            'support_types': plan.get_support_types(),
            'sla_text': plan.get_sla_text()
        } for plan in plans]
    })

@plans_bp.route('/api/clients/<int:client_id>/active-plans')
@login_required
def api_client_active_plans(client_id):
    """API para buscar planos ativos de um cliente"""
    client_plans = ClientPlan.query.filter(
        ClientPlan.client_id == client_id,
        ClientPlan.is_active == True
    ).all()
    
    return jsonify({
        'client_id': client_id,
        'active_plans': [{
            'id': cp.id,
            'plan_name': cp.plan.name,
            'system_name': cp.plan.system.name,
            'monthly_hours': cp.get_effective_monthly_hours(),
            'additional_hour_rate': cp.get_effective_hour_rate(),
            'start_date': cp.start_date.strftime('%d/%m/%Y'),
            'end_date': cp.end_date.strftime('%d/%m/%Y'),
            'days_until_expiry': cp.days_until_expiry(),
            'status': cp.get_status_text()
        } for cp in client_plans]
    })

# ===== PLANOS PERSONALIZADOS (público/admin) =====

@plans_bp.route('/api/custom-plans', methods=['POST'])
@login_required
def api_create_custom_plan():
    """Cria um plano personalizado com itens (adicionais). Espera JSON:
    {
      "system_id": 1,
      "name": "Plano Personalizado X" (opcional),
      "base_value": 0,
      "items": [{"description": "Item A", "value": 10.0}, ...]
    }
    """
    try:
        _ensure_custom_plan_tables()
        payload = request.get_json(force=True, silent=False)
        if not payload:
            return jsonify({"error": "JSON inválido"}), 400

        system_id = payload.get('system_id')
        name = (payload.get('name') or '').strip()
        base_value = float(payload.get('base_value') or 0)
        items = payload.get('items') or []

        if not system_id:
            return jsonify({"error": "system_id é obrigatório"}), 400

        # validação leve dos itens
        valid_items = []
        total_additionals = 0.0
        for it in items:
            desc = (it.get('description') or '').strip()
            try:
                val = float(it.get('value') or 0)
            except Exception:
                val = 0.0
            if desc and val >= 0:
                valid_items.append({"description": desc, "value": val})
                total_additionals += val

        total_value = base_value + total_additionals

        # Persistir e obter ID (funciona em SQLite e PostgreSQL)
        from sqlalchemy import text
        now_iso = get_brasilia_now()
        dialect = db.session.bind.dialect.name if db.session.bind else ""
        insert_sql = (
            "INSERT INTO custom_plan (system_id, name, base_value, total_value, created_at, created_by_id) "
            "VALUES (:sid, :name, :base, :total, :created_at, :uid)"
        )
        params = {
            'sid': system_id,
            'name': name,
            'base': base_value,
            'total': total_value,
            'created_at': now_iso,
            'uid': getattr(current_user, 'id', None)
        }
        if dialect == "postgresql":
            res = db.session.execute(text(insert_sql + " RETURNING id"), params)
            custom_plan_id = res.scalar()
        else:
            res = db.session.execute(text(insert_sql), params)
            custom_plan_id = res.lastrowid if hasattr(res, 'lastrowid') else None
            if not custom_plan_id:
                row = db.session.execute(text("SELECT last_insert_rowid() as lid")).first()
                custom_plan_id = row.lid if row else None

        for it in valid_items:
            db.session.execute(
                text("INSERT INTO custom_plan_item (custom_plan_id, description, value, created_at) VALUES (:cpid, :d, :v, :created_at)"),
                { 'cpid': custom_plan_id, 'd': it['description'], 'v': it['value'], 'created_at': now_iso }
            )

        db.session.commit()

        return jsonify({
            'id': custom_plan_id,
            'system_id': system_id,
            'name': name,
            'base_value': base_value,
            'items': valid_items,
            'total_value': total_value
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Falha ao criar plano personalizado: {str(e)}"}), 500


@plans_bp.route('/api/custom-plans/<int:custom_plan_id>', methods=['GET'])
@login_required
def api_get_custom_plan(custom_plan_id: int):
    """Retorna um plano personalizado e seus itens."""
    try:
        from sqlalchemy import text
        plan = db.session.execute(text("SELECT * FROM custom_plan WHERE id = :id"), { 'id': custom_plan_id }).mappings().first()
        if not plan:
            return jsonify({"error": "Plano personalizado não encontrado"}), 404
        items = db.session.execute(text("SELECT id, description, value FROM custom_plan_item WHERE custom_plan_id = :id"), { 'id': custom_plan_id }).mappings().all()
        return jsonify({
            'id': plan['id'],
            'system_id': plan['system_id'],
            'name': plan['name'],
            'base_value': plan['base_value'],
            'total_value': plan['total_value'],
            'items': [{ 'id': it['id'], 'description': it['description'], 'value': it['value'] } for it in items]
        })
    except Exception as e:
        return jsonify({"error": f"Falha ao buscar plano personalizado: {str(e)}"}), 500
