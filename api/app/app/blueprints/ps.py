from flask import Blueprint, render_template, send_file, jsonify, request, current_app
from flask_login import login_required, current_user
import os
import time
import hashlib
import secrets
from pathlib import Path
import mimetypes
from werkzeug.utils import secure_filename
from sqlalchemy import or_, and_, func
from ..models import ServiceOrder, Ticket, User
from .. import db
from ..external_pg import ExternalPgError, fetch_ps_financial_records
from ..timezone_utils import get_brasilia_now, brasilia_to_utc
from ..query_filters import filter_dicts

bp = Blueprint('ps', __name__)

VIRTUAL_MONTH_FOLDER = "__ps_do_mes__"
VIRTUAL_MONTH_FOLDER_LABEL = "PS do mês"

# Dicionário para armazenar tokens temporários de compartilhamento
# Em produção, use Redis ou banco de dados
share_tokens = {}


def _ps_root() -> Path:
    configured = (os.environ.get("PS_ROOT") or "").strip()
    if configured:
        return Path(configured)
    # Docker: PS_ROOT=/app/ps (volume ./ps). Local: api/app/ps.
    return Path(__file__).resolve().parent.parent.parent / "ps"


def _ps_lookup_names(*values: str | None) -> list[str]:
    """Gera nomes de arquivo candidatos (legado PS/123 → PS_123.pdf incluso)."""
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str | None) -> None:
        raw = (name or "").strip()
        if not raw or raw in seen:
            return
        seen.add(raw)
        names.append(raw)

    for value in values:
        raw = (value or "").strip()
        if not raw:
            continue
        add(raw)
        add(Path(raw).name)
        underscored = raw.replace("\\", "/").replace("/", "_")
        add(underscored)
        add(Path(underscored).name)
        if not raw.lower().endswith(".pdf"):
            add(f"{underscored}.pdf")
            add(f"{raw.replace('/', '_')}.pdf")
            add(f"{Path(raw).name}.pdf")
        # PS/TICKET-2983 → também TICKET-2983.pdf
        if "/" in raw.replace("\\", "/"):
            tail = raw.replace("\\", "/").rsplit("/", 1)[-1]
            add(f"{tail}.pdf")
            add(tail)
    return names


def find_ps_file_path(filename: str) -> Path | None:
    if not filename:
        return None
    ps_path = _ps_root()
    if not ps_path.exists():
        return None
    try:
        ps_resolved = ps_path.resolve()
    except OSError:
        return None

    for candidate in _ps_lookup_names(filename):
        literal_path = ps_path / candidate
        try:
            if (
                literal_path.exists()
                and literal_path.is_file()
                and literal_path.resolve().is_relative_to(ps_resolved)
            ):
                return literal_path
        except OSError:
            pass

        base_name = Path(candidate).name
        try:
            for path in ps_path.rglob(base_name):
                if path.is_file() and path.resolve().is_relative_to(ps_resolved):
                    return path
        except OSError:
            continue

    return None

@bp.route('/')
@login_required
def index():
    """Página principal da aba PS"""
    return render_template('ps/index.html')

