from datetime import datetime, timedelta
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from textwrap import wrap
from datetime import datetime
import os
import re
import uuid
from flask import request, jsonify, Blueprint
from textwrap import wrap
# from escpos.printer import Network
from .utils import connect_postgres
try:
    from psycopg2.extras import RealDictCursor
except ImportError:
    RealDictCursor = None
import logging

IMPRESSORA_PORTA = 9100
service_provision_routes = Blueprint("service_provision_routes", __name__)
PS_DOCUMENT_CONFLICT = "PS_DOCUMENT_CONFLICT:"


def _ps_operation_marker(operation_key):
    return f"PSOP:{operation_key}" if operation_key else ""


def build_collision_ps_document(base_document, operation_key):
    token = str(operation_key or "").split("-")[0].upper()
    if not token:
        raise ValueError("Chave da operação é obrigatória para resolver colisão de PS")
    return f"{base_document}-{token}"


def _link_ps_job(ticket_id, job_id):
    from .. import db
    from ..models import Ticket

    ticket = db.session.get(Ticket, ticket_id)
    if ticket:
        ticket.ps_job_id = job_id
        ticket.ps_registration_updated_at = datetime.now()
        db.session.commit()


def _ps_output_dir() -> str:
    """Diretório de gravação dos PDFs (PS_ROOT/ps-do-dia ou ./ps/ps-do-dia)."""
    root = (os.environ.get("PS_ROOT") or "").strip()
    if root:
        out = os.path.join(root, "ps-do-dia")
    else:
        out = os.path.join(os.getcwd(), "ps", "ps-do-dia")
    os.makedirs(out, exist_ok=True)
    return out


@service_provision_routes.route("/api/signatures/<int:ticket_id>", methods=["GET"])
def get_ticket_signatures(ticket_id):
    """Busca todas as assinaturas digitais de um ticket"""
    try:
        from app.models import Ticket, TimeEntry
        from flask_login import current_user
        
        # Buscar o ticket
        ticket = Ticket.query.get(ticket_id)
        if not ticket:
            return jsonify({"error": "Ticket não encontrado"}), 404
        if ticket.ps_printed:
            return jsonify({"error": "PS já foi impressa anteriormente para este ticket"}), 400
        
        # Buscar todas as assinaturas do ticket
        signatures_list = []
        if ticket.time_entries:
            for entry in ticket.time_entries:
                if entry.signature_file_path or entry.signature_data:
                    signature_info = {
                        'id': entry.id,
                        'created_at': entry.created_at.strftime('%d/%m/%Y %H:%M'),
                        'description': entry.comment or 'Sem descrição',
                        'has_file': bool(entry.signature_file_path),
                        'has_data': bool(entry.signature_data)
                    }
                    signatures_list.append(signature_info)
        
        return jsonify({
            "success": True,
            "ticket_id": ticket_id,
            "signatures": signatures_list,
            "total": len(signatures_list)
        })
        
    except Exception as e:
        print(f"Erro ao buscar assinaturas: {e}")
        return jsonify({"error": f"Erro ao buscar assinaturas: {str(e)}"}), 500

def validate_fields(data):
    body = data.get("body", {})
    required_fields = [
        "ticket_title",
        "ticket_number",
        "client_name",
        "client_social_revenue",
        "description_service",
        "total_amount"
    ]
    for field in required_fields:
        if not body.get(field):
            raise ValueError(f"Campo obrigatório ausente: {field}")

def get_id_entity(client_social_revenue):
    conn = connect_postgres()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT id FROM entidade WHERE cnpjcpf = %s;", (client_social_revenue,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    print("CLIENTE NO UNICO =>", row)

    if row is None:
        raise LookupError("CNPJ/CPF não encontrado no banco UNICO")

    return row["id"]


