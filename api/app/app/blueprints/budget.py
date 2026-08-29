from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, send_file, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
import os
import secrets
import uuid
import base64
from datetime import datetime
from .. import db
from ..models import Client, Budget, BudgetItem, BudgetTheme, SystemConfig
from ..external_pg import fetch_external_clients
from ..format_utils import format_brl
from ..rich_text_utils import sanitize_rich_html, rich_text_has_content, rich_html_markup, html_to_reportlab

budget = Blueprint('budget', __name__)


@budget.app_template_filter('brl')
def brl_filter(value):
	return format_brl(value)


@budget.app_template_filter('rich_html')
def rich_html_filter(value):
	return rich_html_markup(value)


@budget.context_processor
def budget_template_helpers():
	return {'format_brl': format_brl}

# Configurações de upload
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'rar', '7z'}
LOGO_EXTENSIONS = {'jpg', 'jpeg', 'png'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

def allowed_file(filename):
    """Verifica se o arquivo tem extensão permitida"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_upload_folder():
    """Retorna o diretório de upload"""
    upload_folder = os.path.join(current_app.root_path, 'uploads', 'budgets')
    os.makedirs(upload_folder, exist_ok=True)
    return upload_folder

def get_branding_folder():
    """Diretório do logo dos orçamentos"""
    folder = os.path.join(current_app.root_path, 'uploads', 'budgets', 'branding')
    os.makedirs(folder, exist_ok=True)
    return folder

def get_budget_logo_path():
    """Caminho do logo configurado (ou None se não existir)"""
    logo_path = SystemConfig.get('budget_logo_path')
    if logo_path and os.path.exists(logo_path):
        return logo_path
    return None

def _parse_date(value):
    """Converte 'YYYY-MM-DD' em date; retorna None se vazio/inválido"""
    value = (value or '').strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError:
        return None


def _serialize_dt(value):
    """Serializa datetime para ISO (cliente Co-op / expected_updated_at)."""
    if not value:
        return None
    try:
        return value.replace(microsecond=0).isoformat()
    except Exception:
        return str(value)


def _parse_iso_dt(value):
    """Parse ISO datetime do cliente; retorna naive datetime ou None."""
    if not value:
        return None
    try:
        text = str(value).strip().replace('Z', '+00:00')
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is not None:
            parsed = parsed.replace(tzinfo=None)
        return parsed.replace(microsecond=0)
    except (TypeError, ValueError):
        return None


def _normalize_theme_color(value, default):
    """Normaliza cor hexadecimal para o formato #rrggbb."""
    color = (value or '').strip().lower()
    if not color:
        return default
    if not color.startswith('#'):
        color = f'#{color}'
    if len(color) == 7 and all(c in '0123456789abcdef#' for c in color):
        return color
    return default

@budget.route('/')
@login_required
def index():
    """Lista todos os orçamentos com paginação e pesquisa"""
    try:
        # Parâmetros de paginação
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 12, type=int)
        per_page = max(6, min(48, per_page))
        
        # Parâmetros de pesquisa
        search_term = (request.args.get('q') or '').strip()
        status_filter = request.args.get('status', '')
        client_filter = request.args.get('client', '')
        date_from = request.args.get('date_from', '')
        date_to = request.args.get('date_to', '')
        
        print(f"DEBUG: Termo de busca: '{search_term}'")
        print(f"DEBUG: Filtro status: '{status_filter}'")
        print(f"DEBUG: Filtro cliente: '{client_filter}'")
        
        # Query base
        query = Budget.query
        
        # Aplicar filtros
        if search_term:
            search_pattern = f"%{search_term}%"
            query = query.filter(
                (Budget.title.ilike(search_pattern)) |
                (Budget.description.ilike(search_pattern))
            )
        
        if status_filter:
            query = query.filter(Budget.status == status_filter)
        
        if client_filter:
            if client_filter == 'internal':
                query = query.filter(Budget.client_id.isnot(None), Budget.client_id != -1)
            elif client_filter == 'external':
                query = query.filter(Budget.external_client_id.isnot(None))
            elif client_filter == 'none':
                query = query.filter(Budget.client_id.is_(None), Budget.external_client_id.is_(None))
        
        if date_from:
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d')
                query = query.filter(Budget.created_at >= date_from_obj)
            except ValueError:
                pass
        
        if date_to:
            try:
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d')
                # Adicionar 23:59:59 para incluir o dia inteiro
                date_to_obj = date_to_obj.replace(hour=23, minute=59, second=59)
                query = query.filter(Budget.created_at <= date_to_obj)
            except ValueError:
                pass
        
        # Ordenar por data de criação (mais recente primeiro)
        query = query.order_by(Budget.created_at.desc())
        
        # Aplicar paginação
        pagination = query.paginate(
            page=page, 
            per_page=per_page, 
            error_out=False
        )
        
        budgets = pagination.items
        
        # Buscar clientes para filtro
        internal_clients = Client.query.order_by(Client.name).all()
        external_clients = fetch_external_clients()
        
        return render_template('budget/index.html', 
                             budgets=budgets,
                             pagination=pagination,
                             search_term=search_term,
                             status_filter=status_filter,
                             client_filter=client_filter,
                             date_from=date_from,
                             date_to=date_to,
                             internal_clients=internal_clients,
                             external_clients=external_clients)
    except Exception as e:
        print(f"DEBUG: Erro ao carregar orçamentos: {e}")
        import traceback
        traceback.print_exc()
        flash(f'Erro ao carregar orçamentos: {str(e)}', 'error')
        return render_template('budget/index.html', 
                             budgets=[],
                             pagination=None,
                             search_term='',
                             status_filter='',
                             client_filter='',
                             date_from='',
                             date_to='',
                             internal_clients=[],
                             external_clients=[])

