from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for, send_file
from flask_login import login_required, current_user
from .. import db
from ..models import ServiceOrder
from .utils import connect_postgres
from .printer import generateDeliveryReceipt, generateCombinedPSAndDeliveryReceipt
from ..services.faturamento_products import (
	search_products as search_products_pg,
	validate_products,
	create_dav,
	products_summary,
)
from datetime import datetime, date
import json
import os
from pathlib import Path

bp = Blueprint("service_orders", __name__)

@bp.route("/")
@login_required
def list_service_orders():
	"""Página principal de ordens de serviço"""
	return render_template("service_orders/list.html")

@bp.route("/finalizadas")
@login_required
def list_finalized():
	"""Lista ordens de serviço finalizadas"""
	# Parâmetros de paginação
	page = request.args.get('page', 1, type=int)
	per_page = request.args.get('per_page', 20, type=int)

	# Parâmetros de filtro
	status = request.args.get('status', '', type=str).strip()
	technician_name = request.args.get('technician_name', '', type=str).strip()
	q = request.args.get('q', '', type=str).strip()
	date_from = request.args.get('date_from', '', type=str).strip()
	date_to = request.args.get('date_to', '', type=str).strip()

	query = ServiceOrder.query
	if status:
		query = query.filter(ServiceOrder.status == int(status))
	if technician_name:
		query = query.filter(ServiceOrder.technician_name == technician_name)
	if q:
		like = f"%{q}%"
		query = query.filter(db.or_(ServiceOrder.client_name.ilike(like), ServiceOrder.codigo.ilike(like)))
	if date_from:
		try:
			dt_from = datetime.strptime(date_from, "%Y-%m-%d")
			query = query.filter(ServiceOrder.completion_date >= dt_from)
		except ValueError:
			pass
	if date_to:
		try:
			dt_to = datetime.strptime(date_to, "%Y-%m-%d")
			dt_to = dt_to.replace(hour=23, minute=59, second=59)
			query = query.filter(ServiceOrder.completion_date <= dt_to)
		except ValueError:
			pass

	# Buscar ordens de serviço do SQLite com paginação
	pagination = query.order_by(ServiceOrder.completion_date.desc()).paginate(
		page=page, 
		per_page=per_page, 
		error_out=False
	)
	
	service_orders = pagination.items

	technicians = [
		row[0] for row in
		db.session.query(ServiceOrder.technician_name).distinct().order_by(ServiceOrder.technician_name.asc()).all()
		if row[0]
	]

	return render_template("service_orders/finalized.html", 
						   service_orders=service_orders, 
						   pagination=pagination,
						   technicians=technicians,
						   current_filters={
							   'status': status,
							   'technician_name': technician_name,
							   'q': q,
							   'date_from': date_from,
							   'date_to': date_to,
						   })

@bp.route("/finalizar")
@login_required
def finalize_service_order():
	"""Tela para finalizar ordem de serviço"""
	return render_template("service_orders/finalize.html")

@bp.route("/search/<codigo>")
@login_required
def search_service_order(codigo):
	"""Compatibilidade: busca OS e retorna a primeira ocorrência"""
	try:
		term = (codigo or "").strip()
		results = _search_service_orders(term, limit=1)
		if not results:
			return jsonify({"error": "Ordem de serviço não encontrada ou já finalizada"}), 404
		return jsonify(results[0])
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar ordem de serviço: {str(e)}"}), 500