@bp.route('/api/list')
@login_required
def list_files():
    """Lista PS do Unico + histórico local + PDFs órfãos em PS_ROOT."""
    warnings: list[str] = []
    financial_records: list = []
    try:
        financial_records = fetch_ps_financial_records()
    except ExternalPgError as e:
        current_app.logger.warning("PS Unico indisponível, listando local/disco: %s", e)
        warnings.append(str(e))
    except Exception as e:
        current_app.logger.exception("Falha inesperada ao listar PS no Unico")
        warnings.append(f"Erro ao consultar Unico: {e}")

    try:
        tickets = Ticket.query.filter(
            or_(
                Ticket.ps_number.isnot(None),
                Ticket.ps_printed == True,
            )
        ).all()
        orders = ServiceOrder.query.filter(
            or_(
                ServiceOrder.ps_number.isnot(None),
                ServiceOrder.ps_generated == True,
            )
        ).all()
        items = merge_ps_records(financial_records, tickets, orders)
        items = append_disk_orphan_ps(items)

        search_term = (request.args.get('search') or request.args.get('q') or '').strip().lower()
        if search_term:
            items = [
                item for item in items
                if search_term in " ".join(
                    str(item.get(key) or "").lower()
                    for key in ("ps_number", "client_name", "technician_name", "source", "description", "name")
                )
            ]

        try:
            page = max(1, int(request.args.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            per_page = min(100, max(10, int(request.args.get("per_page", 25))))
        except (TypeError, ValueError):
            per_page = 25
        items = filter_dicts(items)
        total = len(items)
        start = (page - 1) * per_page
        payload = {
            "items": items[start:start + per_page],
            "search_term": search_term,
            "total": total,
            "page": page,
            "per_page": per_page,
            "ps_root": str(_ps_root()),
        }
        if warnings:
            payload["warnings"] = warnings
        return jsonify(payload)
    except Exception as e:
        current_app.logger.exception("Erro ao listar PS")
        return jsonify({"error": f"Erro ao listar PS: {str(e)}"}), 500


def _ps_key(value):
    return str(value or "").strip().casefold()


def _iso_date(value):
    return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)


def _relative_ps_file(*candidates: str | None):
    for candidate in candidates:
        full_path = find_ps_file_path(candidate) if candidate else None
        if not full_path:
            continue
        try:
            return full_path.relative_to(_ps_root()).as_posix()
        except ValueError:
            continue
    return None


def _ticket_ps_item(ticket):
    filename = ticket.ps_file or ticket.resolved_ps_filename()
    tech = ticket.assigned_to_user.name if getattr(ticket, "assigned_to_user", None) else None
    try:
        client_name = ticket.display_client_name()
    except Exception:
        client_name = getattr(ticket, "client_name", None) or ""
    return {
        "ps_number": ticket.ps_number,
        "name": ticket.ps_number or filename or f"Ticket #{ticket.id}",
        "type": "Ticket",
        "source": "Ticket",
        "source_id": ticket.id,
        "client_name": client_name or "",
        "technician_name": tech or "",
        "value": float(ticket.total_cost or 0),
        "issued_at": _iso_date(ticket.closed_at or ticket.created_at),
        "description": ticket.title or "",
        "path": _relative_ps_file(filename, ticket.ps_number, ticket.ps_file),
    }


def _order_ps_item(order):
    return {
        "ps_number": order.ps_number,
        "name": order.ps_number or order.ps_file or f"OS #{order.codigo}",
        "type": "Ordem de serviço",
        "source": "Ordem de serviço",
        "source_id": order.id,
        "client_name": order.client_name or "",
        "technician_name": order.technician_name or "",
        "value": float(order.value or 0),
        "issued_at": _iso_date(order.completion_date),
        "description": order.service_executed or "",
        "path": _relative_ps_file(order.ps_file, order.ps_number),
    }


def merge_ps_records(financial_records, tickets, orders):
    """Une a fonte Unico ao histórico local sem duplicar a mesma PS."""
    ticket_items = []
    for ticket in tickets:
        try:
            ticket_items.append(_ticket_ps_item(ticket))
        except Exception as e:
            current_app.logger.warning("Ignorando ticket PS #%s: %s", getattr(ticket, "id", "?"), e)
    order_items = []
    for order in orders:
        try:
            order_items.append(_order_ps_item(order))
        except Exception as e:
            current_app.logger.warning("Ignorando OS PS #%s: %s", getattr(order, "id", "?"), e)
    local_items = ticket_items + order_items
    local_by_number = {
        _ps_key(item["ps_number"]): item
        for item in local_items
        if _ps_key(item["ps_number"])
    }
    merged = []
    seen = set()

    for record in financial_records:
        number = record.get("documento")
        key = _ps_key(number)
        local = local_by_number.get(key, {})
        source = local.get("source")
        if not source:
            upper = str(number or "").upper()
            source = "Ordem de serviço" if upper.startswith("PS/OS-") else (
                "Ticket" if upper.startswith("PS/TICKET-") else "PS legada"
            )
        path = local.get("path") or _relative_ps_file(number, local.get("ps_number"))
        item = {
            "id": f"unico:{record.get('id')}",
            "ps_number": number,
            "name": number,
            "type": source,
            "source": source,
            "source_id": local.get("source_id"),
            "client_name": record.get("client_name") or local.get("client_name") or "",
            "technician_name": local.get("technician_name") or "",
            "value": float(record.get("valor") or local.get("value") or 0),
            "balance": float(record.get("saldo") or 0),
            "status": record.get("status"),
            "issued_at": _iso_date(record.get("emissao") or local.get("issued_at")),
            "description": record.get("description") or local.get("description") or "",
            "path": path,
        }
        merged.append(item)
        if key:
            seen.add(key)

    # Compatibilidade: PS antigas podem existir apenas no banco Computicket,
    # sobretudo quando o identificador vinha da sequência SQL Server removida.
    for item in local_items:
        key = _ps_key(item["ps_number"])
        if key and key in seen:
            continue
        item["id"] = f"local:{item['source']}:{item['source_id']}"
        item["status"] = None
        item["balance"] = None
        merged.append(item)
        if key:
            seen.add(key)

    merged.sort(key=lambda item: item.get("issued_at") or "", reverse=True)
    return merged


def append_disk_orphan_ps(merged: list) -> list:
    """Inclui PDFs em PS_ROOT que ainda não aparecem na lista Unico/local."""
    root = _ps_root()
    if not root.exists():
        return merged

    seen_numbers = {_ps_key(item.get("ps_number")) for item in merged if item.get("ps_number")}
    seen_paths = {(item.get("path") or "").casefold() for item in merged if item.get("path")}
    orphans: list = []

    try:
        resolved_root = root.resolve()
    except OSError:
        return merged

    try:
        for path in root.rglob("*.pdf"):
            try:
                if not path.is_file():
                    continue
                rel = path.resolve().relative_to(resolved_root).as_posix()
            except (OSError, ValueError):
                continue
            if rel.casefold() in seen_paths:
                continue

            stem = path.stem
            candidates = {
                _ps_key(stem),
                _ps_key(stem.replace("_", "/")),
                _ps_key(stem.replace("_", "/", 1)),
            }
            if candidates & seen_numbers:
                continue

            ps_number = stem.replace("_", "/", 1) if stem.upper().startswith("PS_") else stem
            orphans.append({
                "id": f"file:{rel}",
                "ps_number": ps_number,
                "name": path.name,
                "type": "Arquivo",
                "source": "Arquivo",
                "source_id": None,
                "client_name": "",
                "technician_name": "",
                "value": 0,
                "balance": None,
                "status": None,
                "issued_at": None,
                "description": "",
                "path": rel,
            })
            seen_paths.add(rel.casefold())
            if _ps_key(ps_number):
                seen_numbers.add(_ps_key(ps_number))
    except OSError as e:
        current_app.logger.warning("Falha ao varrer PDFs em %s: %s", root, e)

    if orphans:
        merged = list(merged) + orphans
        merged.sort(key=lambda item: item.get("issued_at") or item.get("name") or "", reverse=True)
    return merged


def list_ps_current_month():
    """Lista PS do mês atual (pela data de finalização) como arquivos dentro de uma pasta virtual."""
    now = get_brasilia_now()
    start_brasilia = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    if start_brasilia.month == 12:
        next_month_brasilia = start_brasilia.replace(year=start_brasilia.year + 1, month=1)
    else:
        next_month_brasilia = start_brasilia.replace(month=start_brasilia.month + 1)

    start_utc = brasilia_to_utc(start_brasilia)
    end_utc = brasilia_to_utc(next_month_brasilia)

    orders = (
        ServiceOrder.query
        .filter(
            ServiceOrder.ps_generated == True,
            ServiceOrder.ps_file.isnot(None),
            ServiceOrder.completion_date >= start_utc,
            ServiceOrder.completion_date < end_utc,
        )
        .order_by(ServiceOrder.completion_date.desc())
        .all()
    )

    ps_root = _ps_root()
    items = []

    for order in orders:
        file_name = order.ps_file
        if not file_name:
            continue

        full_path = find_ps_file_path(file_name) or find_ps_file_path(order.ps_number or "")
        file_ext = Path(file_name).suffix.lower()
        mime_type, _ = mimetypes.guess_type(str(full_path) if full_path else file_name)

        size = 0
        file_exists = full_path is not None
        if file_exists:
            try:
                size = full_path.stat().st_size
            except OSError:
                size = 0

        modified = order.completion_date.timestamp() if order.completion_date else 0
        relative_path = full_path.relative_to(ps_root).as_posix() if file_exists else f"ps-do-dia/{file_name}"
        folder_name = Path(relative_path).parent.as_posix() if file_exists else "ps-do-dia"

        items.append({
            "name": file_name,
            "type": "file",
            "size": size,
            "extension": file_ext,
            "mime_type": mime_type,
            "modified": modified,
            "path": relative_path,
            "folder": folder_name
        })

    return items

def search_files_recursive(base_path, search_term):
    """Busca recursiva por arquivos e pastas"""
    items = []
    
    try:
        # Percorrer recursivamente todas as subpastas
        for item in base_path.rglob('*'):
            if item.is_file():
                # Verificar se o nome do arquivo contém o termo de busca
                if search_term in item.name.lower():
                    # Calcular caminho relativo
                    relative_path = item.relative_to(base_path)
                    
                    file_size = item.stat().st_size
                    file_ext = item.suffix.lower()
                    mime_type, _ = mimetypes.guess_type(str(item))
                    
                    items.append({
                        "name": item.name,
                        "type": "file",
                        "size": file_size,
                        "extension": file_ext,
                        "mime_type": mime_type,
                        "modified": item.stat().st_mtime,
                        "path": relative_path.as_posix(),
                        "folder": relative_path.parent.as_posix() if relative_path.parent != Path('.') else ""
                    })
            
            elif item.is_dir():
                # Verificar se o nome da pasta contém o termo de busca
                if search_term in item.name.lower():
                    # Calcular caminho relativo
                    relative_path = item.relative_to(base_path)
                    
                    items.append({
                        "name": item.name,
                        "type": "folder",
                        "path": relative_path.as_posix(),
                        "modified": item.stat().st_mtime,
                        "folder": relative_path.parent.as_posix() if relative_path.parent != Path('.') else ""
                    })
    
    except Exception as e:
        print(f"Erro na busca recursiva: {e}")
    
    # Ordenar resultados
    items.sort(key=lambda x: (
        x["type"] != "folder",  # Pastas primeiro
        -x.get("modified", 0) if x["type"] == "folder" else 0,  # Pastas por data (mais recente primeiro)
        x["name"].lower()  # Depois por nome
    ))
    
    return items

def list_current_folder(current_path, subfolder, search_term):
    """Lista arquivos e pastas da pasta atual com filtro opcional"""
    items = []
    
    for item in sorted(current_path.iterdir()):
        # Aplicar filtro de busca se fornecido
        if search_term and search_term not in item.name.lower():
            continue
            
        if item.is_file():
            # Arquivo
            file_size = item.stat().st_size
            file_ext = item.suffix.lower()
            mime_type, _ = mimetypes.guess_type(str(item))
            
            # Construir caminho relativo correto
            if subfolder:
                relative_path = f"{subfolder}/{item.name}"
            else:
                relative_path = item.name
            
            items.append({
                "name": item.name,
                "type": "file",
                "size": file_size,
                "extension": file_ext,
                "mime_type": mime_type,
                "modified": item.stat().st_mtime,
                "path": relative_path
            })
        elif item.is_dir():
            # Pasta
            # Construir caminho relativo correto
            if subfolder:
                relative_path = f"{subfolder}/{item.name}"
            else:
                relative_path = item.name
            
            items.append({
                "name": item.name,
                "type": "folder",
                "path": relative_path,
                "modified": item.stat().st_mtime
            })
    
    # Ordenar: pastas primeiro (por data de modificação - mais recente primeiro), depois arquivos
    items.sort(key=lambda x: (
        x["type"] != "folder",  # Pastas primeiro
        -x.get("modified", 0) if x["type"] == "folder" else 0,  # Pastas por data (mais recente primeiro)
        x["name"].lower()  # Depois por nome
    ))
    
    return items

@bp.route('/api/download/<path:filepath>')
@login_required
def download_file(filepath):
    """API para baixar arquivo"""
    try:
        full_path = find_ps_file_path(filepath)
        if not full_path:
            return jsonify({"error": "Arquivo não encontrado"}), 404
        
        return send_file(
            str(full_path),
            as_attachment=True,
            download_name=full_path.name
        )
        
    except Exception as e:
        return jsonify({"error": f"Erro ao baixar arquivo: {str(e)}"}), 500

@bp.route('/api/view/<path:filepath>')
@login_required
def view_file(filepath):
    """API para visualizar arquivo (especialmente PDFs)"""
    try:
        full_path = find_ps_file_path(filepath)
        if not full_path:
            return jsonify({"error": "Arquivo não encontrado"}), 404
        
        # Determinar MIME type
        mime_type, _ = mimetypes.guess_type(str(full_path))
        if not mime_type:
            mime_type = 'application/octet-stream'
        
        return send_file(
            str(full_path),
            as_attachment=False,
            mimetype=mime_type
        )
        
    except Exception as e:
        return jsonify({"error": f"Erro ao visualizar arquivo: {str(e)}"}), 500

@bp.route('/api/upload', methods=['POST'])
@login_required
def upload_files():
    """API para upload de arquivos"""
    try:
        # Verificar se usuário é admin
        if not current_user.has_role('admin'):
            return jsonify({"error": "Acesso negado"}), 403
        
        # Verificar se há arquivos
        if 'files' not in request.files:
            return jsonify({"error": "Nenhum arquivo enviado"}), 400
        
        files = request.files.getlist('files')
        if not files or all(file.filename == '' for file in files):
            return jsonify({"error": "Nenhum arquivo selecionado"}), 400
        
        # Pasta de destino
        folder = request.form.get('folder', '')
        ps_path = Path(__file__).parent.parent.parent / "ps"
        target_path = ps_path / folder if folder else ps_path
        
        # Verificar se a pasta de destino existe
        if not target_path.exists():
            target_path.mkdir(parents=True, exist_ok=True)
        
        uploaded_files = []
        errors = []
        
        for file in files:
            if file.filename:
                try:
                    # Verificar se o arquivo é seguro
                    filename = secure_filename(file.filename)
                    if not filename:
                        errors.append(f"Nome de arquivo inválido: {file.filename}")
                        continue
                    
                    # Caminho completo do arquivo
                    file_path = target_path / filename
                    
                    # Verificar se já existe
                    if file_path.exists():
                        # Adicionar timestamp para evitar conflito
                        name, ext = os.path.splitext(filename)
                        timestamp = int(time.time())
                        filename = f"{name}_{timestamp}{ext}"
                        file_path = target_path / filename
                    
                    # Salvar arquivo
                    file.save(str(file_path))
                    uploaded_files.append(filename)
                    
                except Exception as e:
                    errors.append(f"Erro ao salvar {file.filename}: {str(e)}")
        
        if uploaded_files:
            return jsonify({
                "message": f"{len(uploaded_files)} arquivo(s) enviado(s) com sucesso",
                "uploaded_files": uploaded_files,
                "errors": errors
            })
        else:
            return jsonify({"error": "Nenhum arquivo foi enviado", "errors": errors}), 400
            
    except Exception as e:
        return jsonify({"error": f"Erro interno: {str(e)}"}), 500

@bp.route('/api/delete/<path:filepath>', methods=['DELETE'])
@login_required
def delete_file(filepath):
    """API para deletar arquivo ou pasta"""
    try:
        # Verificar se usuário é admin
        if not current_user.has_role('admin'):
            return jsonify({"error": "Acesso negado"}), 403
        
        # Caminho completo do arquivo/pasta
        ps_path = Path(__file__).parent.parent.parent / "ps"
        full_path = ps_path / filepath
        
        if not full_path.exists():
            return jsonify({"error": "Arquivo/pasta não encontrado"}), 404
        
        # Verificar se está dentro da pasta PS
        if not full_path.resolve().is_relative_to(ps_path.resolve()):
            return jsonify({"error": "Acesso negado"}), 403
        
        # Deletar arquivo ou pasta
        if full_path.is_file():
            full_path.unlink()
            message = f"Arquivo '{full_path.name}' deletado com sucesso"
        elif full_path.is_dir():
            # Verificar se pasta está vazia
            if any(full_path.iterdir()):
                return jsonify({"error": "Pasta não está vazia"}), 400
            full_path.rmdir()
            message = f"Pasta '{full_path.name}' deletada com sucesso"
        else:
            return jsonify({"error": "Tipo de item não suportado"}), 400
        
        return jsonify({"message": message})
        
    except Exception as e:
        return jsonify({"error": f"Erro ao deletar: {str(e)}"}), 500

@bp.route('/api/generate-share-token', methods=['POST'])
@login_required
def generate_share_token():
    """API para gerar token seguro de compartilhamento"""
    try:
        data = request.get_json()
        filepath = data.get('filepath')
        
        if not filepath:
            return jsonify({"error": "Caminho do arquivo não fornecido"}), 400
        
        # Caminho base da pasta PS (caminho absoluto)
        ps_path = Path(__file__).parent.parent.parent / "ps"
        
        # Construir caminho completo
        full_path = ps_path / filepath
        
        # Verificar se o arquivo existe
        if not full_path.exists():
            return jsonify({"error": "Arquivo não encontrado"}), 404
        
        # Verificar se está dentro da pasta PS
        try:
            full_path.resolve().relative_to(ps_path.resolve())
        except ValueError:
            return jsonify({"error": "Acesso negado"}), 403
        
        # Gerar token seguro
        token = secrets.token_urlsafe(32)
        
        # Armazenar token com informações do arquivo
        share_tokens[token] = {
            'filepath': str(full_path),
            'filename': full_path.name,
            'created_at': time.time(),
            'user_id': current_user.id,
            'expires_at': time.time() + 3600  # Expira em 1 hora
        }
        
        return jsonify({
            "success": True, 
            "token": token,
            "expires_in": 3600
        })
        
    except Exception as e:
        return jsonify({"error": f"Erro ao gerar token: {str(e)}"}), 500

@bp.route('/api/test-share-token', methods=['GET'])
@login_required
def test_share_token():
    """Rota de teste para verificar se o blueprint está funcionando"""
    return jsonify({"message": "Blueprint PS funcionando!", "user": current_user.name})

@bp.route('/api/search-ps', methods=['GET'])
@login_required
def search_ps():
    """API para pesquisar PS por metadados"""
    try:
        # Parâmetros de pesquisa
        search_term = request.args.get('q', '').strip()
        client_name = request.args.get('client', '').strip()
        technician_name = request.args.get('technician', '').strip()
        ps_number = request.args.get('ps_number', '').strip()
        date_from = request.args.get('date_from', '').strip()
        date_to = request.args.get('date_to', '').strip()
        min_value = request.args.get('min_value', type=float)
        max_value = request.args.get('max_value', type=float)
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        # Query base para ServiceOrder com PS gerada
        query = ServiceOrder.query.filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None),
                ServiceOrder.ps_file.isnot(None)
            )
        )
        
        # Aplicar filtros
        if search_term:
            query = query.filter(
                or_(
                    ServiceOrder.codigo.ilike(f'%{search_term}%'),
                    ServiceOrder.client_name.ilike(f'%{search_term}%'),
                    ServiceOrder.technician_name.ilike(f'%{search_term}%'),
                    ServiceOrder.ps_number.ilike(f'%{search_term}%'),
                    ServiceOrder.equipment.ilike(f'%{search_term}%')
                )
            )
        
        if client_name:
            query = query.filter(ServiceOrder.client_name.ilike(f'%{client_name}%'))
        
        if technician_name:
            query = query.filter(ServiceOrder.technician_name.ilike(f'%{technician_name}%'))
        
        if ps_number:
            query = query.filter(ServiceOrder.ps_number.ilike(f'%{ps_number}%'))
        
        if date_from:
            from datetime import datetime
            try:
                date_from_dt = datetime.strptime(date_from, '%Y-%m-%d')
                query = query.filter(ServiceOrder.completion_date >= date_from_dt)
            except ValueError:
                pass
        
        if date_to:
            from datetime import datetime
            try:
                date_to_dt = datetime.strptime(date_to, '%Y-%m-%d')
                # Adicionar 23:59:59 para incluir o dia inteiro
                date_to_dt = date_to_dt.replace(hour=23, minute=59, second=59)
                query = query.filter(ServiceOrder.completion_date <= date_to_dt)
            except ValueError:
                pass
        
        if min_value is not None:
            query = query.filter(ServiceOrder.value >= min_value)
        
        if max_value is not None:
            query = query.filter(ServiceOrder.value <= max_value)
        
        # Ordenar por data de finalização (mais recente primeiro)
        query = query.order_by(ServiceOrder.completion_date.desc())
        
        # Paginação
        pagination = query.paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        # Converter resultados para formato JSON
        results = []
        for order in pagination.items:
            # Verificar se arquivo existe
            file_exists = find_ps_file_path(order.ps_file) is not None
            
            results.append({
                'id': order.id,
                'codigo': order.codigo,
                'ps_number': order.ps_number,
                'client_name': order.client_name,
                'client_document': order.client_document,
                'technician_name': order.technician_name,
                'technician_id': order.technician_id,
                'equipment': order.equipment,
                'value': float(order.value) if order.value else 0.0,
                'completion_date': order.completion_date.isoformat() if order.completion_date else None,
                'ps_file': order.ps_file,
                'file_exists': file_exists,
                'status': order.status,
                'status_text': order.status_text(),
                'has_contract': order.has_contract,
                'no_charge': order.no_charge
            })
        
        return jsonify({
            'success': True,
            'results': results,
            'pagination': {
                'page': pagination.page,
                'per_page': pagination.per_page,
                'total': pagination.total,
                'pages': pagination.pages,
                'has_prev': pagination.has_prev,
                'has_next': pagination.has_next,
                'prev_num': pagination.prev_num,
                'next_num': pagination.next_num
            },
            'filters': {
                'search_term': search_term,
                'client_name': client_name,
                'technician_name': technician_name,
                'ps_number': ps_number,
                'date_from': date_from,
                'date_to': date_to,
                'min_value': min_value,
                'max_value': max_value
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Erro ao pesquisar PS: {str(e)}'
        }), 500

@bp.route('/api/client-ps-history/<int:client_id>')
@login_required
def get_client_ps_history(client_id):
    """API para obter histórico de PS de um cliente específico"""
    try:
        # Buscar todas as PS do cliente
        ps_list = ServiceOrder.query.filter(
            and_(
                ServiceOrder.client_id == client_id,
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None)
            )
        ).order_by(ServiceOrder.completion_date.desc()).all()
        
        results = []
        for ps in ps_list:
            # Verificar se arquivo existe
            file_exists = find_ps_file_path(ps.ps_file) is not None
            
            results.append({
                'id': ps.id,
                'codigo': ps.codigo,
                'ps_number': ps.ps_number,
                'technician_name': ps.technician_name,
                'equipment': ps.equipment,
                'value': float(ps.value) if ps.value else 0.0,
                'completion_date': ps.completion_date.isoformat() if ps.completion_date else None,
                'ps_file': ps.ps_file,
                'file_exists': file_exists,
                'status': ps.status,
                'status_text': ps.status_text(),
                'has_contract': ps.has_contract,
                'no_charge': ps.no_charge
            })
        
        return jsonify({
            'success': True,
            'client_id': client_id,
            'results': results,
            'total': len(results)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Erro ao obter histórico: {str(e)}'
        }), 500