@budget.route('/new', methods=['GET', 'POST'])
@login_required
def new_budget():
    """Cria um novo orçamento"""
    if request.method == 'POST':
        print(f"DEBUG: POST recebido para novo orçamento")
        print(f"DEBUG: Dados do formulário: {dict(request.form)}")
        
        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        client_id = request.form.get('client_id', '').strip()
        external_client_id = request.form.get('external_client_id', '').strip()
        status = request.form.get('status', 'draft').strip()
        
        print(f"DEBUG: title='{title}', client_id='{client_id}', external_client_id='{external_client_id}'")
        
        if not title:
            flash('Título é obrigatório!', 'error')
            return render_template('budget/new_budget.html')
        
        # Verificar se já existe um orçamento com o mesmo título
        existing = Budget.query.filter_by(title=title).first()
        if existing:
            flash(f'Já existe um orçamento com o título "{title}"!', 'error')
            return render_template('budget/new_budget.html')
        
        # Processar cliente
        client_data = None
        is_external = False
        
        if external_client_id:
            # Cliente externo
            external_clients = fetch_external_clients()
            for ext_client in external_clients:
                if ext_client['id'] == int(external_client_id):
                    client_data = {
                        'id': ext_client['id'],
                        'name': ext_client['name'],
                        'is_external': True
                    }
                    is_external = True
                    break
        
        elif client_id:
            # Cliente interno
            client = Client.query.get(client_id)
            if client:
                client_data = {
                    'id': client.id,
                    'name': client.name,
                    'is_external': False
                }
        
        # Processar arquivo
        file_data = None
        if 'file' in request.files:
            file = request.files['file']
            if file and file.filename and allowed_file(file.filename):
                # Verificar tamanho do arquivo
                file.seek(0, os.SEEK_END)
                file_size = file.tell()
                file.seek(0)
                
                if file_size > MAX_FILE_SIZE:
                    flash(f'Arquivo muito grande! Tamanho máximo permitido: {MAX_FILE_SIZE // (1024*1024)}MB', 'error')
                    return render_template('budget/new_budget.html')
                
                # Gerar nome único para o arquivo
                original_filename = secure_filename(file.filename)
                file_ext = original_filename.split('.')[-1].lower()
                stored_filename = f"{uuid.uuid4().hex}.{file_ext}"
                
                # Salvar arquivo
                upload_folder = get_upload_folder()
                file_path = os.path.join(upload_folder, stored_filename)
                file.save(file_path)
                
                file_data = {
                    'original_filename': original_filename,
                    'stored_filename': stored_filename,
                    'file_path': file_path,
                    'file_size': file_size,
                    'file_type': file.content_type or f'application/{file_ext}'
                }
                
                print(f"DEBUG: Arquivo salvo: {file_path}")
            elif file and file.filename:
                flash('Tipo de arquivo não permitido!', 'error')
                return render_template('budget/new_budget.html')
        
        # Criar orçamento
        try:
            if is_external:
                budget_entry = Budget(
                    title=title,
                    description=description if description else None,
                    client_id=-1,  # Valor especial para clientes externos
                    external_client_id=int(external_client_id),
                    external_client_name=client_data['name'] if client_data else None,
                    status=status,
                    created_by_id=current_user.id
                )
            else:
                budget_entry = Budget(
                    title=title,
                    description=description if description else None,
                    client_id=int(client_id) if client_id else None,
                    status=status,
                    created_by_id=current_user.id
                )
            
            # Adicionar dados do arquivo se existir
            if file_data:
                budget_entry.original_filename = file_data['original_filename']
                budget_entry.stored_filename = file_data['stored_filename']
                budget_entry.file_path = file_data['file_path']
                budget_entry.file_size = file_data['file_size']
                budget_entry.file_type = file_data['file_type']
            
            print(f"DEBUG: Budget criado: {budget_entry}")
            
            db.session.add(budget_entry)
            db.session.commit()
            print(f"DEBUG: Orçamento salvo com sucesso no banco de dados")
            flash(f'Orçamento "{title}" criado com sucesso!', 'success')
            return redirect(url_for('budget.index'))
            
        except Exception as e:
            db.session.rollback()
            print(f"DEBUG: Erro ao salvar no banco: {e}")
            import traceback
            traceback.print_exc()
            flash('Erro ao criar orçamento. Tente novamente.', 'error')
            return render_template('budget/new_budget.html')
    
    # GET - Buscar clientes para o formulário
    internal_clients = Client.query.order_by(Client.name).all()
    external_clients = fetch_external_clients()
    
    return render_template('budget/new_budget.html', 
                         internal_clients=internal_clients,
                         external_clients=external_clients)