def check_duplicate_finance_pg(document):
    """
    Verifica se já existe um registro no financeiro PostgreSQL com o mesmo documento
    Retorna True se já existe (duplicata), False se não existe
    """
    try:
        conn = connect_postgres()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT COUNT(*) FROM financeiro WHERE documento = %s
        """, (document,))
        
        count = cursor.fetchone()[0]
        return count > 0
        
    except Exception as e:
        print(f"❌ Erro ao verificar duplicata no financeiro PostgreSQL: {e}")
        return True  # Em caso de erro, assumir que existe para evitar duplicação
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def insert_finance_pg(id_entidade, document, title, description_service, total):
    """
    Insere registro no financeiro PostgreSQL com validação de duplicatas
    Retorna True se sucesso, False se falha
    """
    try:
        from ..uniplus_jobs import agent_enabled, enqueue_and_wait
        if agent_enabled():
            enqueue_and_wait("insert_finance_ps", {
                "id_entidade": id_entidade,
                "document": document,
                "description_service": description_service,
                "total": total,
            })
            return True
    except Exception as e:
        print(f"❌ Erro agente Uniplus insert_finance_pg: {e}")
        return False

    try:
        # Verificar se já existe duplicata
        if check_duplicate_finance_pg(document):
            print(f"⚠️ Duplicata detectada no financeiro PostgreSQL: {document}")
            return False
            
        conn = connect_postgres()
        cursor = conn.cursor()
        today = datetime.today()
        tomorrow = today + timedelta(days=1)

        # Executar inserção
        cursor.execute("""
            INSERT INTO financeiro (
                idfilial, identidade, tipo, documento, idtipodocumentofinanceiro,
                status, emissao, vencimento, valor, saldo,
                historico, idcodigocontabil, observacaoboleto
            ) VALUES (%s, %s, 'R', %s, %s, 'A', %s, %s, %s, %s, %s, 192, %s)
        """, (
            1, id_entidade, document, 8,
            today.strftime('%Y-%m-%d'),
            tomorrow.strftime('%Y-%m-%d'),
            total, total, description_service, 'Avulso' 
        ))

        # Confirmar transação
        conn.commit()
        
        # Verificar se a inserção foi bem-sucedida
        rows_affected = cursor.rowcount
        if rows_affected > 0:
            print(f"✅ Registro inserido no financeiro PostgreSQL: {document}")
            return True
        else:
            print(f"❌ Nenhum registro foi inserido no financeiro PostgreSQL: {document}")
            return False
            
    except Exception as e:
        print(f"❌ Erro ao inserir no financeiro PostgreSQL: {e}")
        if 'conn' in locals():
            conn.rollback()
        return False
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def build_ps_document(ticket_number, title=""):
    """Gera um identificador estável sem depender da sequência SQL Server legada."""
    source = "OS" if str(title).strip().upper().startswith("OS") else "TICKET"
    reference = re.sub(r"[^A-Za-z0-9_-]+", "-", str(ticket_number).strip()).strip("-")
    if not reference:
        raise ValueError("Referência inválida para geração da PS")
    return f"PS/{source}-{reference}"

def insert_ps_with_transaction_control(
    id_entidade,
    data,
    total,
    ticket_number,
    title,
    description_service,
    *,
    document=None,
    operation_key=None,
    on_job_enqueued=None,
    existing_job_id=None,
):
    """
    Registra a cobrança da PS no PostgreSQL/Unico.

    O nome é mantido por compatibilidade com os fluxos de ticket e OS. O antigo
    espelho SQL Server não faz parte da transação atual.
    Retorna (True, (document, final_os)) se sucesso, (False, error_message) se falha
    """
    pg_conn = None
    pg_cursor = None
    document = document or build_ps_document(ticket_number, title)
    final_os = str(ticket_number)
    operation_marker = _ps_operation_marker(operation_key)

    try:
        from ..uniplus_jobs import UniplusJobError, agent_enabled, enqueue_and_wait, wait_job
        if agent_enabled():
            try:
                if existing_job_id:
                    result = wait_job(existing_job_id).result_dict()
                else:
                    result = enqueue_and_wait(
                        "insert_finance_ps",
                        {
                            "id_entidade": id_entidade,
                            "document": document,
                            "description_service": description_service,
                            "total": total,
                            "operation_key": operation_key,
                        },
                        on_enqueued=on_job_enqueued,
                    )
            except UniplusJobError as exc:
                message = str(exc)
                if PS_DOCUMENT_CONFLICT in message:
                    return False, message[message.index(PS_DOCUMENT_CONFLICT):]
                raise
            return True, (result.get("document") or document, final_os)

        pg_conn = connect_postgres()
        if not pg_conn:
            raise RuntimeError("Não foi possível conectar ao PostgreSQL/Unico")
        pg_cursor = pg_conn.cursor()
        pg_cursor.execute(
            "SELECT observacaoboleto FROM financeiro WHERE documento = %s LIMIT 1",
            (document,),
        )
        existing = pg_cursor.fetchone()
        if existing:
            existing_note = str(existing[0] or "")
            if operation_marker and operation_marker in existing_note:
                return True, (document, final_os)
            return False, f"{PS_DOCUMENT_CONFLICT}{document}"

        today = datetime.today()
        tomorrow = today + timedelta(days=1)
        pg_cursor.execute("""
            INSERT INTO financeiro (
                idfilial, identidade, tipo, documento, idtipodocumentofinanceiro,
                status, emissao, vencimento, valor, saldo,
                historico, idcodigocontabil, observacaoboleto
            ) VALUES (%s, %s, 'R', %s, %s, 'A', %s, %s, %s, %s, %s, 192, %s)
        """, (
            1, id_entidade, document, 8,
            today.strftime('%Y-%m-%d'),
            tomorrow.strftime('%Y-%m-%d'),
            total, total, description_service,
            f"Avulso|{operation_marker}" if operation_marker else "Avulso",
        ))
        pg_conn.commit()
        print(f"✅ PS {document} registrada no PostgreSQL/Unico")
        return True, (document, final_os)

    except Exception as e:
        print(f"❌ Erro ao registrar PS no PostgreSQL/Unico: {e}")
        if pg_conn:
            pg_conn.rollback()
        return False, f"Erro ao registrar PS no PostgreSQL/Unico: {str(e)}"

    finally:
        if pg_cursor:
            pg_cursor.close()
        if pg_conn:
            pg_conn.close()

def check_duplicate_service_sqlserver(ticket_number, client_name=None):
    raise RuntimeError(
        "Consulta legada ao SQL Server desativada; duplicatas de PS são verificadas no PostgreSQL/Unico."
    )

def insert_service_sqlserver(id_entidade, data, total, ticket_number):
    return False, (
        "Integração legada com SQL Server desativada. "
        "Use insert_ps_with_transaction_control para registrar a PS no PostgreSQL/Unico."
    )

def generateServiceProvisionPDF(
    ps_number,
    ticket_number,
    client_name,
    address_street,
    address_number,
    address_neighborhood,
    phone,
    responsible_name,
    client_social,
    client_social_revenue,
    description_service,
    total,
    logo_path=None,
    solicitado_por=None,
    signature_data=None
):
    try:
        new_ps = ps_number.replace("/","_")
        output_dir = _ps_output_dir()
        output_path = os.path.join(output_dir, f"{new_ps}.pdf")
        c = canvas.Canvas(output_path, pagesize=A4)
        width, height = A4
        y = height - 30 * mm

        def draw_line():
            nonlocal y
            c.line(20 * mm, y, width - 20 * mm, y)
            y -= 5 * mm

        def draw_text(text, size=10, bold=False, align='left'):
            nonlocal y
            font_name = "Helvetica-Bold" if bold else "Helvetica"
            c.setFont(font_name, size)
            if align == 'center':
                c.drawCentredString(width / 2, y, text)
            elif align == 'right':
                c.drawRightString(width - 20 * mm, y, text)
            else:
                c.drawString(20 * mm, y, text)
            y -= size + 2

        # Logo (se tiver)
        if logo_path and os.path.exists(logo_path):
            logo_width = 40 * mm
            logo_height = 20 * mm
            c.drawImage(logo_path, (width - logo_width) / 2, y - logo_height, width=logo_width, height=logo_height, preserveAspectRatio=True)
            y -= logo_height + 10  # espaço abaixo do logo

        # Cabeçalho
        draw_text("Compumais Informática", size=16, bold=True, align='center')
        draw_text("Av. Coronel José Afonso de Almeida, 143 - B", align='center')
        draw_text("Centro - Sacramento, MG", align='center')
        draw_text("Tel: (34) 3351-1861 | WhatsApp: (34) 98863-1861", align='center')
        draw_line()

        # Infos
        draw_text(f"Ticket: {ticket_number}")
        draw_text(f"PS: {ps_number}")
        draw_text(f"Data: {datetime.today().strftime('%d/%m/%Y')}")
        draw_text(f"Cliente: {client_name}")
        draw_text(f"Razão Social: {client_social}")
        draw_text(f"CPF/CNPJ: {client_social_revenue}")
        draw_text(f"Endereço: {address_street}, {address_number}")
        draw_text(f"Bairro: {address_neighborhood}")
        draw_text(f"Telefone: {phone}")
        draw_text(f"Responsável: {responsible_name}")
        draw_text(f"Solicitado por: {solicitado_por or client_name}")
        draw_line()

        draw_text("Descrição dos serviços:", bold=True)
        # Primeiro dividir por quebras de linha, depois quebrar por largura
        for paragraph in description_service.split('\n'):
            if paragraph.strip():  # Só processar parágrafos não vazios
                for line in wrap(paragraph, width=90):
                    draw_text(line)
            else:
                # Parágrafo vazio - adicionar espaço
                y -= 5
        draw_line()

        draw_text(f"Total: R$ {total}", bold=True, align='right')

        y -= 10 * mm
        
        # Assinatura digital ou campo de assinatura
        if signature_data and signature_data.strip():
            try:
                # Verificar se é um caminho de arquivo ou dados base64
                if signature_data.startswith('signatures/'):
                    # É um arquivo de assinatura
                    # Usar caminho absoluto baseado no diretório atual de trabalho
                    current_dir = os.getcwd()
                    signature_file_path = os.path.join(current_dir, signature_data)
                    
                    # Debug: mostrar caminhos
                    print(f"DEBUG: Current working directory: {current_dir}")
                    print(f"DEBUG: Signature data: {signature_data}")
                    print(f"DEBUG: Full path: {signature_file_path}")
                    
                    print(f"DEBUG: Tentando carregar assinatura de: {signature_file_path}")
                    print(f"DEBUG: Arquivo existe: {os.path.exists(signature_file_path)}")
                    
                    if os.path.exists(signature_file_path):
                        # Obter dimensões da imagem original
                        try:
                            from PIL import Image
                            with Image.open(signature_file_path) as img:
                                img_width, img_height = img.size
                                print(f"DEBUG: Dimensões originais da imagem: {img_width}x{img_height}")
                                
                                # Calcular dimensões para o PDF mantendo proporção
                                max_width = 120 * mm
                                max_height = 30 * mm
                                
                                # Calcular escala mantendo proporção
                                scale_x = max_width / img_width
                                scale_y = max_height / img_height
                                scale = min(scale_x, scale_y)  # Usar a menor escala para manter proporção
                                
                                final_width = img_width * scale
                                final_height = img_height * scale
                                
                                print(f"DEBUG: Dimensões finais: {final_width}x{final_height}")
                                
                                # Centralizar a assinatura
                                signature_x = (width - final_width) / 2
                                signature_y = y - final_height - 5 * mm  # Espaço acima do campo "Assinatura:"
                                
                                print(f"DEBUG: Posição: x={signature_x}, y={signature_y}")
                                
                                # Anexar PNG diretamente na posição (sem fundo branco)
                                c.drawImage(signature_file_path, signature_x, signature_y, 
                                          width=final_width, height=final_height, 
                                          preserveAspectRatio=True)
                                
                                # Debug: adicionar texto indicando assinatura digital
                                c.setFillColor(black)
                                c.setFont("Helvetica", 8)
                                debug_text = "ASSINADO DIGITALMENTE"
                                debug_x = signature_x
                                debug_y = signature_y - 5 * mm
                                c.drawString(debug_x, debug_y, debug_text)
                                
                                # Desenhar campo "Assinatura:" abaixo da assinatura
                                y = signature_y - 15 * mm  # Posição para o campo "Assinatura:"
                                draw_text("Assinatura:", align='center')
                                print("DEBUG: PNG da assinatura anexado com sucesso")
                                
                        except ImportError:
                            print("DEBUG: PIL não disponível, usando dimensões fixas")
                            # Fallback sem PIL
                            signature_x = (width - 120 * mm) / 2
                            signature_y = y - 30 * mm - 5 * mm  # Espaço acima do campo "Assinatura:"
                            
                            # Anexar PNG diretamente
                            c.drawImage(signature_file_path, signature_x, signature_y, 
                                      width=120 * mm, height=30 * mm)
                            
                            # Debug: adicionar texto indicando assinatura digital
                            c.setFillColor(black)
                            c.setFont("Helvetica", 8)
                            debug_text = "ASSINADO DIGITALMENTE"
                            debug_x = signature_x
                            debug_y = signature_y - 5 * mm
                            c.drawString(debug_x, debug_y, debug_text)
                            
                            # Desenhar campo "Assinatura:" abaixo da assinatura
                            y = signature_y - 15 * mm  # Posição para o campo "Assinatura:"
                            draw_text("Assinatura:", align='center')
                        except Exception as e:
                            print(f"DEBUG: Erro ao processar imagem: {e}")
                            # Fallback para campo de assinatura
                            draw_text("Assinatura: ________________________________", align='center')
                    else:
                        print(f"Arquivo de assinatura não encontrado: {signature_file_path}")
                        draw_text("Assinatura: ________________________________", align='center')
                else:
                    # Fallback para dados base64 (compatibilidade com dados antigos)
                    import base64
                    from io import BytesIO
                    import tempfile
                    
                    # Tentar importar PIL, se não estiver disponível, usar fallback
                    try:
                        from PIL import Image
                        PIL_AVAILABLE = True
                    except ImportError:
                        PIL_AVAILABLE = False
                        print("PIL/Pillow não disponível, usando campo de assinatura manual")
                    
                    if PIL_AVAILABLE:
                        # Remover o prefixo "data:image/png;base64," se existir
                        if signature_data.startswith('data:image'):
                            signature_data = signature_data.split(',')[1]
                        
                        # Decodificar base64
                        signature_bytes = base64.b64decode(signature_data)
                        signature_image = Image.open(BytesIO(signature_bytes))
                        
                        # Redimensionar a assinatura para caber no espaço disponível
                        max_width = 120 * mm  # Largura máxima da assinatura
                        max_height = 30 * mm  # Altura máxima da assinatura
                        
                        # Calcular proporção para manter aspecto
                        img_width, img_height = signature_image.size
                        aspect_ratio = img_width / img_height
                        
                        if img_width > max_width:
                            new_width = max_width
                            new_height = new_width / aspect_ratio
                        else:
                            new_width = img_width
                            new_height = img_height
                        
                        if new_height > max_height:
                            new_height = max_height
                            new_width = new_height * aspect_ratio
                        
                        # Usar diretório temporário do sistema
                        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_file:
                            temp_path = temp_file.name
                        
                        # Redimensionar com compatibilidade de versão
                        try:
                            # Tentar usar Resampling.LANCZOS (PIL 8.0+)
                            resized_image = signature_image.resize((int(new_width), int(new_height)), Image.Resampling.LANCZOS)
                        except AttributeError:
                            # Fallback para versões antigas do PIL
                            resized_image = signature_image.resize((int(new_width), int(new_height)), Image.LANCZOS)
                        
                        resized_image.save(temp_path)
                        
                        # Desenhar a assinatura no PDF
                        signature_x = (width - new_width) / 2  # Centralizar
                        signature_y = y - new_height
                        c.drawImage(temp_path, signature_x, signature_y, width=new_width, height=new_height)
                        
                        # Remover arquivo temporário
                        if os.path.exists(temp_path):
                            os.remove(temp_path)
                        
                        y = signature_y - 10 * mm  # Espaço abaixo da assinatura
                    else:
                        # Fallback se PIL não estiver disponível
                        draw_text("Assinatura: ________________________________", align='center')
                
            except Exception as e:
                print(f"Erro ao processar assinatura digital: {e}")
                # Fallback para campo de assinatura manual
                draw_text("Assinatura: ________________________________", align='center')
        else:
            # Campo de assinatura manual (quando não há assinatura)
            draw_text("Assinatura: ________________________________", align='center')

        c.showPage()
        c.save()

        return True, os.path.basename(output_path)

    except Exception as e:
        import logging
        logging.exception("Erro ao gerar PDF")
        return False, str(e)

@service_provision_routes.route("/printers", methods=["POST"])
def print_ps():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Dados não fornecidos"}), 400
        
        body = data.get("body", {})
        if not body.get("ticket_number"):
            return jsonify({"error": "Campo obrigatório: ticket_number"}), 400
        
        # A referência, o cliente e o valor vêm do ticket; o payload não é fonte confiável.
        from .. import db
        from ..models import Ticket, TimeEntry, UniplusJob
        
        try:
            ticket_id = int(body["ticket_number"])
        except (TypeError, ValueError):
            return jsonify({"error": "Número do ticket inválido"}), 400

        ticket = Ticket.query.filter_by(id=ticket_id).with_for_update().first()
        
        if not ticket:
            return jsonify({"error": "Ticket não encontrado"}), 404
        if ticket.ps_printed:
            return jsonify({
                "error": "PS já foi gerada para este ticket",
                "ps_number": ticket.ps_number,
                "pdf_file": ticket.ps_file,
            }), 409

        now = datetime.now()
        if (
            ticket.ps_registration_status == "registering"
            and ticket.ps_registration_updated_at
            and (now - ticket.ps_registration_updated_at).total_seconds() < 120
        ):
            return jsonify({
                "error": "A geração desta PS já está em andamento",
                "ps_number": ticket.ps_number,
            }), 409

        if not ticket.ps_operation_key:
            ticket.ps_operation_key = str(uuid.uuid4())
        if not ticket.ps_number:
            ticket.ps_number = build_ps_document(ticket.id, f"Ticket #{ticket.id}")
        if ticket.ps_job_id:
            previous_job = db.session.get(UniplusJob, ticket.ps_job_id)
            if not previous_job or (previous_job.status == "error" and not previous_job.permanent):
                ticket.ps_job_id = None
        ticket.ps_registration_status = "registering"
        ticket.ps_registration_updated_at = now
        db.session.commit()

        service_amount = float(ticket.total_cost or 0)
        products_amount = round(float(ticket.products_total() or 0), 2)
        is_billing_order_only = service_amount <= 0 and products_amount > 0
        total_amount = products_amount if is_billing_order_only else service_amount
        if total_amount <= 0:
            ticket.ps_registration_status = "registration_failed"
            ticket.ps_registration_updated_at = datetime.now()
            db.session.commit()
            return jsonify({"error": "O ticket não possui valor total válido para gerar a PS"}), 400
        client_name = ticket.display_client_name()
        
        # Buscar apontamentos do ticket para incluir observações
        time_entries = TimeEntry.query.filter_by(ticket_id=ticket_id).all()
        observations = []
        for entry in time_entries:
            if entry.comment:
                observations.append(f"• {entry.comment}")
        
        # Montar descrição completa com observações dos apontamentos
        # Montar descrição completa com observações dos apontamentos
        # Alterado para exibir APENAS as observações dos apontamentos, sem título e descrição do ticket
        full_description = ""
        # if ticket.title:
        #     full_description = f"{ticket.title}"
        # if ticket.description:
        #     full_description += f" - {ticket.description}"
        
        if observations:
            # Se houver observações, usa elas (removendo o cabeçalho "Observações dos apontamentos:")
            full_description = "\n".join(observations)
        else:
            # Fallback: se não houver observações, usa o título do ticket para não ficar vazio
            full_description = ticket.title or "Serviços prestados"
        
        # Buscar dados do cliente externo
        client_data = {}
        if ticket.external_client_id:
            try:
                conn = connect_postgres()
                if conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra9, extra10 
                        FROM entidade 
                        WHERE id = %s
                    """, (ticket.external_client_id,))
                    row = cursor.fetchone()
                    if row:
                        client_data = {
                            "id": row[0],
                            "name": row[1],
                            "document": row[2],
                            "phone": row[3],
                            "email": row[4],
                            "address": row[5],
                            "address_number": row[6],
                            "contract_type": row[7],
                            "no_charge": bool(row[8]) if row[8] is not None else False
                        }
                    cursor.close()
                    conn.close()
            except Exception as e:
                print(f"Erro ao buscar cliente: {e}")
        
        # Buscar dados do técnico responsável
        technician_name = "TÉCNICO"
        if ticket.assigned_to_user:
            technician_name = ticket.assigned_to_user.name

        product_details = [
            {
                "id": p.product_id,
                "codigo": p.codigo,
                "unidademedida": p.unidademedida,
                "nome": p.nome,
                "quantidade": p.quantidade,
                "preco": p.preco,
            }
            for p in ticket.products
        ]

        finance_description = full_description
        if is_billing_order_only:
            from ..services.faturamento_products import products_summary
            dav_ref = f" #{ticket.dav_codigo}" if ticket.dav_codigo else ""
            summary_txt = products_summary(product_details)
            finance_description = (
                f"Pedido de Faturamento{dav_ref} (Ticket #{ticket.id})"
                + (f" - {summary_txt}" if summary_txt else "")
            )
        
        # Inserir nos bancos com controle de transação
        document = None
        final_os = None
        try:
            # Usar sempre o ID da entidade do ticket (já salvo)
            entity_id = ticket.external_client_id
            
            # Usar a nova função de controle de transação
            success, result_data = insert_ps_with_transaction_control(
                entity_id, 
                {
                    "client_name": client_name,
                    "address_street": client_data.get("address", ""),
                    "address_number": client_data.get("address_number", ""),
                    "phone": client_data.get("phone", ""),
                    "responsible_name": technician_name,
                    "description_service": finance_description
                }, 
                total_amount,
                ticket_id,
                f"Ticket #{int(ticket_id)}",
                finance_description,
                document=ticket.ps_number,
                operation_key=ticket.ps_operation_key,
                existing_job_id=ticket.ps_job_id,
                on_job_enqueued=lambda job: _link_ps_job(ticket.id, job.id),
            )
            
            if (
                not success
                and str(result_data).startswith(PS_DOCUMENT_CONFLICT)
                and ticket.ps_number == build_ps_document(ticket.id, f"Ticket #{ticket.id}")
            ):
                ticket.ps_number = build_collision_ps_document(
                    build_ps_document(ticket.id, f"Ticket #{ticket.id}"),
                    ticket.ps_operation_key,
                )
                ticket.ps_job_id = None
                ticket.ps_registration_status = "registering"
                ticket.ps_registration_updated_at = datetime.now()
                db.session.commit()
                success, result_data = insert_ps_with_transaction_control(
                    entity_id,
                    {"client_name": client_name},
                    total_amount,
                    ticket_id,
                    f"Ticket #{ticket_id}",
                    finance_description,
                    document=ticket.ps_number,
                    operation_key=ticket.ps_operation_key,
                    on_job_enqueued=lambda job: _link_ps_job(ticket.id, job.id),
                )

            if not success:
                ticket.ps_registration_status = "registration_failed"
                ticket.ps_registration_updated_at = datetime.now()
                db.session.commit()
                error_msg = result_data if result_data else "Falha ao registrar a PS no Unico"
                status_code = 409 if str(error_msg).startswith(PS_DOCUMENT_CONFLICT) else 500
                return jsonify({"error": error_msg, "ps_number": ticket.ps_number}), status_code
                
            document, final_os = result_data
            ticket.ps_number = document
            ticket.ps_registration_status = "registered"
            ticket.ps_registration_updated_at = datetime.now()
            db.session.commit()
                    
        except Exception as e:
            print(f"Erro ao inserir no banco: {e}")
            ticket.ps_registration_status = "registration_failed"
            ticket.ps_registration_updated_at = datetime.now()
            db.session.commit()
            return jsonify({"error": f"Erro ao processar dados no banco: {str(e)}"}), 500
        
        # Usar o identificador estável registrado no PostgreSQL/Unico
        ps_number = document if document else f"PS-{int(ticket_id):06d}"
        
        # Buscar todas as assinaturas digitais do ticket
        signatures_list = []
        if ticket.time_entries:
            for entry in ticket.time_entries:
                if entry.signature_file_path or entry.signature_data:
                    signature_info = {
                        'id': entry.id,
                        'created_at': entry.created_at.strftime('%d/%m/%Y %H:%M'),
                        'description': entry.comment or 'Sem descrição',
                        'signature_file_path': entry.signature_file_path,
                        'signature_data': entry.signature_data
                    }
                    signatures_list.append(signature_info)
        
        # Selecionar assinatura baseada no parâmetro enviado
        signature_file_path = None
        selected_signature_id = body.get("selected_signature_id")
        
        if signatures_list:
            if selected_signature_id:
                # Buscar assinatura específica
                selected_signature = next((sig for sig in signatures_list if sig['id'] == selected_signature_id), None)
                if selected_signature:
                    signature_file_path = selected_signature['signature_file_path'] or selected_signature['signature_data']
                    print(f"DEBUG: Usando assinatura selecionada ID {selected_signature_id}")
                else:
                    print(f"DEBUG: Assinatura ID {selected_signature_id} não encontrada, usando primeira disponível")
                    signature_file_path = signatures_list[0]['signature_file_path'] or signatures_list[0]['signature_data']
            else:
                # Por padrão, usar a primeira assinatura encontrada
                signature_file_path = signatures_list[0]['signature_file_path'] or signatures_list[0]['signature_data']
                print(f"DEBUG: Usando primeira assinatura disponível")
            
            print(f"DEBUG: Encontradas {len(signatures_list)} assinaturas para o ticket {ticket.id}")
            for i, sig in enumerate(signatures_list):
                print(f"DEBUG: Assinatura {i+1}: {sig['created_at']} - {sig['description']}")
        
        if is_billing_order_only:
            success, result = generateBillingOrderPDF(
                ps_number=ps_number,
                reference_type="Ticket",
                reference_number=final_os if final_os else str(ticket_id),
                dav_codigo=ticket.dav_codigo,
                client_name=client_name,
                client_social=client_name,
                client_social_revenue=client_data.get("document", ""),
                address_street=client_data.get("address", ""),
                address_number=client_data.get("address_number", ""),
                phone=client_data.get("phone", ""),
                contract_name=client_data.get("contract_type") or "",
                responsible_name=technician_name,
                equipment=ticket.title or f"Ticket #{ticket_id}",
                service_executed=full_description,
                products=product_details,
                issue_date=datetime.now().strftime("%d/%m/%Y"),
                solicitado_por=ticket.solicitante,
                signature_data=signature_file_path,
            )
        elif product_details:
            success, result = generateCombinedPSAndDeliveryReceipt(
                ps_number=ps_number,
                os_number=final_os if final_os else str(ticket_id),
                client_name=client_name,
                client_social=client_name,
                client_social_revenue=client_data.get("document", ""),
                address_street=client_data.get("address", ""),
                address_number=client_data.get("address_number", ""),
                phone=client_data.get("phone", ""),
                responsible_name=technician_name,
                equipment=ticket.title or f"Ticket #{ticket_id}",
                service_executed=full_description,
                total=total_amount,
                delivery_date=datetime.now().strftime("%d/%m/%Y"),
                solicitado_por=ticket.solicitante,
                products=product_details,
            )
        else:
            success, result = generateServiceProvisionPDF(
                ps_number=ps_number,
                ticket_number=final_os if final_os else body["ticket_number"],
                client_name=client_name,
                address_street=client_data.get("address", ""),
                address_number=client_data.get("address_number", ""),
                address_neighborhood="",
                phone=client_data.get("phone", ""),
                responsible_name=technician_name,
                client_social=client_name,
                client_social_revenue=client_data.get("document", ""),
                description_service=full_description,
                total=total_amount,
                logo_path=None,
                solicitado_por=ticket.solicitante,
                signature_data=signature_file_path,
            )
        
        if success:
            pdf_filename = os.path.basename(result) if result else None
            ticket.ps_printed = True
            ticket.ps_number = ps_number
            ticket.ps_file = pdf_filename
            ticket.ps_registration_status = "completed"
            ticket.ps_registration_updated_at = datetime.now()
            db.session.commit()

            doc_label = "Pedido de faturamento gerado com sucesso" if is_billing_order_only else "PS gerada com sucesso"
            return jsonify({
                "message": doc_label,
                "file": result,
                "pdf_file": pdf_filename,
                "ps_number": ps_number,
                "billing_order": is_billing_order_only,
                "total_amount": total_amount,
            })
        else:
            ticket.ps_registration_status = "pdf_failed"
            ticket.ps_registration_updated_at = datetime.now()
            db.session.commit()
            return jsonify({"error": f"Erro ao gerar PS: {result}"}), 500
            
    except Exception as e:
        return jsonify({"error": f"Erro interno: {str(e)}"}), 500