@bp.route('/api/technician-ps-history/<int:technician_id>')
@login_required
def get_technician_ps_history(technician_id):
    """API para obter histórico de PS de um técnico específico"""
    try:
        # Buscar todas as PS do técnico
        ps_list = ServiceOrder.query.filter(
            and_(
                ServiceOrder.technician_id == technician_id,
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None)
            )
        ).order_by(ServiceOrder.completion_date.desc()).all()
        
        results = []
        for ps in ps_list:
            # Verificar se arquivo existe
            file_exists = find_ps_file_path(ps.ps_file) is not None
            
            results.append({
                'id': ps.id,
                'codigo': ps.codigo,
                'ps_number': ps.ps_number,
                'client_name': ps.client_name,
                'client_document': ps.client_document,
                'equipment': ps.equipment,
                'value': float(ps.value) if ps.value else 0.0,
                'completion_date': ps.completion_date.isoformat() if ps.completion_date else None,
                'ps_file': ps.ps_file,
                'file_exists': file_exists,
                'status': ps.status,
                'status_text': ps.status_text(),
                'has_contract': ps.has_contract,
                'no_charge': ps.no_charge
            })
        
        return jsonify({
            'success': True,
            'technician_id': technician_id,
            'results': results,
            'total': len(results)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Erro ao obter histórico: {str(e)}'
        }), 500