@budget.route('/edit/<int:budget_id>', methods=['GET', 'POST'])
@login_required
def edit_budget(budget_id):
    """Edita um orçamento existente"""
    budget_entry = Budget.query.get_or_404(budget_id)
    
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        client_id = request.form.get('client_id', '').strip()
        external_client_id = request.form.get('external_client_id', '').strip()
        status = request.form.get('status', 'draft').strip()
        
        if not title:
            flash('Título é obrigatório!', 'error')
            return render_template('budget/edit_budget.html', budget=budget_entry)
        
        # Verificar se já existe outro orçamento com o mesmo título
        existing = Budget.query.filter(
            Budget.title == title,
            Budget.id != budget_id
        ).first()
        
        if existing:
            flash(f'Já existe outro orçamento com o título "{title}"!', 'error')
            return render_template('budget/edit_budget.html', budget=budget_entry)
        
        # Processar cliente
        client_data = None
        is_external = False
        
        if external_client_id:
            # Cliente externo
            external_clients = fetch_external_clients()
            for ext_client in external_clients:
                if ext_client['id'] == int(external_client_id):
                    client_data = {
                        'id': ext_client['id'],
                        'name': ext_client['name'],
                        'is_external': True
                    }
                    is_external = True
                    break
        
        elif client_id:
            # Cliente interno
            client = Client.query.get(client_id)
            if client:
                client_data = {
                    'id': client.id,
                    'name': client.name,
                    'is_external': False
                }
        
        # Processar novo arquivo (se fornecido)
        if 'file' in request.files:
            file = request.files['file']
            if file and file.filename and allowed_file(file.filename):
                # Verificar tamanho do arquivo
                file.seek(0, os.SEEK_END)
                file_size = file.tell()
                file.seek(0)
                
                if file_size > MAX_FILE_SIZE:
                    flash(f'Arquivo muito grande! Tamanho máximo permitido: {MAX_FILE_SIZE // (1024*1024)}MB', 'error')
                    return render_template('budget/edit_budget.html', budget=budget_entry)
                
                # Remover arquivo antigo se existir
                if budget_entry.file_path and os.path.exists(budget_entry.file_path):
                    try:
                        os.remove(budget_entry.file_path)
                        print(f"DEBUG: Arquivo antigo removido: {budget_entry.file_path}")
                    except Exception as e:
                        print(f"DEBUG: Erro ao remover arquivo antigo: {e}")
                
                # Gerar nome único para o novo arquivo
                original_filename = secure_filename(file.filename)
                file_ext = original_filename.split('.')[-1].lower()
                stored_filename = f"{uuid.uuid4().hex}.{file_ext}"
                
                # Salvar novo arquivo
                upload_folder = get_upload_folder()
                file_path = os.path.join(upload_folder, stored_filename)
                file.save(file_path)
                
                # Atualizar dados do arquivo
                budget_entry.original_filename = original_filename
                budget_entry.stored_filename = stored_filename
                budget_entry.file_path = file_path
                budget_entry.file_size = file_size
                budget_entry.file_type = file.content_type or f'application/{file_ext}'
                
                print(f"DEBUG: Novo arquivo salvo: {file_path}")
            elif file and file.filename:
                flash('Tipo de arquivo não permitido!', 'error')
                return render_template('budget/edit_budget.html', budget=budget_entry)
        
        # Atualizar campos
        budget_entry.title = title
        budget_entry.description = description if description else None
        budget_entry.status = status
        
        # Atualizar dados do cliente
        if is_external:
            budget_entry.client_id = -1
            budget_entry.external_client_id = int(external_client_id)
            budget_entry.external_client_name = client_data['name'] if client_data else None
        elif client_id:
            budget_entry.client_id = int(client_id)
            budget_entry.external_client_id = None
            budget_entry.external_client_name = None
        else:
            budget_entry.client_id = None
            budget_entry.external_client_id = None
            budget_entry.external_client_name = None
        
        try:
            db.session.commit()
            flash(f'Orçamento "{title}" atualizado com sucesso!', 'success')
            return redirect(url_for('budget.index'))
        except Exception as e:
            db.session.rollback()
            flash('Erro ao atualizar orçamento. Tente novamente.', 'error')
            return render_template('budget/edit_budget.html', budget=budget_entry)
    
    # GET - Buscar clientes para o formulário
    internal_clients = Client.query.order_by(Client.name).all()
    external_clients = fetch_external_clients()
    
    return render_template('budget/edit_budget.html', 
                         budget=budget_entry,
                         internal_clients=internal_clients,
                         external_clients=external_clients)