@service_provision_routes.route("/generate-os", methods=["POST"])
def generate_service_order():
    try:
        # Tentar obter dados do JSON primeiro
        try:
            data = request.get_json()
        except:
            # Se não for JSON, tentar obter do formulário
            dados_str = request.form.get('dados')
            if dados_str:
                data = json.loads(dados_str)
            else:
                raise ValueError("Dados não encontrados na requisição")
        
        # Extrair dados do request
        client_name = data.get("client_name", "")
        desk_name = data.get("desk_name", "")
        responsible_name = data.get("responsible_name", "")
        title = data.get("title", "")
        description = data.get("description", "")
        date_time = data.get("date_time", datetime.now().strftime("%d/%m/%Y %H:%M"))

        success, message = printGenerateOrderService(
            client_name=client_name,
            responsible_name=responsible_name,
            title=title,
            description_service=description,
            date_service=date_time
        )

        if success:
            return jsonify({
                "message": "Ordem de serviço impressa com sucesso!"
            }), 200
        else:
            return jsonify({
                "error": message
            }), 500
    except Exception as e:
        return jsonify({"error": "Erro Interno no servidor", "details": str(e)}), 500

def safe_text(text):
    try:
        return text.encode('cp850', errors='replace').decode('cp850')
    except Exception:
        return text  # Em último caso, devolve o texto original