def _search_service_orders(term: str, limit: int = 30):
	"""Busca ordens em aberto por código exato e nome do cliente (ILIKE)."""
	conn = connect_postgres()
	if not conn:
		raise Exception("Erro ao conectar com banco PostgreSQL")

	cursor = conn.cursor()
	try:
		query_term = (term or "").strip()
		like_term = f"%{query_term}%"

		cursor.execute("""
			SELECT
				os.codigo,
				os.idcliente,
				os.data,
				os.descricaoitem,
				os.problemadescrito,
				os.servicoexecutado,
				os.status,
				os.valor,
				os.observacao,
				COALESCE(ent.nome, '') AS nome_cliente
			FROM ordemservico os
			LEFT JOIN entidade ent ON ent.id = os.idcliente
			WHERE os.status != 5
			  AND (
					CAST(os.codigo AS TEXT) = %s
					OR COALESCE(ent.nome, '') ILIKE %s
			  )
			ORDER BY
				CASE WHEN CAST(os.codigo AS TEXT) = %s THEN 0 ELSE 1 END,
				os.data DESC
			LIMIT %s
		""", (query_term, like_term, query_term, limit))
		rows = cursor.fetchall()

		results = []
		for row in rows:
			os_codigo = row[0]
			client_id = row[1]
			os_data = row[2]
			equipamento = row[3]
			problema_descrito = row[4]
			servico_executado = row[5]
			status = row[6]
			valor = row[7]
			observacao = row[8]

			client_data = {}
			if client_id:
				try:
					cursor.execute(
						"SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra9, extra10 FROM entidade WHERE id = %s",
						(client_id,)
					)
					client_row = cursor.fetchone()
					if client_row:
						client_data = {
							"id": client_row[0],
							"nome": client_row[1],
							"cnpjcpf": client_row[2],
							"celular": client_row[3],
							"email": client_row[4],
							"endereco": client_row[5],
							"numeroendereco": client_row[6],
							"extra9": client_row[7],
							"extra10": client_row[8]
						}
				except Exception as e:
					print(f"Erro ao buscar cliente: {e}")

			no_charge = bool(client_data.get("extra10")) if client_data.get("extra10") is not None else False
			results.append({
				"codigo": os_codigo,
				"id_cliente": client_id,
				"data_abertura": os_data.strftime('%d/%m/%Y %H:%M') if os_data else '',
				"equipamento": equipamento or "Equipamento não informado",
				"problema_descrito": problema_descrito or "Problema não descrito",
				"servico_executado": servico_executado or "",
				"tecnico": current_user.name,
				"status": status,
				"valor": float(valor) if valor else 0.0,
				"observacoes": observacao or "",
				"cliente": client_data,
				"no_charge": no_charge
			})

		return results
	finally:
		cursor.close()
		conn.close()


@bp.route("/search")
@login_required
def search_service_orders():
	"""Busca ordens por nome do cliente (ILIKE) ou código exato."""
	try:
		term = (request.args.get("q") or "").strip()
		if not term:
			return jsonify({"results": []})
		results = _search_service_orders(term, limit=30)
		return jsonify({"results": results})
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar ordem de serviço: {str(e)}"}), 500


@bp.route("/produtos")
@login_required
def search_products():
	"""Busca produtos ativos do sistema de faturamento (PostgreSQL) para vincular à OS"""
	try:
		q = request.args.get("q", "").strip()
		products = search_products_pg(q)
		return jsonify({"products": products})
	except ConnectionError as e:
		return jsonify({"error": str(e)}), 500
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar produtos: {str(e)}"}), 500


