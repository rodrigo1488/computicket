from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import base64
import os
from .. import db
from ..models import Client, PasswordVault
from ..external_pg import fetch_external_clients

# Importação opcional da criptografia
try:
    from cryptography.fernet import Fernet
    CRYPTOGRAPHY_AVAILABLE = True
    print("DEBUG: Biblioteca cryptography importada com sucesso")
except ImportError as e:
    CRYPTOGRAPHY_AVAILABLE = False
    print(f"AVISO: Biblioteca cryptography não encontrada: {e}")
    print("AVISO: Senhas não serão criptografadas.")

password_vault = Blueprint('password_vault', __name__)

@password_vault.route('/test-reveal/<int:password_id>')
@login_required
def test_reveal_password(password_id):
    """Rota de teste para verificar se a funcionalidade de reveal está funcionando"""
    print(f"DEBUG: Rota de teste chamada para ID: {password_id}")
    
    try:
        # Verificar se a senha existe
        password_entry = PasswordVault.query.get(password_id)
        if not password_entry:
            return jsonify({
                'success': False,
                'error': f'Senha ID {password_id} não encontrada no banco de dados'
            }), 404
        
        print(f"DEBUG: Senha encontrada - Máquina: {password_entry.machine_name}")
        print(f"DEBUG: Senha criptografada (primeiros 50 chars): {password_entry.password[:50]}...")
        
        # Tentar descriptografar
        decrypted_password = decrypt_password(password_entry.password)
        
        return jsonify({
            'success': True,
            'password_id': password_id,
            'machine_name': password_entry.machine_name,
            'password': decrypted_password,
            'message': 'Teste bem-sucedido!'
        })
        
    except Exception as e:
        print(f"DEBUG: Erro na rota de teste: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Erro no teste: {str(e)}',
            'traceback': traceback.format_exc()
        }), 500

@password_vault.route('/test')
@login_required
def test_route():
    """Rota de teste simples"""
    return jsonify({
        'success': True,
        'message': 'Rota de teste funcionando!',
        'blueprint': 'password_vault'
    })

@password_vault.route('/health')
def health_check():
    """Rota de health check sem autenticação"""
    return jsonify({
        'status': 'ok',
        'blueprint': 'password_vault',
        'message': 'Blueprint está funcionando!'
    })

@password_vault.route('/test-crypto')
@login_required
def test_crypto():
    """Rota para testar criptografia e descriptografia"""
    try:
        test_password = "senha_teste_123"
        print(f"DEBUG: Testando criptografia com senha: {test_password}")
        
        # Testar criptografia
        encrypted = encrypt_password(test_password)
        print(f"DEBUG: Senha criptografada: {encrypted[:50]}...")
        
        # Testar descriptografia
        decrypted = decrypt_password(encrypted)
        print(f"DEBUG: Senha descriptografada: {decrypted}")
        
        success = (test_password == decrypted)
        
        return jsonify({
            'success': success,
            'original_password': test_password,
            'encrypted_password': encrypted,
            'decrypted_password': decrypted,
            'cryptography_available': CRYPTOGRAPHY_AVAILABLE,
            'message': 'Teste de criptografia bem-sucedido!' if success else 'Falha no teste de criptografia!'
        })
        
    except Exception as e:
        print(f"DEBUG: Erro no teste de criptografia: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Erro no teste: {str(e)}',
            'cryptography_available': CRYPTOGRAPHY_AVAILABLE
        }), 500

@password_vault.route('/test-modal')
@login_required
def test_modal():
    """Rota para testar o comportamento do modal com diferentes tipos de senha"""
    try:
        # Buscar uma senha real do banco para teste
        password_entry = PasswordVault.query.first()
        
        if not password_entry:
            return jsonify({
                'success': False,
                'error': 'Nenhuma senha encontrada no banco para teste'
            }), 404
        
        # Testar se consegue descriptografar
        try:
            decrypted = decrypt_password(password_entry.password)
            return jsonify({
                'success': True,
                'test_type': 'descriptografia_sucesso',
                'password_id': password_entry.id,
                'machine_name': password_entry.machine_name,
                'password': decrypted,
                'is_encrypted': False,
                'message': 'Senha descriptografada com sucesso - modal deve funcionar normalmente'
            })
        except Exception as decrypt_error:
            # Retornar como criptografada
            return jsonify({
                'success': True,
                'test_type': 'descriptografia_falha',
                'password_id': password_entry.id,
                'machine_name': password_entry.machine_name,
                'password': password_entry.password,
                'is_encrypted': True,
                'warning': f'Não foi possível descriptografar: {str(decrypt_error)}',
                'message': 'Senha criptografada - modal deve mostrar aviso'
            })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Erro no teste do modal: {str(e)}'
        }), 500