@bp.route('/api/ps-statistics')
@login_required
def get_ps_statistics():
    """API para obter estatísticas gerais das PS"""
    try:
        from datetime import datetime, timedelta
        
        # Estatísticas gerais
        total_ps = ServiceOrder.query.filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None)
            )
        ).count()
        
        # PS dos últimos 30 dias
        thirty_days_ago = datetime.now() - timedelta(days=30)
        ps_last_30_days = ServiceOrder.query.filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None),
                ServiceOrder.completion_date >= thirty_days_ago
            )
        ).count()
        
        # PS dos últimos 7 dias
        seven_days_ago = datetime.now() - timedelta(days=7)
        ps_last_7_days = ServiceOrder.query.filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None),
                ServiceOrder.completion_date >= seven_days_ago
            )
        ).count()
        
        # Valor total das PS
        total_value = db.session.query(func.sum(ServiceOrder.value)).filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None),
                ServiceOrder.value.isnot(None)
            )
        ).scalar() or 0
        
        # Valor dos últimos 30 dias
        value_last_30_days = db.session.query(func.sum(ServiceOrder.value)).filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None),
                ServiceOrder.completion_date >= thirty_days_ago,
                ServiceOrder.value.isnot(None)
            )
        ).scalar() or 0
        
        # PS por status
        ps_by_status = db.session.query(
            ServiceOrder.status,
            func.count(ServiceOrder.id)
        ).filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None)
            )
        ).group_by(ServiceOrder.status).all()
        
        # Top 5 técnicos por PS
        top_technicians = db.session.query(
            ServiceOrder.technician_name,
            func.count(ServiceOrder.id).label('ps_count'),
            func.sum(ServiceOrder.value).label('total_value')
        ).filter(
            and_(
                ServiceOrder.ps_generated == True,
                ServiceOrder.ps_number.isnot(None)
            )
        ).group_by(ServiceOrder.technician_name).order_by(
            func.count(ServiceOrder.id).desc()
        ).limit(5).all()
        
        return jsonify({
            'success': True,
            'statistics': {
                'total_ps': total_ps,
                'ps_last_30_days': ps_last_30_days,
                'ps_last_7_days': ps_last_7_days,
                'total_value': float(total_value),
                'value_last_30_days': float(value_last_30_days),
                'ps_by_status': [{'status': status, 'count': count} for status, count in ps_by_status],
                'top_technicians': [
                    {
                        'name': name,
                        'ps_count': count,
                        'total_value': float(total_value) if total_value else 0.0
                    }
                    for name, count, total_value in top_technicians
                ]
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Erro ao obter estatísticas: {str(e)}'
        }), 500

@bp.route('/share/<token>')
def share_file(token):
    """Rota pública para compartilhar arquivo via token"""
    try:
        # Verificar se token existe
        if token not in share_tokens:
            return jsonify({"error": "Token inválido ou expirado"}), 404
        
        token_data = share_tokens[token]
        
        # Verificar se token não expirou
        if time.time() > token_data['expires_at']:
            # Remover token expirado
            del share_tokens[token]
            return jsonify({"error": "Token expirado"}), 410
        
        # Verificar se arquivo ainda existe
        file_path = Path(token_data['filepath'])
        if not file_path.exists():
            return jsonify({"error": "Arquivo não encontrado"}), 404
        
        # Enviar arquivo
        return send_file(
            file_path,
            as_attachment=True,
            download_name=token_data['filename'],
            mimetype='application/pdf'
        )
        
    except Exception as e:
        return jsonify({"error": f"Erro ao compartilhar arquivo: {str(e)}"}), 500