def generateCombinedPSAndDeliveryReceipt(
    ps_number,
    os_number,
    client_name,
    client_social,
    client_social_revenue,
    address_street,
    address_number,
    phone,
    responsible_name,
    equipment,
    service_executed,
    total,
    delivery_date,
    solicitado_por=None,
    products=None
):
    """Gera PS e recibo de entrega no mesmo PDF (dividindo a folha A4)"""
    try:
        output_dir = _ps_output_dir()
        output_path = os.path.join(output_dir, f"ps-recibo-{os_number}.pdf")
        c = canvas.Canvas(output_path, pagesize=A4)
        width, height = A4
        
        # Dividir a folha A4 em duas partes (PS na parte superior, recibo na inferior)
        ps_height = height / 2  # 50% para PS
        receipt_height = height / 2  # 50% para recibo
        
        def draw_line(y_pos, line_width=None):
            if line_width is None:
                line_width = width - 40 * mm
            c.line(20 * mm, y_pos, 20 * mm + line_width, y_pos)

        def draw_text(text, x, y, size=10, bold=False, align='left'):
            font_name = "Helvetica-Bold" if bold else "Helvetica"
            c.setFont(font_name, size)
            if align == 'center':
                c.drawCentredString(x, y, text)
            elif align == 'right':
                c.drawRightString(x, y, text)
            else:
                c.drawString(x, y, text)

        # ===== PRESTAÇÃO DE SERVIÇO (PARTE SUPERIOR) =====
        y_ps = height - 20 * mm
        
        # Cabeçalho PS
        draw_text("Compumais Informática", width/2, y_ps, size=14, bold=True, align='center')
        y_ps -= 15
        draw_text("Av. Coronel José Afonso de Almeida, 143 - B", width/2, y_ps, size=8, align='center')
        y_ps -= 10
        draw_text("Centro - Sacramento, MG", width/2, y_ps, size=8, align='center')
        y_ps -= 10
        draw_text("Tel: (34) 3351-1861 | WhatsApp: (34) 98863-1861", width/2, y_ps, size=8, align='center')
        y_ps -= 15
        draw_line(y_ps)
        y_ps -= 10

        # Título PS
        draw_text("PRESTAÇÃO DE SERVIÇO", width/2, y_ps, size=12, bold=True, align='center')
        y_ps -= 15
        draw_line(y_ps)
        y_ps -= 10

        # Dados PS
        draw_text(f"OS: {os_number}", 20 * mm, y_ps, size=9)
        draw_text(f"PS: {ps_number}", width/2, y_ps, size=9)
        draw_text(f"Data: {delivery_date}", width - 20 * mm, y_ps, size=9, align='right')
        y_ps -= 12
        draw_text(f"Cliente: {client_name}", 20 * mm, y_ps, size=9)
        y_ps -= 12
        draw_text(f"Razão Social: {client_social}", 20 * mm, y_ps, size=9)
        y_ps -= 12
        draw_text(f"CPF/CNPJ: {client_social_revenue}", 20 * mm, y_ps, size=9)
        y_ps -= 12
        draw_text(f"Endereço: {address_street}, {address_number}", 20 * mm, y_ps, size=9)
        y_ps -= 12
        draw_text(f"Telefone: {phone}", 20 * mm, y_ps, size=9)
        y_ps -= 12
        draw_text(f"Responsável: {responsible_name}", 20 * mm, y_ps, size=9)
        y_ps -= 12
        draw_text(f"Solicitado por: {solicitado_por or client_name}", 20 * mm, y_ps, size=9)
        y_ps -= 15
        draw_line(y_ps)
        y_ps -= 10

        # Descrição do serviço
        draw_text("Descrição dos serviços:", 20 * mm, y_ps, size=9, bold=True)
        y_ps -= 12
        # Primeiro dividir por quebras de linha, depois quebrar por largura
        for paragraph in service_executed.split('\n'):
            if paragraph.strip():  # Só processar parágrafos não vazios
                for line in wrap(paragraph, width=80):
                    draw_text(line, 20 * mm, y_ps, size=9)
                    y_ps -= 10
            else:
                # Parágrafo vazio - adicionar espaço
                y_ps -= 5
        y_ps -= 10
        # Calcular total de produtos
        total_products = 0.0

        # Produtos usados
        if products:
            draw_text("Produtos Utilizados:", 20 * mm, y_ps, size=9, bold=True)
            y_ps -= 12
            # Cabeçalho da tabela de produtos
            draw_text("Descrição", 20 * mm, y_ps, size=8, bold=True)
            draw_text("Qtd", width - 50 * mm, y_ps, size=8, bold=True, align='right')
            draw_text("Valor Un.", width - 35 * mm, y_ps, size=8, bold=True, align='right')
            draw_text("Total", width - 20 * mm, y_ps, size=8, bold=True, align='right')
            y_ps -= 10
            draw_line(y_ps)
            y_ps -= 8

            for p in products:
                nome = p.get('nome', 'Produto')
                qtd = float(p.get('quantidade', 0))
                preco = float(p.get('preco', 0))
                subtotal = preco * qtd
                total_products += subtotal
                
                # Truncar nome se for muito longo
                if len(nome) > 40:
                    nome = nome[:37] + "..."
                
                draw_text(nome, 20 * mm, y_ps, size=8)
                draw_text(f"{qtd:.2f}", width - 50 * mm, y_ps, size=8, align='right')
                draw_text(f"R$ {preco:.2f}", width - 35 * mm, y_ps, size=8, align='right')
                draw_text(f"R$ {subtotal:.2f}", width - 20 * mm, y_ps, size=8, align='right')
                y_ps -= 10
                
                if y_ps < ps_height + 5 * mm: # Proteção para não invadir o recibo
                    break
            
            y_ps -= 5
            draw_line(y_ps)
            y_ps -= 10

        # Total PS (Serviço + Produtos)
        try:
            total_float = float(total)
        except (ValueError, TypeError):
            total_float = 0.0
            
        total_geral = total_float + total_products
        
        # Valor Serviço antes do Total
        draw_text(f"Valor Serviço: R$ {total_float:.2f}", width - 20 * mm, y_ps, size=9, align='right')
        y_ps -= 12

        draw_text(f"Total: R$ {total_geral:.2f}", width - 20 * mm, y_ps, size=10, bold=True, align='right')
        y_ps -= 20
        draw_text("Assinatura: ________________________________", width/2, y_ps, size=9, align='center')

        # ===== RECIBO DE ENTREGA (PARTE INFERIOR) =====
        y_receipt = ps_height - 20 * mm
        
        # Linha divisória
        draw_line(y_receipt, width - 40 * mm)
        y_receipt -= 15

        # Título Recibo
        draw_text("RECIBO DE ENTREGA DE EQUIPAMENTO", width/2, y_receipt, size=12, bold=True, align='center')
        y_receipt -= 15
        draw_line(y_receipt, width - 40 * mm)
        y_receipt -= 10

        # Dados Recibo
        draw_text(f"Ordem de Serviço: {os_number}", 20 * mm, y_receipt, size=9)
        y_receipt -= 12
        draw_text(f"Data de Entrega: {delivery_date}", 20 * mm, y_receipt, size=9)
        y_receipt -= 12
        draw_text(f"Cliente: {client_name}", 20 * mm, y_receipt, size=9)
        y_receipt -= 12
        draw_text(f"Equipamento: {equipment}", 20 * mm, y_receipt, size=9)
        y_receipt -= 12
        draw_text(f"Responsável pela Entrega: {responsible_name}", 20 * mm, y_receipt, size=9)
        y_receipt -= 15
        draw_line(y_receipt, width - 40 * mm)
        y_receipt -= 10

        # Serviço executado
        draw_text("Serviço Executado:", 20 * mm, y_receipt, size=9, bold=True)
        y_receipt -= 12
        for line in wrap(service_executed, width=80):
            draw_text(line, 20 * mm, y_receipt, size=9)
            y_receipt -= 10
        y_receipt -= 10
        draw_line(y_receipt, width - 40 * mm)
        y_receipt -= 10

        y_receipt -= 10

        # Produtos usados
        if products:
            draw_text("Produtos Utilizados:", 20 * mm, y_receipt, size=9, bold=True)
            y_receipt -= 12
            
            for p in products:
                nome = p.get('nome', 'Produto')
                qtd = p.get('quantidade', 0)
                
                txt = f"• {qtd:.2f} x {nome}"
                # Truncar se for muito longo para o recibo
                if len(txt) > 80:
                    txt = txt[:77] + "..."
                
                draw_text(txt, 20 * mm, y_receipt, size=8)
                y_receipt -= 10
                
                if y_receipt < 30 * mm:
                    break
            
            y_receipt -= 5
            draw_line(y_receipt, width - 40 * mm)
            y_receipt -= 10
        else:
            # Se não houver produtos, apenas o título e a linha
            draw_text("Produtos Utilizados:", 20 * mm, y_receipt, size=9, bold=True)
            y_receipt -= 12
            draw_line(y_receipt, width - 40 * mm)
            y_receipt -= 10

        # Texto do recibo
        draw_text("Declaro que recebi o equipamento acima descrito em perfeitas condições", 20 * mm, y_receipt, size=9, bold=True)
        y_receipt -= 12
        draw_text("e que o serviço foi executado conforme solicitado.", 20 * mm, y_receipt, size=9, bold=True)
        y_receipt -= 15
        draw_line(y_receipt, width - 40 * mm)
        y_receipt -= 15

        # Assinatura recibo
        draw_text("Assinatura do Cliente: ________________________________", width/2, y_receipt, size=9, align='center')
        y_receipt -= 15
        draw_text(f"Data: {delivery_date}", width/2, y_receipt, size=9, align='center')

        c.showPage()
        c.save()

        # Retornar apenas o nome do arquivo, não o caminho completo
        filename = os.path.basename(output_path)
        return True, filename

    except Exception as e:
        import logging
        logging.exception("Erro ao gerar PS e recibo combinados")
        return False, str(e)