@bp.route("/processar-finalizacao", methods=["POST"])
@login_required
def process_finalization():
	"""Processa a finalização da ordem de serviço"""
	try:
		data = request.get_json()
		codigo = data.get("codigo")
		servico_executado = data.get("servico_executado")
		valor = float(data.get("valor", 0))
		produtos = data.get("produtos", [])  # [{id, quantidade}]
		
		if not codigo or not servico_executado:
			return jsonify({"error": "Código e serviço executado são obrigatórios"}), 400
		
		# Buscar ordem de serviço
		conn = connect_postgres()
		if not conn:
			return jsonify({"error": "Erro ao conectar com banco PostgreSQL"}), 500
		
		cursor = conn.cursor()
		# Buscar campos específicos baseado na estrutura do JSON
		cursor.execute("""
			SELECT codigo, idcliente, data, descricaoitem, problemadescrito, 
				   servicoexecutado, status, valor, observacao
			FROM ordemservico 
			WHERE codigo = %s
		""", (codigo,))
		row = cursor.fetchone()
		
		if not row:
			cursor.close()
			conn.close()
			return jsonify({"error": "Ordem de serviço não encontrada"}), 404
		
		# Extrair dados da row
		os_codigo = row[0]
		client_id = row[1]
		os_data = row[2]
		equipamento = row[3]
		problema_descrito = row[4]
		servico_executado_atual = row[5]
		status = row[6]
		valor_atual = row[7]
		observacao = row[8]
		
		# Buscar dados do cliente
		client_data = {}
		if client_id:
			try:
				cursor.execute("SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra9, extra10 FROM entidade WHERE id = %s", (client_id,))
				client_row = cursor.fetchone()
				if client_row:
					client_data = {
						"id": client_row[0],
						"nome": client_row[1],
						"cnpjcpf": client_row[2],
						"celular": client_row[3],
						"email": client_row[4],
						"endereco": client_row[5],
						"numeroendereco": client_row[6],
						"extra9": client_row[7],
						"extra10": client_row[8]
					}
			except Exception as e:
				print(f"Erro ao buscar cliente: {e}")
		
		# Verificar se cliente tem flag "não cobra atendimento" para definir status
		no_charge = bool(client_data.get("extra10")) if client_data.get("extra10") is not None else False
		
		# Definir status: 3 para sem cobrança, 5 para com cobrança
		# Se o valor for maior que zero, forçamos o status 5 (com cobrança)
		if valor > 0:
			final_status = 5
			# Se o valor foi informado manualmente, desativamos a flag no_charge para este processamento
			if no_charge:
				no_charge = False
		else:
			final_status = 3 if no_charge else 5

		# Validar regras de produtos, quando aplicável
		from ..models import SystemConfig
		products_required = (SystemConfig.get('os_products_required', 'false').lower() == 'true')
		if final_status == 5 and products_required and (not produtos or len(produtos) == 0):
			cursor.close()
			conn.close()
			return jsonify({"error": "Não é permitido finalizar a OS sem produtos."}), 400

		product_details, product_error = validate_products(cursor, produtos)
		if product_error:
			cursor.close()
			conn.close()
			return jsonify({"error": product_error}), 400
		product_details = product_details or []
		
		# Salvar estado do autocommit antes de começar as operações
		# Rollback para garantir que não há transação aberta das consultas anteriores
		conn.rollback()
		original_autocommit = conn.autocommit
		conn.autocommit = False  # Iniciar transação explícita
		
		try:
			# Atualizar ordem de serviço com todos os campos necessários
			from ..uniplus_jobs import agent_enabled, enqueue_and_wait
			from ..services.faturamento_products import get_external_user_data

			if agent_enabled():
				ext_uid, ext_rid = (None, None)
				try:
					ext_uid, ext_rid = get_external_user_data(cursor, current_user)
				except Exception:
					pass
				payload = {
					"codigo": codigo,
					"servico_executado": servico_executado,
					"valor": valor,
					"status": final_status,
					"idusuarioentrega": current_user.id if hasattr(current_user, "id") else 1,
					"nomeresponsavelretirada": current_user.name,
					"client_id": client_id,
					"external_user_id": ext_uid,
					"external_rep_id": ext_rid,
				}
				if product_details:
					payload["create_dav"] = True
					payload["product_details"] = product_details
				result = enqueue_and_wait("finalize_ordemservico", payload, timeout=90.0)
				dav_id = result.get("dav_id")
				dav_codigo = result.get("dav_codigo")
				print(f"✅ DEBUG - OS finalizada via agente Uniplus")
			else:
				# NÃO fazer commit ainda - vamos fazer tudo em uma transação
				# para garantir que se o DAV falhar, a OS também não seja atualizada
				cursor.execute("""
					UPDATE ordemservico 
					SET servicoexecutado = %s, valor = %s, status = %s, fimservico = %s,
						geroufinanceiro = %s, impresso = 1, datahoraimpressao = %s,
						idusuarioentrega = %s, nomeresponsavelretirada = %s,
						descricaoultimoevento = %s, dataultimoevento = %s
					WHERE codigo = %s
				""", (
					servico_executado, 
					valor, 
					final_status,  # status: 3 (sem cobrança) ou 5 (com cobrança)
					datetime.now(),  # fimservico
					1 if valor > 0 else 0,  # geroufinanceiro
					datetime.now(),  # datahoraimpressao
					current_user.id if hasattr(current_user, 'id') else 1,  # idusuarioentrega
					current_user.name,  # nomeresponsavelretirada
					f"Ordem de serviço {codigo} finalizada",  # descricaoultimoevento
					datetime.now(),  # dataultimoevento
					codigo
				))

				# Se houver produtos, criar DAV e seus itens de forma transacional
				dav_id = None
				dav_codigo = None
				
				print(f"🔍 DEBUG DAV - final_status: {final_status}, product_details: {len(product_details) if product_details else 0}")
				print(f"🔍 DEBUG DAV - client_id: {client_id}, codigo OS: {codigo}")
				if product_details:
					try:
						dav_id, dav_codigo = create_dav(
							cursor,
							client_id=client_id,
							reference_label="OS",
							reference_code=str(codigo),
							product_details=product_details,
							local_user=current_user,
						)
					except ValueError as e:
						conn.rollback()
						cursor.close()
						conn.close()
						return jsonify({"error": str(e)}), 400
				
				# Commit de tudo junto (OS + DAV se houver) - feito no bloco try principal
				conn.commit()
				print(f"✅ DEBUG - Commit realizado com sucesso! OS atualizada e DAV criado (se houver)")
			
		except Exception as e:
			# Rollback em caso de erro
			conn.rollback()
			msg = str(e)
			print(f"❌ DEBUG - Erro na transação: {msg}")
			import traceback
			traceback.print_exc()
			
			# Mensagens de erro específicas
			if "inexistente" in msg.lower() or "inativo" in msg.lower():
				cursor.close()
				conn.close()
				return jsonify({"error": f"Produto inexistente ou inativo: {msg}"}), 400
			if "dav já existe" in msg.lower() or "duplicar" in msg.lower():
				cursor.close()
				conn.close()
				return jsonify({"error": "Não é permitido duplicar DAV para a mesma OS"}), 400
			if "cliente" in msg.lower() and "não" in msg.lower():
				cursor.close()
				conn.close()
				return jsonify({"error": msg}), 400
			if "quantidade" in msg.lower() or "preço" in msg.lower():
				cursor.close()
				conn.close()
				return jsonify({"error": msg}), 400
			
			# Erro genérico
			cursor.close()
			conn.close()
			return jsonify({"error": f"Erro ao finalizar OS: {msg}"}), 500
		finally:
			# Restaurar autocommit original
			# Restaurar autocommit original se a conexão ainda estiver aberta
			if not conn.closed:
				conn.autocommit = original_autocommit
		
		# Verificar se cliente tem contrato
		has_contract = bool(client_data.get("extra9")) if client_data.get("extra9") else False
		
		# Gerar PS apenas se:
		# 1. Houver valor > 0
		# 2. NÃO tiver flag "não cobra atendimento"
		ps_generated = False
		ps_file = None
		ps_number = None
		delivery_success = False
		delivery_result = None
		
		if valor > 0 and not no_charge:
			try:
				print(f"🔧 Iniciando geração de PS para OS {codigo} - Valor: {valor}, Cliente: {client_id}")
				
				# Usar sempre o ID da entidade do cliente
				# Não importa se tem CPF/CNPJ ou não
				id_entity = client_id
				
				# Inserir nos bancos com controle de transação
				from .printer import insert_ps_with_transaction_control
				
				print(f"📊 Inserindo dados nos bancos - ID Entity: {id_entity}")
				success, result_data = insert_ps_with_transaction_control(
					id_entity, 
					{
						"client_name": client_data["nome"],
						"address_street": client_data.get("endereco", ""),
						"address_number": client_data.get("numeroendereco", ""),
						"phone": client_data.get("celular", ""),
						"responsible_name": current_user.name,  # usuário logado
						"description_service": servico_executado
					}, 
					valor, 
					codigo,
					f"OS #{codigo}",
					servico_executado
				)
				
				print(f"📊 Resultado inserção bancos - Success: {success}, Document: {result_data}")
				
				if not success:
					print(f"❌ Falha ao inserir dados nos bancos - possível duplicata detectada")
					error_msg = result_data if result_data else "Falha ao inserir dados nos bancos - possível duplicata detectada"
					flash(error_msg, "error")
					return redirect(url_for("service_orders.list_service_orders"))
				
				document, final_os = result_data
				# Usar o identificador estável registrado no PostgreSQL/Unico
				ps_number = document
				print(f"📄 Número da PS gerado: {ps_number}, OS final: {final_os}")
				
				# Gerar PDF combinado (PS + Recibo de Entrega)
				print(f"📄 Gerando PDF combinado - PS: {ps_number}, OS: {final_os}")
				success, result = generateCombinedPSAndDeliveryReceipt(
					ps_number=ps_number,
					os_number=final_os,
					client_name=client_data["nome"],
					client_social=client_data["nome"],  # Razão social continua sendo o nome do cliente
					client_social_revenue=client_data["cnpjcpf"],
					address_street=client_data.get("endereco", ""),
					address_number=client_data.get("numeroendereco", ""),
					phone=client_data.get("celular", ""),
					responsible_name=current_user.name,
					equipment=equipamento or "Equipamento",
					service_executed=servico_executado,
					total=valor,
					delivery_date=datetime.now().strftime('%d/%m/%Y'),
					solicitado_por=client_data.get("nome", ""),  # Usar nome do cliente no campo "Solicitado por"
					products=product_details
				)
				
				print(f"📄 Resultado geração PDF - Success: {success}, File: {result}")
				
				if success:
					ps_generated = True
					ps_file = result
					delivery_success = True
					delivery_result = result
					print(f"✅ PS e Recibo gerados com sucesso: {result}")
				else:
					print(f"❌ Falha na geração do PDF: {result}")
			except Exception as e:
				print(f"❌ Erro ao gerar PS: {e}")
				import traceback
				traceback.print_exc()
		else:
			# Se não gerar PS, gerar apenas o recibo de entrega
			print(f"📄 Gerando apenas recibo de entrega - OS: {codigo} (Valor: {valor}, No Charge: {no_charge})")
			try:
				delivery_success, delivery_result = generateDeliveryReceipt(
					os_number=codigo,
					client_name=client_data["nome"],
					equipment=equipamento or "Equipamento",
					delivery_date=datetime.now().strftime('%d/%m/%Y'),
					responsible_name=current_user.name,
					service_executed=servico_executado,
					products=product_details
				)
				print(f"📄 Resultado recibo de entrega - Success: {delivery_success}, File: {delivery_result}")
			except Exception as e:
				print(f"❌ Erro ao gerar recibo de entrega: {e}")
				import traceback
				traceback.print_exc()
		
		cursor.close()
		conn.close()
		
		print(f"🎯 RESUMO FINALIZAÇÃO OS {codigo}:")
		print(f"   - PS Gerada: {ps_generated}")
		print(f"   - Arquivo PS: {ps_file}")
		print(f"   - Número PS: {ps_number}")
		print(f"   - Recibo Gerado: {delivery_success}")
		print(f"   - Arquivo Recibo: {delivery_result}")
		print(f"   - Tem Contrato: {has_contract}")
		print(f"   - Sem Cobrança: {no_charge}")
		print(f"   - Status Final: {final_status}")
		
		# Inserir dados na tabela SQLite
		try:
			# Verificar se já existe uma ordem com este código
			existing_order = ServiceOrder.query.filter_by(codigo=codigo).first()
			if existing_order:
				# Atualizar ordem existente
				existing_order.service_executed = servico_executado
				existing_order.value = valor
				existing_order.status = final_status
				existing_order.ps_generated = ps_generated
				existing_order.delivery_receipt_generated = delivery_success
				existing_order.ps_number = ps_number if ps_generated else None
				existing_order.ps_file = ps_file if ps_generated else None
				existing_order.delivery_file = delivery_result if delivery_success else None
				existing_order.completion_date = datetime.now()
				existing_order.technician_id = current_user.id if hasattr(current_user, 'id') else None
				existing_order.technician_name = current_user.name
				# Registrar resumo de produtos no campo de observações (sem alterar estrutura)
				if product_details:
					existing_order.observations = (existing_order.observations or "") + f"\n{products_summary(product_details)}"
			else:
				# Criar nova ordem
				service_order = ServiceOrder(
					codigo=codigo,
					client_id=client_id,
					client_name=client_data.get("nome", ""),
					client_document=client_data.get("cnpjcpf"),
					client_phone=client_data.get("celular"),
					client_address=client_data.get("endereco"),
					client_address_number=client_data.get("numeroendereco"),
					equipment=equipamento or "Equipamento não informado",
					problem_description=problema_descrito or "Problema não descrito",
					service_executed=servico_executado,
					observations=observacao or "",
					value=valor,
					ps_number=ps_number if ps_generated else None,
					ps_generated=ps_generated,
					delivery_receipt_generated=delivery_success,
					status=final_status,
					no_charge=no_charge,
					has_contract=has_contract,
					opening_date=os_data,
					completion_date=datetime.now(),
					technician_id=current_user.id if hasattr(current_user, 'id') else None,
					technician_name=current_user.name,
					ps_file=ps_file if ps_generated else None,
					delivery_file=delivery_result if delivery_success else None
				)
				db.session.add(service_order)
				# Registrar resumo de produtos
				if product_details:
					service_order.observations = (service_order.observations or "") + f"\n{products_summary(product_details)}"
			
			db.session.commit()
			print(f"Ordem de serviço {codigo} salva no SQLite com sucesso")
		except Exception as e:
			db.session.rollback()
			print(f"Erro ao salvar ordem de serviço no SQLite: {e}")
		
		# Montar mensagem de retorno
		message = "Ordem de serviço finalizada com sucesso"
		
		# Adicionar informação sobre o status
		if no_charge:
			message += f" - Status: {final_status} (finalizada sem cobrança)"
		else:
			message += f" - Status: {final_status} (finalizada com cobrança)"
		
		if ps_generated:
			message += f" - PS e recibo de entrega gerados juntos: {ps_number}"
		elif delivery_success:
			message += " - Recibo de entrega gerado"
		
		if valor > 0 and no_charge:
			message += " - PS não gerada (cliente com contrato 'não cobra atendimento')"
		elif valor == 0:
			message += " - PS não gerada (valor zero)"
		
		return jsonify({
			"message": message,
			"ps_generated": ps_generated,
			"ps_file": ps_file,
			"ps_number": ps_number if ps_generated else None,
			"delivery_generated": delivery_success,
			"delivery_file": delivery_result if delivery_success else None,
			"has_contract": has_contract,
			"no_charge": no_charge,
			"final_status": final_status,
			"dav_id": dav_id,
			"dav_codigo": dav_codigo
		})
		
	except Exception as e:
		return jsonify({"error": f"Erro ao finalizar ordem de serviço: {str(e)}"}), 500