@budget.route('/delete/<int:budget_id>', methods=['POST'])
@login_required
def delete_budget(budget_id):
    """Remove um orçamento"""
    budget_entry = Budget.query.get_or_404(budget_id)
    title = budget_entry.title
    
    try:
        # Remover arquivo se existir
        if budget_entry.file_path and os.path.exists(budget_entry.file_path):
            try:
                os.remove(budget_entry.file_path)
                print(f"DEBUG: Arquivo removido: {budget_entry.file_path}")
            except Exception as e:
                print(f"DEBUG: Erro ao remover arquivo: {e}")
        
        db.session.delete(budget_entry)
        db.session.commit()
        flash(f'Orçamento "{title}" removido com sucesso!', 'success')
    except Exception as e:
        db.session.rollback()
        flash('Erro ao remover orçamento. Tente novamente.', 'error')
    
    return redirect(url_for('budget.index'))

@budget.route('/download/<int:budget_id>')
@login_required
def download_file(budget_id):
    """Download do arquivo anexado"""
    budget_entry = Budget.query.get_or_404(budget_id)
    
    if not budget_entry.has_file():
        flash('Nenhum arquivo encontrado para este orçamento!', 'error')
        return redirect(url_for('budget.index'))
    
    if not os.path.exists(budget_entry.file_path):
        flash('Arquivo não encontrado no servidor!', 'error')
        return redirect(url_for('budget.index'))
    
    try:
        return send_file(
            budget_entry.file_path,
            as_attachment=True,
            download_name=budget_entry.original_filename,
            mimetype=budget_entry.file_type
        )
    except Exception as e:
        print(f"DEBUG: Erro ao fazer download: {e}")
        flash('Erro ao fazer download do arquivo!', 'error')
        return redirect(url_for('budget.index'))

@budget.route('/view/<int:budget_id>')
@login_required
def view_budget(budget_id):
    """Visualiza detalhes de um orçamento"""
    budget_entry = Budget.query.get_or_404(budget_id)
    
    return render_template('budget/view_budget.html', budget=budget_entry)