@password_vault.route('/debug-passwords')
@login_required
def debug_passwords():
    """Rota para debug - listar todas as senhas"""
    try:
        passwords = PasswordVault.query.all()
        password_list = []
        
        for p in passwords:
            password_list.append({
                'id': p.id,
                'machine_name': p.machine_name,
                'client_id': p.client_id,
                'external_client_id': p.external_client_id,
                'password_length': len(p.password) if p.password else 0,
                'created_at': p.created_at.isoformat() if p.created_at else None
            })
        
        return jsonify({
            'success': True,
            'total_passwords': len(passwords),
            'passwords': password_list
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Chave de criptografia (em produção, deve ser armazenada de forma segura)
def get_encryption_key():
    """Gera ou recupera a chave de criptografia"""
    if not CRYPTOGRAPHY_AVAILABLE:
        return None
    
    key = os.environ.get('PASSWORD_VAULT_KEY')
    
    if not key:
        # Chave fixa para desenvolvimento - em produção deve ser configurada via variável de ambiente
        # Esta chave deve ser a mesma sempre para que as senhas possam ser descriptografadas
        key = "password_vault_key_2024_development_only_change_in_production"
        os.environ['PASSWORD_VAULT_KEY'] = key
    
    # Garantir que a chave está no formato correto para Fernet
    if isinstance(key, str):
        # Fernet precisa de uma chave de 32 bytes codificada em base64
        import hashlib
        key_bytes = hashlib.sha256(key.encode()).digest()
        key = base64.urlsafe_b64encode(key_bytes)
    
    return key

def encrypt_password(password):
    """Criptografa uma senha"""
    if not CRYPTOGRAPHY_AVAILABLE:
        # Fallback: usar base64 (não é seguro, mas funciona para teste)
        return base64.b64encode(password.encode()).decode()
    
    try:
        key = get_encryption_key()
        f = Fernet(key)
        return f.encrypt(password.encode()).decode()
    except Exception as e:
        print(f"Erro na criptografia Fernet: {e}")
        # Fallback para base64
        return base64.b64encode(password.encode()).decode()

def decrypt_password(encrypted_password):
    """Descriptografa uma senha"""
    print(f"DEBUG: Iniciando descriptografia para senha de {len(encrypted_password)} caracteres")
    
    if not CRYPTOGRAPHY_AVAILABLE:
        print("DEBUG: Cryptography não disponível, usando base64")
        # Fallback: usar base64
        try:
            result = base64.b64decode(encrypted_password.encode()).decode()
            print("DEBUG: Descriptografia base64 bem-sucedida")
            return result
        except Exception as e:
            print(f"DEBUG: Erro na descriptografia base64: {e}")
            return encrypted_password  # Retorna como está se não conseguir decodificar
    
    try:
        print("DEBUG: Tentando descriptografia com Fernet")
        key = get_encryption_key()
        f = Fernet(key)
        
        # Tentar descriptografar
        if isinstance(encrypted_password, str):
            encrypted_bytes = encrypted_password.encode()
        else:
            encrypted_bytes = encrypted_password
            
        decrypted_bytes = f.decrypt(encrypted_bytes)
        result = decrypted_bytes.decode()
        print("DEBUG: Descriptografia Fernet bem-sucedida")
        return result
        
    except Exception as e:
        print(f"DEBUG: Erro na descriptografia Fernet: {e}")
        print(f"DEBUG: Tipo do erro: {type(e).__name__}")
        
        # Tentar fallback com base64 apenas se a senha parece ser base64
        try:
            print("DEBUG: Tentando fallback com base64")
            result = base64.b64decode(encrypted_password.encode()).decode()
            print("DEBUG: Fallback base64 bem-sucedido")
            return result
        except Exception as e2:
            print(f"DEBUG: Erro no fallback base64: {e2}")
            # Re-raise o erro original com mais contexto
            raise Exception(f"Falha na descriptografia: Fernet error: {e}, Base64 error: {e2}")

@password_vault.route('/')
@login_required
def index():
    """Lista todos os clientes com acesso ao cofre de senhas com paginação"""
    try:
        # Parâmetros de paginação
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 12, type=int)  # 12 para grid 3x4
        
        # Limitar per_page entre 6 e 48
        per_page = max(6, min(48, per_page))
        
        # Obter termo de busca e filtro
        search_term = (request.args.get('q') or '').strip()
        filter_with_passwords = request.args.get('with_passwords', 'false').lower() == 'true'
        print(f"DEBUG: Termo de busca: '{search_term}'")
        print(f"DEBUG: Filtro apenas com senhas: {filter_with_passwords}")
        
        # Buscar clientes internos
        internal_query = Client.query
        if search_term:
            search_pattern = f"%{search_term}%"
            internal_query = internal_query.filter(
                (Client.name.ilike(search_pattern)) |
                (Client.phone.ilike(search_pattern)) |
                (Client.document.ilike(search_pattern))
            )
        internal_clients = internal_query.order_by(Client.name).all()
        print(f"DEBUG: Encontrados {len(internal_clients)} clientes internos (filtrados)")
        
        # Buscar clientes externos
        external_clients = fetch_external_clients()
        if search_term:
            # Filtrar clientes externos localmente
            search_lower = search_term.lower()
            external_clients = [
                client for client in external_clients
                if (search_lower in (client.get('name', '').lower())) or
                   (search_lower in (client.get('phone', '').lower())) or
                   (search_lower in (client.get('document', '').lower()))
            ]
        print(f"DEBUG: Encontrados {len(external_clients)} clientes externos (filtrados)")
        
        # Combinar todos os clientes
        all_clients = []
        
        # Adicionar clientes internos
        for client in internal_clients:
            all_clients.append({
                'id': client.id,
                'name': client.name,
                'phone': client.phone,
                'document': client.document,
                'contract_type': client.contract_type,
                'is_external': False
            })
        
        # Adicionar clientes externos
        for client in external_clients:
            all_clients.append({
                'id': client['id'],
                'name': client['name'],
                'phone': client.get('phone', ''),
                'document': client.get('document', ''),
                'contract_type': client.get('contract_type', ''),
                'is_external': True
            })
        
        # Ordenar por nome
        all_clients.sort(key=lambda x: x['name'])
        print(f"DEBUG: Total de clientes combinados: {len(all_clients)}")
        
        # Aplicar paginação manual (já que temos uma lista combinada)
        total_clients = len(all_clients)
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        paginated_clients = all_clients[start_index:end_index]
        
        # Criar objeto de paginação manual
        from math import ceil
        total_pages = ceil(total_clients / per_page) if total_clients > 0 else 1
        
        # Criar objeto similar ao paginate do SQLAlchemy
        class PaginationObject:
            def __init__(self, page, per_page, total, items):
                self.page = page
                self.per_page = per_page
                self.total = total
                self.pages = ceil(total / per_page) if total > 0 else 1
                self.items = items
                self.has_prev = page > 1
                self.has_next = page < self.pages
                self.prev_num = page - 1 if self.has_prev else None
                self.next_num = page + 1 if self.has_next else None
                
            def iter_pages(self, left_edge=1, right_edge=1, left_current=1, right_current=2):
                """Gera números de páginas para exibição"""
                last = self.pages
                for num in range(1, last + 1):
                    if num <= left_edge or \
                       (num > self.page - left_current - 1 and num < self.page + right_current) or \
                       num > last - right_edge:
                        yield num
        
        pagination = PaginationObject(page, per_page, total_clients, paginated_clients)
        
        # Contar quantas senhas cada cliente tem (apenas para os clientes da página atual)
        client_stats = {}
        for client in paginated_clients:
            if client['is_external']:
                count = PasswordVault.query.filter_by(external_client_id=client['id']).count()
            else:
                count = PasswordVault.query.filter_by(client_id=client['id']).count()
            client_stats[client['id']] = count
            print(f"DEBUG: Cliente {client['name']} (ID: {client['id']}, {'Externo' if client['is_external'] else 'Interno'}) tem {count} senhas")
        
        # Aplicar filtro de clientes com senhas se solicitado
        if filter_with_passwords:
            # Filtrar apenas clientes que têm senhas
            clients_with_passwords = []
            for client in paginated_clients:
                if client_stats.get(client['id'], 0) > 0:
                    clients_with_passwords.append(client)
            
            # Recalcular paginação com clientes filtrados
            total_filtered = len([c for c in all_clients if (client_stats.get(c['id'], 0) if c in paginated_clients else PasswordVault.query.filter_by(client_id=c['id']).count() if not c['is_external'] else PasswordVault.query.filter_by(external_client_id=c['id']).count()) > 0])
            
            # Aplicar paginação aos clientes filtrados
            start_index = (page - 1) * per_page
            end_index = start_index + per_page
            paginated_clients = clients_with_passwords[start_index:end_index]
            
            # Recriar objeto de paginação com dados filtrados
            total_pages = ceil(total_filtered / per_page) if total_filtered > 0 else 1
            pagination = PaginationObject(page, per_page, total_filtered, paginated_clients)
        
        return render_template('password_vault/index.html', 
                             clients=paginated_clients, 
                             client_stats=client_stats,
                             pagination=pagination,
                             search_term=search_term,
                             filter_with_passwords=filter_with_passwords)
    except Exception as e:
        print(f"DEBUG: Erro ao carregar clientes: {e}")
        import traceback
        traceback.print_exc()
        flash(f'Erro ao carregar clientes: {str(e)}', 'error')
        return render_template('password_vault/index.html', 
                             clients=[], 
                             client_stats={},
                             pagination=None,
                             search_term='',
                             filter_with_passwords=False)

@password_vault.route('/test-old')
@login_required
def test():
    """Rota de teste para verificar se o blueprint está funcionando"""
    try:
        clients = Client.query.all()
        return jsonify({
            'success': True,
            'total_clients': len(clients),
            'clients': [{'id': c.id, 'name': c.name} for c in clients]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@password_vault.route('/fix-database')
@login_required
def fix_database():
    """Rota para forçar correção da estrutura da tabela"""
    try:
        from app import db
        from sqlalchemy import text
        
        # Verificar estrutura atual da tabela
        result = db.session.execute(text("PRAGMA table_info(password_vault)"))
        columns = result.fetchall()
        
        html = "<h1>Correção da Tabela Password Vault</h1>"
        html += "<h2>Estrutura Atual:</h2><ul>"
        
        client_id_nullable = True
        for col in columns:
            col_name = col[1]
            col_type = col[2]
            not_null = col[3]
            html += f"<li>{col_name}: {col_type} {'NOT NULL' if not_null else 'NULL'}</li>"
            if col_name == 'client_id' and not_null:
                client_id_nullable = False
        
        html += "</ul>"
        
        if not client_id_nullable:
            html += "<h2>Corrigindo estrutura...</h2>"
            
            # Backup dos dados
            result = db.session.execute(text("SELECT * FROM password_vault"))
            existing_data = result.fetchall()
            html += f"<p>Dados encontrados: {len(existing_data)} registros</p>"
            
            # Dropar e recriar tabela
            db.session.execute(text("DROP TABLE password_vault"))
            html += "<p>Tabela antiga removida</p>"
            
            # Recriar com estrutura correta
            db.session.execute(text("""
                CREATE TABLE password_vault (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id INTEGER NULL,
                    external_client_id INTEGER NULL,
                    external_client_name VARCHAR(200) NULL,
                    machine_name VARCHAR(200) NOT NULL,
                    anydesk_code VARCHAR(50) NULL,
                    password VARCHAR(500) NOT NULL,
                    description TEXT NULL,
                    created_at DATETIME,
                    updated_at DATETIME,
                    created_by_id INTEGER NOT NULL,
                    FOREIGN KEY (client_id) REFERENCES client (id),
                    FOREIGN KEY (created_by_id) REFERENCES user (id)
                )
            """))
            html += "<p>Tabela recriada com estrutura correta</p>"
            
            # Restaurar dados
            for row in existing_data:
                db.session.execute(text("""
                    INSERT INTO password_vault 
                    (id, client_id, external_client_id, external_client_name, machine_name, 
                     anydesk_code, password, description, created_at, updated_at, created_by_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """), row)
            
            db.session.commit()
            html += f"<p>Dados restaurados: {len(existing_data)} registros</p>"
            html += "<p style='color: green; font-weight: bold;'>✅ Correção concluída com sucesso!</p>"
        else:
            html += "<p style='color: green; font-weight: bold;'>✅ Tabela já está com estrutura correta!</p>"
        
        return html
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"<h1>Erro na correção</h1><p>{str(e)}</p>"

@password_vault.route('/client/<int:client_id>')
@login_required
def client_passwords(client_id):
    """Lista todas as senhas de um cliente específico com paginação"""
    # Parâmetros de paginação
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    
    # Limitar per_page entre 5 e 50
    per_page = max(5, min(50, per_page))
    
    # Verificar se é cliente interno ou externo
    client = Client.query.get(client_id)
    is_external = False
    
    if client:
        # Cliente interno
        query = PasswordVault.query.filter_by(client_id=client_id).order_by(PasswordVault.machine_name)
        client_data = {
            'id': client.id,
            'name': client.name,
            'phone': client.phone,
            'document': client.document,
            'contract_type': client.contract_type,
            'is_external': False
        }
    else:
        # Cliente externo - buscar no PostgreSQL
        external_clients = fetch_external_clients()
        client_data = None
        
        for ext_client in external_clients:
            if ext_client['id'] == client_id:
                client_data = {
                    'id': ext_client['id'],
                    'name': ext_client['name'],
                    'phone': ext_client.get('phone', ''),
                    'document': ext_client.get('document', ''),
                    'contract_type': ext_client.get('contract_type', ''),
                    'is_external': True
                }
                break
        
        if not client_data:
            flash('Cliente não encontrado!', 'error')
            return redirect(url_for('password_vault.index'))
        
        query = PasswordVault.query.filter_by(external_client_id=client_id).order_by(PasswordVault.machine_name)
        is_external = True
    
    # Aplicar paginação
    pagination = query.paginate(
        page=page, 
        per_page=per_page, 
        error_out=False
    )
    
    passwords = pagination.items
    
    return render_template('password_vault/client_passwords.html', 
                         client=client_data, 
                         passwords=passwords,
                         pagination=pagination,
                         is_external=is_external)

@password_vault.route('/client/<int:client_id>/new', methods=['GET', 'POST'])
@login_required
def new_password(client_id):
    """Adiciona uma nova senha para um cliente"""
    # Verificar se é cliente interno ou externo
    client = Client.query.get(client_id)
    is_external = False
    
    if client:
        # Cliente interno
        client_data = {
            'id': client.id,
            'name': client.name,
            'phone': client.phone,
            'document': client.document,
            'contract_type': client.contract_type,
            'is_external': False
        }
    else:
        # Cliente externo - buscar no PostgreSQL
        external_clients = fetch_external_clients()
        client_data = None
        
        for ext_client in external_clients:
            if ext_client['id'] == client_id:
                client_data = {
                    'id': ext_client['id'],
                    'name': ext_client['name'],
                    'phone': ext_client.get('phone', ''),
                    'document': ext_client.get('document', ''),
                    'contract_type': ext_client.get('contract_type', ''),
                    'is_external': True
                }
                break
        
        if not client_data:
            flash('Cliente não encontrado!', 'error')
            return redirect(url_for('password_vault.index'))
        
        is_external = True
    
    if request.method == 'POST':
        print(f"DEBUG: POST recebido para cliente {client_id}")
        print(f"DEBUG: Dados do formulário: {dict(request.form)}")
        
        machine_name = request.form.get('machine_name', '').strip()
        anydesk_code = request.form.get('anydesk_code', '').strip()
        password = request.form.get('password', '').strip()
        description = request.form.get('description', '').strip()
        
        print(f"DEBUG: machine_name='{machine_name}', password='{password[:3]}...', is_external={is_external}")
        
        if not machine_name or not password:
            flash('Nome da máquina e senha são obrigatórios!', 'error')
            return render_template('password_vault/new_password.html', client=client_data)
        
        # Validação adicional para garantir que temos dados do cliente
        if not client_data:
            flash('Dados do cliente não encontrados!', 'error')
            return redirect(url_for('password_vault.index'))
        
        # Verificar se já existe uma entrada com o mesmo nome de máquina
        if is_external:
            existing = PasswordVault.query.filter_by(
                external_client_id=client_id, 
                machine_name=machine_name
            ).first()
        else:
            existing = PasswordVault.query.filter_by(
                client_id=client_id, 
                machine_name=machine_name
            ).first()
        
        if existing:
            flash(f'Já existe uma entrada para a máquina "{machine_name}"!', 'error')
            return render_template('password_vault/new_password.html', client=client_data)
        
        # Criptografar a senha
        encrypted_password = encrypt_password(password)
        
        # Criar nova entrada
        if is_external:
            print(f"DEBUG: Criando entrada para cliente externo {client_id}")
            # Para clientes externos, usar -1 como client_id para contornar o NOT NULL
            password_entry = PasswordVault(
                client_id=-1,  # Valor especial para clientes externos
                external_client_id=client_id,
                external_client_name=client_data['name'],
                machine_name=machine_name,
                anydesk_code=anydesk_code if anydesk_code else None,
                password=encrypted_password,
                description=description if description else None,
                created_by_id=current_user.id
            )
        else:
            print(f"DEBUG: Criando entrada para cliente interno {client_id}")
            password_entry = PasswordVault(
                client_id=client_id,
                machine_name=machine_name,
                anydesk_code=anydesk_code if anydesk_code else None,
                password=encrypted_password,
                description=description if description else None,
                created_by_id=current_user.id
            )
        
        print(f"DEBUG: PasswordVault criado: {password_entry}")
        
        try:
            db.session.add(password_entry)
            db.session.commit()
            print(f"DEBUG: Senha salva com sucesso no banco de dados")
            flash(f'Senha para "{machine_name}" adicionada com sucesso!', 'success')
            return redirect(url_for('password_vault.client_passwords', client_id=client_id))
        except Exception as e:
            db.session.rollback()
            print(f"DEBUG: Erro ao salvar no banco: {e}")
            import traceback
            traceback.print_exc()
            flash('Erro ao adicionar senha. Tente novamente.', 'error')
            return render_template('password_vault/new_password.html', client=client_data)
    
    return render_template('password_vault/new_password.html', client=client_data)

@password_vault.route('/edit/<int:password_id>', methods=['GET', 'POST'])
@login_required
def edit_password(password_id):
    """Edita uma senha existente"""
    password_entry = PasswordVault.query.get_or_404(password_id)
    
    if request.method == 'POST':
        machine_name = request.form.get('machine_name', '').strip()
        anydesk_code = request.form.get('anydesk_code', '').strip()
        password = request.form.get('password', '').strip()
        description = request.form.get('description', '').strip()
        
        if not machine_name:
            flash('Nome da máquina é obrigatório!', 'error')
            # Descriptografar senha para mostrar no formulário
            try:
                decrypted_password = decrypt_password(password_entry.password)
            except:
                decrypted_password = ""
            return render_template('password_vault/edit_password.html', 
                                 password_entry=password_entry, 
                                 current_password=decrypted_password)
        
        # Verificar se já existe outra entrada com o mesmo nome de máquina
        existing = PasswordVault.query.filter(
            PasswordVault.client_id == password_entry.client_id,
            PasswordVault.machine_name == machine_name,
            PasswordVault.id != password_id
        ).first()
        
        if existing:
            flash(f'Já existe outra entrada para a máquina "{machine_name}"!', 'error')
            # Descriptografar senha para mostrar no formulário
            try:
                decrypted_password = decrypt_password(password_entry.password)
            except:
                decrypted_password = ""
            return render_template('password_vault/edit_password.html', 
                                 password_entry=password_entry, 
                                 current_password=decrypted_password)
        
        # Atualizar campos
        password_entry.machine_name = machine_name
        password_entry.anydesk_code = anydesk_code if anydesk_code else None
        password_entry.description = description if description else None
        
        # Atualizar senha apenas se fornecida
        if password:
            password_entry.password = encrypt_password(password)
        
        try:
            db.session.commit()
            flash(f'Senha para "{machine_name}" atualizada com sucesso!', 'success')
            
            # Determinar o client_id correto para o redirect
            if password_entry.external_client_id:
                # Cliente externo
                redirect_client_id = password_entry.external_client_id
            else:
                # Cliente interno
                redirect_client_id = password_entry.client_id
                
            return redirect(url_for('password_vault.client_passwords', client_id=redirect_client_id))
        except Exception as e:
            db.session.rollback()
            flash('Erro ao atualizar senha. Tente novamente.', 'error')
            # Descriptografar senha para mostrar no formulário
            try:
                decrypted_password = decrypt_password(password_entry.password)
            except:
                decrypted_password = ""
            return render_template('password_vault/edit_password.html', 
                                 password_entry=password_entry, 
                                 current_password=decrypted_password)
    
    # GET - Descriptografar senha para mostrar no formulário
    try:
        decrypted_password = decrypt_password(password_entry.password)
    except Exception as e:
        print(f"Erro ao descriptografar senha para edição: {e}")
        decrypted_password = ""
    
    # Determinar o nome do cliente
    if password_entry.external_client_id:
        # Cliente externo
        client_name = password_entry.external_client_name or "Cliente Externo"
    else:
        # Cliente interno
        client_name = password_entry.client.name if password_entry.client else "Cliente"
    
    return render_template('password_vault/edit_password.html', 
                         password_entry=password_entry, 
                         current_password=decrypted_password,
                         client_name=client_name)

@password_vault.route('/delete/<int:password_id>', methods=['POST'])
@login_required
def delete_password(password_id):
    """Remove uma senha"""
    password_entry = PasswordVault.query.get_or_404(password_id)
    machine_name = password_entry.machine_name
    
    # Determinar o client_id correto para o redirect
    if password_entry.external_client_id:
        # Cliente externo
        redirect_client_id = password_entry.external_client_id
    else:
        # Cliente interno
        redirect_client_id = password_entry.client_id
    
    try:
        db.session.delete(password_entry)
        db.session.commit()
        flash(f'Senha para "{machine_name}" removida com sucesso!', 'success')
    except Exception as e:
        db.session.rollback()
        flash('Erro ao remover senha. Tente novamente.', 'error')
    
    return redirect(url_for('password_vault.client_passwords', client_id=redirect_client_id))

@password_vault.route('/reveal/<int:password_id>')
@login_required
def reveal_password(password_id):
    """Revela uma senha descriptografada (via AJAX)"""
    print(f"DEBUG: Rota reveal chamada para ID: {password_id}")
    
    try:
        password_entry = PasswordVault.query.get(password_id)
        if not password_entry:
            print(f"DEBUG: Senha ID {password_id} não encontrada")
            return jsonify({
                'success': False,
                'error': 'Senha não encontrada'
            }), 404
        
        print(f"DEBUG: Senha encontrada - Máquina: {password_entry.machine_name}")
        print(f"DEBUG: Tentando descriptografar senha...")
        
        try:
            decrypted_password = decrypt_password(password_entry.password)
            print(f"DEBUG: Descriptografia bem-sucedida")
            return jsonify({
                'success': True,
                'password': decrypted_password,
                'is_encrypted': False
            })
        except Exception as decrypt_error:
            print(f"DEBUG: Falha na descriptografia: {str(decrypt_error)}")
            print(f"DEBUG: Retornando senha criptografada como fallback")
            
            # Retornar a senha criptografada como fallback
            return jsonify({
                'success': True,
                'password': password_entry.password,
                'is_encrypted': True,
                'warning': 'Não foi possível descriptografar a senha. Exibindo versão criptografada.'
            })
            
    except Exception as e:
        print(f"DEBUG: Erro geral ao revelar senha ID {password_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Erro ao acessar senha: {str(e)}'
        }), 500