@bp.route("/<int:order_id>")
@login_required
def view_service_order(order_id):
	"""Visualizar ordem de serviço específica"""
	service_order = ServiceOrder.query.get_or_404(order_id)
	return render_template("service_orders/view.html", service_order=service_order)


@bp.route("/pdf/<filename>")
@login_required
def serve_pdf(filename):
	"""Serve PDF files for printing"""
	try:
		# Caminho base da pasta PS (caminho absoluto)
		ps_path = Path(__file__).parent.parent.parent / "ps"
		
		# Verificar se o arquivo existe na pasta ps-do-dia
		pdf_path = ps_path / "ps-do-dia" / filename
		if not pdf_path.exists():
			# Tentar busca recursiva como fallback
			found_path = None
			for path in ps_path.rglob(filename):
				if path.is_file() and path.resolve().is_relative_to(ps_path.resolve()):
					found_path = path
					break
			if found_path:
				pdf_path = found_path
			else:
				return jsonify({"error": "Arquivo PDF não encontrado"}), 404
		
		# Verificar se o arquivo está dentro da pasta PS
		if not pdf_path.resolve().is_relative_to(ps_path.resolve()):
			return jsonify({"error": "Acesso negado"}), 403
		
		# Enviar o arquivo PDF
		return send_file(str(pdf_path), as_attachment=False, mimetype='application/pdf')
		
	except Exception as e:
		return jsonify({"error": f"Erro ao abrir PDF: {str(e)}"}), 500