def generateBillingOrderPDF(
    ps_number,
    reference_number,
    client_name,
    products,
    *,
    reference_type="OS",
    dav_codigo=None,
    client_social="",
    client_social_revenue="",
    address_street="",
    address_number="",
    phone="",
    contract_name="",
    responsible_name="",
    equipment="",
    service_executed="",
    issue_date=None,
    solicitado_por=None,
    signature_data=None,
):
    """Gera o Pedido de Faturamento em página A4 própria (separado do recibo de entrega)."""
    try:
        kind_slug = "ticket" if str(reference_type or "").strip().lower() == "ticket" else "os"
        safe_ref = re.sub(r"[^0-9A-Za-z_-]", "", str(reference_number or "0"))[:40] or "0"
        output_dir = _ps_output_dir()
        output_path = os.path.join(output_dir, f"pedido-faturamento-{kind_slug}-{safe_ref}.pdf")
        c = canvas.Canvas(output_path, pagesize=A4)
        width, height = A4
        margin = 20 * mm
        y = height - 22 * mm
        issued = issue_date or datetime.now().strftime("%d/%m/%Y")
        ref_label = "Ticket" if kind_slug == "ticket" else "OS"

        def draw_line():
            nonlocal y
            c.line(margin, y, width - margin, y)
            y -= 5 * mm

        def ensure_space(min_y=25 * mm, repeat_table_header=False):
            nonlocal y
            if y < min_y:
                c.showPage()
                y = height - 22 * mm
                c.setFont("Helvetica-Bold", 10)
                c.drawString(margin, y, f"PEDIDO DE FATURAMENTO - {ref_label} #{reference_number} (continuação)")
                c.drawRightString(width - margin, y, f"Doc.: {ps_number}")
                y -= 5 * mm
                draw_line()
                if repeat_table_header:
                    draw_products_header()

        def draw_text(text, size=9.5, bold=False, align="left", step=None):
            nonlocal y
            ensure_space(20 * mm)
            font_name = "Helvetica-Bold" if bold else "Helvetica"
            c.setFont(font_name, size)
            if align == "center":
                c.drawCentredString(width / 2, y, str(text))
            elif align == "right":
                c.drawRightString(width - margin, y, str(text))
            else:
                c.drawString(margin, y, str(text))
            y -= step if step is not None else (size + 3)

        def draw_products_header():
            nonlocal y
            c.setFont("Helvetica-Bold", 8.5)
            c.drawString(margin, y, "Código")
            c.drawString(margin + 24 * mm, y, "Descrição do Produto")
            c.drawCentredString(width - 72 * mm, y, "UM")
            c.drawRightString(width - 52 * mm, y, "Qtd")
            c.drawRightString(width - 28 * mm, y, "Valor Un.")
            c.drawRightString(width - margin, y, "Subtotal")
            y -= 3.5 * mm
            c.line(margin, y, width - margin, y)
            y -= 4.5 * mm

        # Cabeçalho da empresa
        draw_text("Compumais Informática", size=15, bold=True, align="center", step=16)
        draw_text("Av. Coronel José Afonso de Almeida, 143 - B", size=8.5, align="center", step=11)
        draw_text("Centro - Sacramento, MG", size=8.5, align="center", step=11)
        draw_text("Tel: (34) 3351-1861 | WhatsApp: (34) 98863-1861", size=8.5, align="center", step=13)
        draw_line()

        # Título do documento
        draw_text("PEDIDO DE FATURAMENTO", size=13, bold=True, align="center", step=15)
        draw_line()

        # Linha de identificação
        c.setFont("Helvetica-Bold", 9.5)
        if dav_codigo:
            c.drawString(margin, y, f"Pedido (DAV): #{dav_codigo}")
            c.drawCentredString(width / 2, y, f"Documento: {ps_number}")
            c.drawRightString(width - margin, y, f"Emissão: {issued}")
            y -= 13
            c.setFont("Helvetica", 9)
            c.drawString(margin, y, f"Origem: {ref_label} #{reference_number}")
            y -= 14
        else:
            c.drawString(margin, y, f"Origem: {ref_label} #{reference_number}")
            c.drawCentredString(width / 2, y, f"Documento: {ps_number}")
            c.drawRightString(width - margin, y, f"Emissão: {issued}")
            y -= 14
        draw_line()

        # Dados do cliente
        address_parts = [p.strip() for p in (address_street or "", str(address_number or "")) if p and p.strip()]
        full_address = ", ".join(address_parts) if address_parts else "Não informado"
        contract_label = f"Mensalista ({contract_name})" if contract_name else "Mensalista (mão de obra isenta)"

        draw_text(f"Cliente: {client_name or 'Não informado'}", size=9.5, bold=True)
        if client_social and client_social.strip() and client_social.strip() != (client_name or "").strip():
            draw_text(f"Razão Social: {client_social}", size=9)
        c.setFont("Helvetica", 9)
        c.drawString(margin, y, f"CPF/CNPJ: {client_social_revenue or 'Não informado'}")
        c.drawRightString(width - margin, y, f"Telefone: {phone or 'Não informado'}")
        y -= 12
        draw_text(f"Endereço: {full_address}", size=9)
        draw_text(f"Contemplação: {contract_label}", size=9)
        c.setFont("Helvetica", 9)
        c.drawString(margin, y, f"Responsável: {responsible_name or '—'}")
        c.drawRightString(width - margin, y, f"Solicitado por: {solicitado_por or client_name or '—'}")
        y -= 13
        if equipment:
            draw_text(f"Referência / Equipamento: {equipment}", size=9)
        draw_line()

        # Resumo do atendimento vinculado (informativo, mão de obra R$ 0,00)
        if service_executed and str(service_executed).strip():
            draw_text("Atendimento vinculado (mão de obra contemplada pelo contrato):", size=9, bold=True)
            for paragraph in str(service_executed).split("\n"):
                if paragraph.strip():
                    for line in wrap(paragraph.strip(), width=92):
                        draw_text(line, size=8.5, step=11)
            y -= 2 * mm
            draw_line()

        # Tabela de produtos faturados
        draw_text("PRODUTOS INCLUÍDOS NO PEDIDO DE FATURAMENTO", size=10, bold=True, step=14)
        draw_products_header()

        total_products = 0.0
        for p in (products or []):
            codigo_prod = str(p.get("codigo") or p.get("id") or "—")[:12]
            nome_prod = str(p.get("nome") or "Produto").strip() or "Produto"
            um_prod = str(p.get("unidademedida") or "UN").strip()[:6] or "UN"
            qtd = float(p.get("quantidade") or 0)
            preco = float(p.get("preco") or 0)
            subtotal = round(preco * qtd, 2)
            total_products += subtotal

            wrapped_name = wrap(nome_prod, width=42) or [nome_prod]
            row_height = max(1, len(wrapped_name)) * 11 + 3
            ensure_space(25 * mm + row_height, repeat_table_header=True)

            c.setFont("Helvetica", 8.5)
            c.drawString(margin, y, codigo_prod)
            c.drawString(margin + 24 * mm, y, wrapped_name[0])
            c.drawCentredString(width - 72 * mm, y, um_prod)
            qtd_fmt = f"{int(qtd)}" if qtd == int(qtd) else f"{qtd:.2f}"
            c.drawRightString(width - 52 * mm, y, qtd_fmt)
            c.drawRightString(width - 28 * mm, y, f"R$ {preco:.2f}")
            c.drawRightString(width - margin, y, f"R$ {subtotal:.2f}")
            y -= 11

            for extra_line in wrapped_name[1:]:
                ensure_space(20 * mm, repeat_table_header=True)
                c.setFont("Helvetica", 8.5)
                c.drawString(margin + 24 * mm, y, extra_line)
                y -= 11

            y -= 2

        total_products = round(total_products, 2)
        y -= 2 * mm
        draw_line()

        # Totais
        ensure_space(60 * mm)
        draw_text("Valor Mão de Obra / Atendimento: R$ 0,00 (Isento - Mensalista)", size=9, align="right", step=13)
        draw_text(f"Subtotal Produtos: R$ {total_products:.2f}", size=9.5, align="right", step=15)
        draw_text(f"TOTAL A RECEBER (CONTAS A RECEBER): R$ {total_products:.2f}", size=11.5, bold=True, align="right", step=18)
        draw_line()

        draw_text(
            "Declaro o recebimento/autorização de faturamento dos produtos acima descritos para cobrança no Contas a Receber.",
            size=8.5,
            bold=True,
            step=14,
        )
        y -= 6 * mm

        # Assinatura digital (quando houver) ou manual
        drew_digital_sig = False
        if signature_data and str(signature_data).strip():
            try:
                sig_raw = str(signature_data).strip()
                if sig_raw.startswith("signatures/"):
                    sig_path = os.path.join(os.getcwd(), sig_raw)
                    if os.path.exists(sig_path):
                        sig_w, sig_h = 90 * mm, 24 * mm
                        sig_x = (width - sig_w) / 2
                        sig_y = y - sig_h
                        c.drawImage(sig_path, sig_x, sig_y, width=sig_w, height=sig_h, preserveAspectRatio=True)
                        y = sig_y - 4 * mm
                        c.setFillColorRGB(0, 0, 0)
                        draw_text("ASSINADO DIGITALMENTE", size=7.5, align="center", step=10)
                        drew_digital_sig = True
                else:
                    import base64
                    import tempfile
                    from io import BytesIO
                    from PIL import Image

                    payload_b64 = sig_raw.split(",", 1)[1] if sig_raw.startswith("data:image") and "," in sig_raw else sig_raw
                    sig_bytes = base64.b64decode(payload_b64)
                    with Image.open(BytesIO(sig_bytes)) as sig_img:
                        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                            tmp_path = tmp.name
                        sig_img.save(tmp_path)
                    try:
                        sig_w, sig_h = 90 * mm, 24 * mm
                        sig_x = (width - sig_w) / 2
                        sig_y = y - sig_h
                        c.drawImage(tmp_path, sig_x, sig_y, width=sig_w, height=sig_h, preserveAspectRatio=True)
                        y = sig_y - 4 * mm
                        drew_digital_sig = True
                    finally:
                        if os.path.exists(tmp_path):
                            os.remove(tmp_path)
            except Exception as sig_err:
                logging.warning("Falha ao renderizar assinatura no pedido de faturamento: %s", sig_err)

        if not drew_digital_sig:
            y -= 10 * mm
        draw_text("Assinatura do Cliente: ________________________________________", size=9.5, align="center", step=14)
        draw_text(f"Data: {issued}", size=9, align="center", step=12)

        c.showPage()
        c.save()
        return True, os.path.basename(output_path)
    except Exception as e:
        logging.exception("Erro ao gerar PDF de Pedido de Faturamento")
        return False, str(e)