@budget.route('/api/clients')
@login_required
def api_clients():
    """API para buscar clientes (usado em AJAX)"""
    try:
        internal_clients = Client.query.order_by(Client.name).all()
        external_clients = fetch_external_clients()
        
        clients = []
        
        # Adicionar clientes internos
        for client in internal_clients:
            clients.append({
                'id': client.id,
                'name': client.name,
                'type': 'internal'
            })
        
        # Adicionar clientes externos
        for client in external_clients:
            clients.append({
                'id': client['id'],
                'name': client['name'],
                'type': 'external'
            })
        
        return jsonify({
            'success': True,
            'clients': clients
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================
# Builder de orçamentos
# ============================================================

@budget.route('/builder')
@budget.route('/builder/<int:budget_id>')
@login_required
def builder(budget_id=None):
    """Tela do builder de orçamentos (criar/editar)"""
    budget_entry = Budget.query.get_or_404(budget_id) if budget_id else None
    themes = BudgetTheme.query.order_by(BudgetTheme.name.asc()).all()
    
    budget_data = None
    if budget_entry:
        has_client = bool(budget_entry.external_client_id) or (
            budget_entry.client_id and budget_entry.client_id != -1
        )
        budget_data = {
            'id': budget_entry.id,
            'title': budget_entry.title,
            'description': budget_entry.description or '',
            'status': budget_entry.status,
            'client_id': budget_entry.client_id if budget_entry.client_id and budget_entry.client_id != -1 else None,
            'external_client_id': budget_entry.external_client_id,
            'client_name': budget_entry.get_client_name() if has_client else None,
            'valid_until': budget_entry.valid_until.strftime('%Y-%m-%d') if budget_entry.valid_until else '',
            'theme_id': budget_entry.theme_id or '',
            'show_logo': bool(budget_entry.show_logo),
            'discount': budget_entry.discount or 0,
            'payment_terms': budget_entry.payment_terms or '',
            'internal_notes': budget_entry.internal_notes or '',
            'public_token': budget_entry.public_token,
            'updated_at': _serialize_dt(budget_entry.updated_at),
            'items': [item.to_dict() for item in budget_entry.items],
        }
    
    return render_template('budget/builder.html',
                         budget=budget_entry,
                         budget_data=budget_data,
                         themes=themes,
                         has_logo=bool(get_budget_logo_path()))


@budget.route('/builder/<int:budget_id>/editores', methods=['GET'])
@login_required
def builder_editors(budget_id):
    """Retorna quem está editando o orçamento agora (presença Co-op)."""
    Budget.query.get_or_404(budget_id)
    from .budget_socketio import get_budget_editors
    editors = get_budget_editors(budget_id)
    return jsonify({
        'success': True,
        'budget_id': budget_id,
        'editors': editors,
    })


@budget.route('/presenca', methods=['GET'])
@login_required
def presence_snapshot():
    """Snapshot de presença de todos os orçamentos (lista)."""
    from .budget_socketio import get_presence_snapshot
    return jsonify({
        'success': True,
        'presence': get_presence_snapshot(),
    })


@budget.route('/builder/<int:budget_id>/presenca', methods=['POST'])
@login_required
def builder_presence(budget_id):
    """Heartbeat HTTP de presença no builder (funciona sem WebSocket)."""
    Budget.query.get_or_404(budget_id)
    from .budget_socketio import http_leave_presence, http_touch_presence

    data = request.get_json(silent=True) or {}
    action = (data.get('action') or 'ping').strip().lower()
    tab_id = (data.get('tab_id') or '').strip() or None
    user_name = current_user.name or f'Usuário {current_user.id}'

    if action in ('leave', 'exit', 'sair'):
        editors = http_leave_presence(budget_id, current_user.id)
        return jsonify({'success': True, 'budget_id': budget_id, 'editors': editors})

    editors = http_touch_presence(
        budget_id,
        current_user.id,
        user_name,
        tab_id=tab_id,
        awareness=data.get('awareness'),
        clear_awareness=bool(data.get('clear_awareness')),
    )
    return jsonify({
        'success': True,
        'budget_id': budget_id,
        'editors': editors,
        'me': {'id': current_user.id, 'name': user_name},
    })


@budget.route('/builder/salvar', methods=['POST'])
@budget.route('/builder/<int:budget_id>/salvar', methods=['POST'])
@login_required
def save_builder(budget_id=None):
    """Salva o orçamento do builder (dados + itens) via JSON"""
    data = request.get_json(silent=True) or {}
    
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'Título é obrigatório.'}), 400
    
    # Verificar título duplicado
    existing_query = Budget.query.filter(Budget.title == title)
    if budget_id:
        existing_query = existing_query.filter(Budget.id != budget_id)
    if existing_query.first():
        return jsonify({'success': False, 'error': f'Já existe outro orçamento com o título "{title}".'}), 400
    
    try:
        if budget_id:
            budget_entry = Budget.query.get_or_404(budget_id)
            expected = _parse_iso_dt(data.get('expected_updated_at'))
            current_updated = budget_entry.updated_at
            if expected and current_updated:
                current_cmp = current_updated.replace(microsecond=0)
                if current_cmp.tzinfo is not None:
                    current_cmp = current_cmp.replace(tzinfo=None)
                if current_cmp > expected:
                    return jsonify({
                        'success': False,
                        'conflict': True,
                        'error': 'Este orçamento foi salvo por outro usuário enquanto você editava. Recarregue a página para ver a versão mais recente.',
                        'updated_at': _serialize_dt(budget_entry.updated_at),
                    }), 409
        else:
            budget_entry = Budget(title=title, created_by_id=current_user.id)
            db.session.add(budget_entry)
        
        budget_entry.title = title
        budget_entry.description = sanitize_rich_html(data.get('description')) or None
        
        status = (data.get('status') or 'draft').strip()
        if status in ('draft', 'sent', 'approved', 'rejected'):
            budget_entry.status = status
        
        # Cliente (interno, externo ou nenhum)
        external_client_id = data.get('external_client_id')
        client_id = data.get('client_id')
        if external_client_id:
            budget_entry.client_id = -1
            budget_entry.external_client_id = int(external_client_id)
            budget_entry.external_client_name = (data.get('external_client_name') or '').strip() or None
        elif client_id:
            budget_entry.client_id = int(client_id)
            budget_entry.external_client_id = None
            budget_entry.external_client_name = None
        else:
            budget_entry.client_id = None
            budget_entry.external_client_id = None
            budget_entry.external_client_name = None
        
        # Campos do builder
        budget_entry.valid_until = _parse_date(data.get('valid_until'))
        theme_id = data.get('theme_id')
        budget_entry.theme_id = int(theme_id) if theme_id else None
        budget_entry.show_logo = bool(data.get('show_logo', True))
        try:
            budget_entry.discount = max(float(data.get('discount') or 0), 0.0)
        except (TypeError, ValueError):
            budget_entry.discount = 0.0
        budget_entry.payment_terms = sanitize_rich_html(data.get('payment_terms')) or None
        budget_entry.internal_notes = sanitize_rich_html(data.get('internal_notes')) or None
        
        # Itens: substituir todos
        budget_entry.items = []
        for index, item in enumerate(data.get('items') or []):
            description = sanitize_rich_html(item.get('description'))
            if not rich_text_has_content(description):
                continue
            try:
                quantity = max(float(item.get('quantity') or 1), 0.0)
            except (TypeError, ValueError):
                quantity = 1.0
            try:
                unit_price = max(float(item.get('unit_price') or 0), 0.0)
            except (TypeError, ValueError):
                unit_price = 0.0

            item_type = (item.get('item_type') or 'manual').strip()
            if item_type not in ('manual', 'product', 'service'):
                item_type = 'manual'

            product_id = item.get('product_id')
            service_id = item.get('service_id')
            try:
                product_id = int(product_id) if product_id else None
            except (TypeError, ValueError):
                product_id = None
            try:
                service_id = int(service_id) if service_id else None
            except (TypeError, ValueError):
                service_id = None

            codigo = (item.get('codigo') or '').strip() or None
            unit_of_measure = (item.get('unit_of_measure') or '').strip() or None
            observations = sanitize_rich_html(item.get('observations')) or None

            is_recurring = bool(item.get('is_recurring'))
            recurrence_period = (item.get('recurrence_period') or '').strip() or None
            if is_recurring:
                if recurrence_period not in ('monthly', 'quarterly', 'yearly'):
                    recurrence_period = 'monthly'
            else:
                recurrence_period = None

            budget_entry.items.append(BudgetItem(
                item_type=item_type,
                product_id=product_id if item_type == 'product' else None,
                service_id=service_id if item_type == 'service' else None,
                codigo=codigo[:50] if codigo else None,
                description=description,
                quantity=quantity,
                unit_price=unit_price,
                unit_of_measure=unit_of_measure[:20] if unit_of_measure else None,
                observations=observations,
                sort_order=index,
                is_recurring=is_recurring,
                recurrence_period=recurrence_period,
            ))
        
        db.session.commit()
        return jsonify({
            'success': True,
            'budget_id': budget_entry.id,
            'updated_at': _serialize_dt(budget_entry.updated_at),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Erro ao salvar orçamento: {str(e)}'}), 500


@budget.route('/builder/testar-ia', methods=['GET', 'POST'])
@login_required
def test_builder_ai():
    """Testa chave, pacote e conectividade com o Gemini."""
    from ..services.budget_ai import test_gemini_connection

    try:
        result = test_gemini_connection()
        status = 200 if result.get('ok') else 503
        return jsonify({'success': bool(result.get('ok')), **result}), status
    except Exception as e:
        current_app.logger.exception('Erro ao testar conexão Gemini')
        return jsonify({
            'success': False,
            'ok': False,
            'error': f'Erro inesperado no teste: {e}',
        }), 500


@budget.route('/builder/gerar-ia', methods=['POST'])
@login_required
def generate_builder_ai():
    """Gera rascunho de orçamento com Gemini a partir de uma descrição."""
    from ..services.budget_ai import (
        BudgetAIConfigError,
        BudgetAIGenerationError,
        generate_budget_draft,
    )

    data = request.get_json(silent=True) or {}
    prompt = (data.get('prompt') or '').strip()
    client_name = (data.get('client_name') or '').strip() or None

    if len(prompt) < 15:
        return jsonify({
            'success': False,
            'error': 'Descreva o orçamento com pelo menos 15 caracteres.',
        }), 400

    try:
        draft = generate_budget_draft(prompt, client_name=client_name)
        return jsonify({'success': True, 'data': draft})
    except BudgetAIConfigError as e:
        return jsonify({'success': False, 'error': str(e)}), 503
    except BudgetAIGenerationError as e:
        return jsonify({'success': False, 'error': str(e)}), 502
    except Exception as e:
        current_app.logger.exception('Erro inesperado ao gerar orçamento com IA')
        return jsonify({
            'success': False,
            'error': f'Erro inesperado ao gerar orçamento: {e}',
        }), 500


@budget.route('/<int:budget_id>/pdf')
@login_required
def export_pdf(budget_id):
    """Exporta o orçamento em PDF"""
    budget_entry = Budget.query.get_or_404(budget_id)
    return _send_budget_pdf(budget_entry)


def _send_budget_pdf(budget_entry):
    from .budget_generator import generate_budget_pdf
    
    logo_path = get_budget_logo_path() if budget_entry.show_logo else None
    pdf_buffer = generate_budget_pdf(budget_entry, logo_path=logo_path)
    
    safe_title = secure_filename(budget_entry.title) or f'orcamento-{budget_entry.id}'
    return send_file(
        pdf_buffer,
        as_attachment=True,
        download_name=f'{safe_title}.pdf',
        mimetype='application/pdf'
    )


@budget.route('/<int:budget_id>/compartilhar', methods=['POST'])
@login_required
def share_budget(budget_id):
    """Gera ou revoga o link público do orçamento"""
    budget_entry = Budget.query.get_or_404(budget_id)
    action = (request.get_json(silent=True) or {}).get('action', 'generate')
    
    try:
        if action == 'revoke':
            budget_entry.public_token = None
            db.session.commit()
            return jsonify({'success': True, 'public_url': None})
        
        if not budget_entry.public_token:
            budget_entry.public_token = secrets.token_urlsafe(32)
            if budget_entry.status == 'draft':
                budget_entry.status = 'sent'
            db.session.commit()
        
        public_url = url_for('budget.public_budget', token=budget_entry.public_token, _external=True)
        return jsonify({'success': True, 'public_url': public_url})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# Configurações: logo e temas de cores
# ============================================================

@budget.route('/configuracoes')
@login_required
def settings():
    """Configurações do builder: logo e temas de cores"""
    if not current_user.has_role('admin'):
        flash('Apenas administradores podem acessar as configurações de orçamentos.', 'error')
        return redirect(url_for('budget.index'))
    
    themes = BudgetTheme.query.order_by(BudgetTheme.name.asc()).all()
    return render_template('budget/settings.html',
                         themes=themes,
                         has_logo=bool(get_budget_logo_path()))


@budget.route('/configuracoes/logo', methods=['POST'])
@login_required
def upload_logo():
    """Upload ou remoção do logo dos orçamentos"""
    if not current_user.has_role('admin'):
        flash('Apenas administradores podem alterar o logo.', 'error')
        return redirect(url_for('budget.index'))
    
    if request.form.get('remove') == '1':
        old_path = SystemConfig.get('budget_logo_path')
        if old_path and os.path.exists(old_path):
            try:
                os.remove(old_path)
            except OSError:
                pass
        SystemConfig.set('budget_logo_path', '', description='Logo dos orçamentos', category='budget')
        db.session.commit()
        flash('Logo removido com sucesso!', 'success')
        return redirect(url_for('budget.settings'))
    
    file = request.files.get('logo')
    if not file or not file.filename:
        flash('Selecione uma imagem para o logo.', 'error')
        return redirect(url_for('budget.settings'))
    
    file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if file_ext not in LOGO_EXTENSIONS:
        flash('Formato inválido. Use PNG ou JPG.', 'error')
        return redirect(url_for('budget.settings'))
    
    # Remover logo anterior
    old_path = SystemConfig.get('budget_logo_path')
    if old_path and os.path.exists(old_path):
        try:
            os.remove(old_path)
        except OSError:
            pass
    
    logo_path = os.path.join(get_branding_folder(), f'logo.{file_ext}')
    file.save(logo_path)
    SystemConfig.set('budget_logo_path', logo_path, description='Logo dos orçamentos', category='budget')
    db.session.commit()
    flash('Logo salvo com sucesso!', 'success')
    return redirect(url_for('budget.settings'))


@budget.route('/logo')
def serve_logo():
    """Serve o logo dos orçamentos (usado no builder e na página pública)"""
    logo_path = get_budget_logo_path()
    if not logo_path:
        return '', 404
    return send_file(logo_path)


@budget.route('/configuracoes/temas', methods=['POST'])
@login_required
def save_theme():
    """Cria ou atualiza um tema de cores"""
    if not current_user.has_role('admin'):
        flash('Apenas administradores podem gerenciar temas.', 'error')
        return redirect(url_for('budget.index'))
    
    name = (request.form.get('name') or '').strip()
    if not name:
        flash('Nome do tema é obrigatório.', 'error')
        return redirect(url_for('budget.settings'))
    
    theme_id = request.form.get('theme_id', type=int)
    theme = BudgetTheme.query.get(theme_id) if theme_id else None
    
    duplicate = BudgetTheme.query.filter(BudgetTheme.name == name)
    if theme:
        duplicate = duplicate.filter(BudgetTheme.id != theme.id)
    if duplicate.first():
        flash(f'Já existe um tema chamado "{name}".', 'error')
        return redirect(url_for('budget.settings'))
    
    try:
        if not theme:
            theme = BudgetTheme(name=name)
            db.session.add(theme)
            db.session.flush()

        theme.name = name
        theme.primary_color = _normalize_theme_color(request.form.get('primary_color'), '#2563eb')
        theme.accent_color = _normalize_theme_color(request.form.get('accent_color'), '#0ea5e9')
        theme.text_color = _normalize_theme_color(request.form.get('text_color'), '#1e293b')
        theme.title_color = _normalize_theme_color(request.form.get('title_color'), '#ffffff')

        if request.form.get('is_default') == 'on':
            BudgetTheme.query.filter(BudgetTheme.id != theme.id).update(
                {'is_default': False},
                synchronize_session=False,
            )
            theme.is_default = True
        else:
            theme.is_default = False

        db.session.commit()
        flash(f'Tema "{name}" salvo com sucesso!', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Erro ao salvar tema: {str(e)}', 'error')
    
    return redirect(url_for('budget.settings'))


@budget.route('/configuracoes/temas/<int:theme_id>/excluir', methods=['POST'])
@login_required
def delete_theme(theme_id):
    """Exclui um tema de cores"""
    if not current_user.has_role('admin'):
        flash('Apenas administradores podem gerenciar temas.', 'error')
        return redirect(url_for('budget.index'))
    
    theme = BudgetTheme.query.get_or_404(theme_id)
    try:
        Budget.query.filter_by(theme_id=theme.id).update({'theme_id': None})
        db.session.delete(theme)
        db.session.commit()
        flash(f'Tema "{theme.name}" excluído com sucesso!', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Erro ao excluir tema: {str(e)}', 'error')
    
    return redirect(url_for('budget.settings'))


# ============================================================
# Página pública (via token, sem login)
# ============================================================

def _get_public_budget(token):
    return Budget.query.filter_by(public_token=token).first_or_404()


def _save_budget_signature_file(signature_data: str, budget_id: int):
	"""Salva assinatura do cliente como PNG e retorna caminho relativo."""
	try:
		project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
		signatures_dir = os.path.join(project_root, 'uploads', 'budgets', 'signatures')
		os.makedirs(signatures_dir, exist_ok=True)

		timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
		unique_id = str(uuid.uuid4())[:8]
		filename = f'signature_budget_{budget_id}_{timestamp}_{unique_id}.png'
		file_path = os.path.join(signatures_dir, filename)

		raw = signature_data
		if raw.startswith('data:image'):
			raw = raw.split(',', 1)[1]
		signature_bytes = base64.b64decode(raw)

		try:
			from PIL import Image
			import io
			original_img = Image.open(io.BytesIO(signature_bytes)).convert('RGBA')
			background = Image.new('RGB', original_img.size, (255, 255, 255))
			background.paste(original_img, mask=original_img.split()[3])
			background.save(file_path, 'PNG')
		except Exception:
			with open(file_path, 'wb') as f:
				f.write(signature_bytes)

		return os.path.join('uploads', 'budgets', 'signatures', filename).replace('\\', '/')
	except Exception:
		return None


def _budget_signature_abs_path(relative_path: str):
	if not relative_path:
		return None
	project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
	abs_path = os.path.join(project_root, relative_path.replace('/', os.sep))
	return abs_path if os.path.exists(abs_path) else None


@budget.route('/publico/<token>')
def public_budget(token):
    """Página pública do orçamento"""
    budget_entry = _get_public_budget(token)
    return render_template('public/budget.html',
                         budget=budget_entry,
                         colors=budget_entry.get_theme_colors(),
                         has_logo=bool(get_budget_logo_path()) and budget_entry.show_logo)


@budget.route('/publico/<token>/aprovar', methods=['GET', 'POST'])
def public_approve(token):
	"""Tela de assinatura para aprovação do orçamento (mobile-friendly)."""
	budget_entry = _get_public_budget(token)

	if budget_entry.status in ('approved', 'rejected'):
		flash('Este orçamento já foi respondido.', 'warning')
		return redirect(url_for('budget.public_budget', token=token))

	if budget_entry.is_expired:
		flash('Este orçamento está vencido e não pode mais ser aprovado.', 'error')
		return redirect(url_for('budget.public_budget', token=token))

	if request.method == 'GET':
		return render_template(
			'public/budget_sign.html',
			budget=budget_entry,
			colors=budget_entry.get_theme_colors(),
			has_logo=bool(get_budget_logo_path()) and budget_entry.show_logo,
		)

	signer_name = (request.form.get('signer_name') or '').strip()
	signature_data = (request.form.get('signature_data') or '').strip()

	if not signer_name:
		flash('Informe seu nome completo para assinar.', 'error')
		return redirect(url_for('budget.public_approve', token=token))

	if not signature_data or not signature_data.startswith('data:image'):
		flash('Desenhe sua assinatura no campo indicado.', 'error')
		return redirect(url_for('budget.public_approve', token=token))

	try:
		from ..timezone_utils import get_brasilia_now
		signature_path = _save_budget_signature_file(signature_data, budget_entry.id)
		budget_entry.status = 'approved'
		budget_entry.signer_name = signer_name[:200]
		budget_entry.signature_data = signature_data
		budget_entry.signature_file_path = signature_path
		budget_entry.signature_timestamp = get_brasilia_now()
		budget_entry.responded_at = get_brasilia_now()
		db.session.commit()
		flash('Orçamento aprovado e assinado com sucesso! Obrigado.', 'success')
	except Exception:
		db.session.rollback()
		flash('Erro ao registrar a aprovação. Tente novamente.', 'error')

	return redirect(url_for('budget.public_budget', token=token))


@budget.route('/publico/<token>/responder', methods=['POST'])
def public_respond(token):
    """Cliente recusa o orçamento pelo link público"""
    budget_entry = _get_public_budget(token)
    
    if budget_entry.status in ('approved', 'rejected'):
        flash('Este orçamento já foi respondido.', 'warning')
        return redirect(url_for('budget.public_budget', token=token))
    
    if budget_entry.is_expired:
        flash('Este orçamento está vencido e não pode mais ser respondido.', 'error')
        return redirect(url_for('budget.public_budget', token=token))
    
    response = request.form.get('response')
    if response != 'reject':
        flash('Resposta inválida.', 'error')
        return redirect(url_for('budget.public_budget', token=token))
    
    try:
        from ..timezone_utils import get_brasilia_now
        budget_entry.status = 'rejected'
        budget_entry.responded_at = get_brasilia_now()
        db.session.commit()
        flash('Orçamento recusado. Agradecemos o retorno.', 'info')
    except Exception:
        db.session.rollback()
        flash('Erro ao registrar a resposta. Tente novamente.', 'error')
    
    return redirect(url_for('budget.public_budget', token=token))


@budget.route('/publico/<token>/assinatura')
def public_signature_image(token):
	"""Exibe a imagem da assinatura do cliente (página pública)."""
	budget_entry = _get_public_budget(token)
	if budget_entry.status != 'approved' or not budget_entry.signature_file_path:
		return '', 404
	abs_path = _budget_signature_abs_path(budget_entry.signature_file_path)
	if not abs_path:
		return '', 404
	return send_file(abs_path, mimetype='image/png')


@budget.route('/<int:budget_id>/assinatura')
@login_required
def budget_signature_image(budget_id):
	"""Exibe assinatura do cliente para usuários internos."""
	budget_entry = Budget.query.get_or_404(budget_id)
	if not budget_entry.signature_file_path:
		return '', 404
	abs_path = _budget_signature_abs_path(budget_entry.signature_file_path)
	if not abs_path:
		return '', 404
	return send_file(abs_path, mimetype='image/png')


@budget.route('/publico/<token>/pdf')
def public_pdf(token):
    """Download público do PDF do orçamento"""
    budget_entry = _get_public_budget(token)
    return _send_budget_pdf(budget_entry)