def generateDeliveryReceipt(
    os_number,
    client_name,
    equipment,
    delivery_date,
    responsible_name,
    service_executed=None,
    products=None
):
    """Gera recibo de entrega de equipamento (versão individual - mantida para compatibilidade)"""
    try:
        output_dir = _ps_output_dir()
        output_path = os.path.join(output_dir, f"recibo-entrega-{os_number}.pdf")
        c = canvas.Canvas(output_path, pagesize=A4)
        width, height = A4
        y = height - 30 * mm

        def draw_line():
            nonlocal y
            c.line(20 * mm, y, width - 20 * mm, y)
            y -= 5 * mm

        def draw_text(text, size=10, bold=False, align='left'):
            nonlocal y
            font_name = "Helvetica-Bold" if bold else "Helvetica"
            c.setFont(font_name, size)
            if align == 'center':
                c.drawCentredString(width / 2, y, text)
            elif align == 'right':
                c.drawRightString(width - 20 * mm, y, text)
            else:
                c.drawString(20 * mm, y, text)
            y -= size + 2

        # Cabeçalho
        draw_text("Compumais Informática", size=16, bold=True, align='center')
        draw_text("Av. Coronel José Afonso de Almeida, 143 - B", align='center')
        draw_text("Centro - Sacramento, MG", align='center')
        draw_text("Tel: (34) 3351-1861 | WhatsApp: (34) 98863-1861", align='center')
        draw_line()

        # Título
        draw_text("RECIBO DE ENTREGA DE EQUIPAMENTO", size=14, bold=True, align='center')
        draw_line()

        # Dados da OS
        draw_text(f"Ordem de Serviço: {os_number}")
        draw_text(f"Data de Entrega: {delivery_date}")
        draw_text(f"Cliente: {client_name}")
        draw_text(f"Equipamento: {equipment}")
        draw_text(f"Responsável pela Entrega: {responsible_name}")
        draw_line()

        # Serviço executado (se fornecido)
        if service_executed:
            draw_text("Serviço Executado:", bold=True)
            for line in wrap(service_executed, width=90):
                draw_text(line)
            draw_line()

        # Produtos usados
        if products:
            draw_text("Produtos Utilizados:", bold=True)
            y -= 5
            
            for p in products:
                nome = p.get('nome', 'Produto')
                qtd = p.get('quantidade', 0)
                
                txt = f"• {qtd:.2f} x {nome}"
                for line in wrap(txt, width=90):
                    draw_text(line, size=9)
            
            draw_line()

        # Texto do recibo
        draw_text("Declaro que recebi o equipamento acima descrito em perfeitas condições", size=12, bold=True)
        draw_text("e que o serviço foi executado conforme solicitado.", size=12, bold=True)
        draw_line()

        # Espaço para assinatura
        y -= 20 * mm
        draw_text("Assinatura do Cliente: ________________________________", align='center')
        y -= 10 * mm
        draw_text(f"Data: {delivery_date}", align='center')

        c.showPage()
        c.save()

        # Retornar apenas o nome do arquivo, não o caminho completo
        filename = os.path.basename(output_path)
        return True, filename

    except Exception as e:
        import logging
        logging.exception("Erro ao gerar recibo de entrega")
        return False, str(e)


_OS_COMPANY = (
    "Compumais Informática",
    "Av. Coronel José Afonso de Almeida, 143 - B",
    "Centro - Sacramento, MG",
    "Tel: (34) 3351-1861 | WhatsApp: (34) 98863-1861",
)
THERMAL_PAGE = (80 * mm, 297 * mm)


def generateOpenServiceOrderPDF(
    os_number,
    client_name,
    equipment,
    problem,
    responsible_name,
    opened_at=None,
    solicitante=None,
    serial=None,
    caracteristicas=None,
    observacao=None,
    formato="a4",
):
    """Comprovante de abertura da OS em A4 ou bobina térmica 80mm."""
    try:
        kind = "termica" if str(formato or "").strip().lower() in {"termica", "térmica", "thermal", "80mm"} else "a4"
        safe_os = re.sub(r"[^0-9A-Za-z_-]", "", str(os_number or "os"))[:40] or "os"
        output_dir = _ps_output_dir()
        output_path = os.path.join(output_dir, f"os-abertura-{safe_os}-{kind}.pdf")
        pagesize = THERMAL_PAGE if kind == "termica" else A4
        c = canvas.Canvas(output_path, pagesize=pagesize)
        width, height = pagesize
        margin = 5 * mm if kind == "termica" else 20 * mm
        body_size = 8 if kind == "termica" else 10
        title_size = 11 if kind == "termica" else 14
        wrap_cols = 32 if kind == "termica" else 90
        y = height - (12 * mm if kind == "termica" else 30 * mm)

        def draw_line():
            nonlocal y
            c.line(margin, y, width - margin, y)
            y -= 4 * mm if kind == "termica" else 5 * mm

        def ensure(space=14):
            nonlocal y
            if y < space:
                c.showPage()
                y = height - (12 * mm if kind == "termica" else 30 * mm)

        def draw_text(text, size=None, bold=False, align="left"):
            nonlocal y
            size = body_size if size is None else size
            ensure(size + 8)
            font_name = "Helvetica-Bold" if bold else "Helvetica"
            c.setFont(font_name, size)
            if align == "center":
                c.drawCentredString(width / 2, y, text)
            elif align == "right":
                c.drawRightString(width - margin, y, text)
            else:
                c.drawString(margin, y, text)
            y -= size + (3 if kind == "termica" else 2)

        def draw_block(label, value, bold_value=False):
            if value is None or str(value).strip() == "":
                return
            draw_text(label, bold=True)
            for paragraph in str(value).split("\n"):
                if not paragraph.strip():
                    y -= 3
                    continue
                for line in wrap(paragraph, width=wrap_cols):
                    draw_text(line, bold=bold_value)

        opened = opened_at or datetime.now().strftime("%d/%m/%Y %H:%M")
        for i, line in enumerate(_OS_COMPANY):
            draw_text(line, size=(12 if i == 0 else body_size), bold=i == 0, align="center")
        draw_line()
        draw_text("ORDEM DE SERVIÇO", size=title_size, bold=True, align="center")
        draw_text(f"Nº {os_number}", size=title_size, bold=True, align="center")
        draw_line()
        draw_text(f"Abertura: {opened}")
        draw_block("Cliente:", client_name)
        if solicitante:
            draw_block("Solicitante:", solicitante)
        draw_block("Equipamento:", equipment)
        if serial:
            draw_block("Nº de série:", serial)
        if caracteristicas:
            draw_block("Características:", caracteristicas)
        draw_line()
        draw_block("Problema descrito:", problem)
        if observacao:
            draw_block("Observação:", observacao)
        draw_text(f"Técnico: {responsible_name or '—'}")
        draw_line()
        draw_text("Declaro ter deixado o equipamento acima", bold=True)
        draw_text("nas condições descritas nesta ordem.", bold=True)
        y -= 12 * mm if kind == "termica" else 18 * mm
        draw_text("Assinatura do cliente:", align="center")
        y -= 8 * mm if kind == "termica" else 12 * mm
        c.line(margin + (8 * mm if kind == "termica" else 20 * mm), y, width - margin - (8 * mm if kind == "termica" else 20 * mm), y)
        y -= 10 * mm
        draw_text(f"Data: {opened}", align="center")
        y -= 10 * mm if kind == "termica" else 16 * mm
        draw_text("Recebido por:", align="center")
        y -= 8 * mm if kind == "termica" else 12 * mm
        c.line(margin + (8 * mm if kind == "termica" else 20 * mm), y, width - margin - (8 * mm if kind == "termica" else 20 * mm), y)
        y -= 8 * mm
        draw_text(responsible_name or "", align="center")

        c.showPage()
        c.save()
        return True, os.path.basename(output_path)
    except Exception as e:
        import logging
        logging.exception("Erro ao gerar comprovante de abertura da OS")
        return False, str(e)


def printGenerateOrderService(
    client_name,
    responsible_name,
    title,
    description_service,
    date_service
):
    try:
        impressora_ip = request.cookies.get("end_impressora_local")
        if not impressora_ip:
            impressora_ip = "192.168.2.69"

        p = Network(impressora_ip, IMPRESSORA_PORTA)

        p.set(align="center", width=2, height=2)
        p.text("\x1b\x45\x01")  # Ativa negrito
        p.text("Compumais Informática\n")
        p.text("\x1b\x45\x00")  # Desativa negrito

        p.set(align="center", width=1, height=1)
        p.text("Av. Coronel José Afonso de Almeida, 143 - B\n")
        p.text("Centro - Sacramento, MG\n")
        p.text("Tel: (34) 3351-1861 | WhatsApp: (34) 98863-1861\n")
        p.text("------------------------------------------------\n")

        p.set(align="left", width=1, height=1)
        p.text(f"Data: {datetime.now().strftime('%d/%m/%Y %H:%M')}\n")
        p.text(f"Cliente: {client_name}\n")
        p.text("------------------------------------------------\n")

        p.text("DETALHES DO SERVIÇO:\n")
        p.text(f"Titulo:{title}\n")
        p.text(safe_text(f"Descrição: {description_service}\n"))
        p.text("------------------------------------------------\n")
        p.text(f"Data de execução: {date_service}\n")
        p.text(f"Responsável: {responsible_name}\n")

        p.text(safe_text("Observações:\n"))
        p.text("------------------------------------------------\n" * 3)

        p.text("\n")
        p.text(f"Autorizado por: {client_name}\n")

        p.text("\n")
        p.text("------------------------------------------------\n")
        p.set(align="center")
        p.text(safe_text("\nAssinatura do Responsável:\n"))
        p.text("________________________________\n")
        
        p.text("\n\n")
        p.cut()
        p.close()

        return True, "Impressão enviada com sucesso."

    except Exception as e:
        logging.exception("Erro ao imprimir Ordem de Serviço")
        return False, str(e)
