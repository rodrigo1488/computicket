from datetime import datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from .. import db
from ..models import Service, contract_service, ClientContract
from ..external_pg import (
	fetch_contract_types, get_contracts_with_services, get_services_for_contract,
	fetch_external_clients, fetch_clients_by_contract_type, assign_contract_to_clients,
	update_contract_type, remove_contract_from_all_clients, add_clients_to_contract,
	remove_client_from_contract, add_client_to_contract, get_clients_by_contract
)

bp = Blueprint("contracts", __name__)


def _parse_date(value: str):
	"""Converte 'YYYY-MM-DD' em date; retorna None se vazio/inválido"""
	value = (value or "").strip()
	if not value:
		return None
	try:
		return datetime.strptime(value, "%Y-%m-%d").date()
	except ValueError:
		return None


def _get_or_create_client_contract(contract_name: str, client_id: int, client_name: str = None) -> ClientContract:
	record = ClientContract.query.filter_by(
		contract_name=contract_name, external_client_id=client_id
	).first()
	if not record:
		record = ClientContract(
			contract_name=contract_name,
			external_client_id=client_id,
			external_client_name=client_name,
		)
		db.session.add(record)
	elif client_name and record.external_client_name != client_name:
		record.external_client_name = client_name
	return record


@bp.route("/")
@login_required
def list_contracts():
	"""Lista todos os contratos do PostgreSQL com seus serviços vinculados"""
	# Buscar parâmetro de busca
	search_term = request.args.get("q", "").strip()
	status_filter = request.args.get("status", "").strip()

	contracts = get_contracts_with_services(search_term if search_term else None)
	all_services = Service.query.order_by(Service.name.asc()).all()
	
	# Estatísticas de vencimento por contrato (a partir dos detalhes por cliente)
	contract_stats = {}
	for record in ClientContract.query.all():
		stats = contract_stats.setdefault(record.contract_name, {
			"total": 0, "vencidos": 0, "vencendo": 0, "cancelados": 0
		})
		stats["total"] += 1
		display = record.display_status
		if display == "vencido":
			stats["vencidos"] += 1
		elif display == "vencendo":
			stats["vencendo"] += 1
		elif display == "cancelado":
			stats["cancelados"] += 1

	if status_filter:
		def _matches_status(contract):
			stats = contract_stats.get(contract.name, {"total": 0, "vencidos": 0, "vencendo": 0, "cancelados": 0})
			if status_filter == "vencido":
				return stats["vencidos"] > 0
			if status_filter == "vencendo":
				return stats["vencendo"] > 0
			if status_filter == "ativo":
				return stats["total"] > 0 and stats["vencidos"] == 0 and stats["vencendo"] == 0
			return True
		contracts = [c for c in contracts if _matches_status(c)]

	return render_template("contracts/list.html", 
		contracts=contracts, 
		all_services=all_services,
		search_term=search_term,
		status_filter=status_filter,
		contract_stats=contract_stats
	)


@bp.route("/<contract_name>/services", methods=["GET"])
@login_required
def get_contract_services(contract_name: str):
	"""API para buscar serviços de um contrato específico"""
	services = get_services_for_contract(contract_name)
	return jsonify(services)


@bp.route("/<contract_name>/clients", methods=["GET"])
@login_required
def get_contract_clients(contract_name: str):
	"""API para buscar clientes de um contrato específico"""
	try:
		clients = fetch_clients_by_contract_type(contract_name)
		# Enriquecer com detalhes do contrato de cada cliente (produto, datas, valor, status)
		details_by_client = {
			r.external_client_id: r.to_dict()
			for r in ClientContract.query.filter_by(contract_name=contract_name).all()
		}
		for client in clients:
			client["contract_details"] = details_by_client.get(client.get("id"))
		return jsonify({
			"success": True,
			"contract_name": contract_name,
			"clients": clients,
			"total": len(clients)
		})
	except Exception as e:
		return jsonify({
			"success": False,
			"error": f"Erro ao buscar clientes: {str(e)}"
		}), 500


@bp.route("/<contract_name>/link-service", methods=["POST"])
@login_required
def link_service_to_contract(contract_name: str):
	"""Vincula um serviço a um contrato"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	service_id = request.form.get("service_id", type=int)
	if not service_id:
		flash("ID do serviço é obrigatório.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	# Verificar se o serviço existe
	service = Service.query.get(service_id)
	if not service:
		flash("Serviço não encontrado.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	# Verificar se a relação já existe
	existing = db.session.execute(
		contract_service.select().where(
			contract_service.c.contract_name == contract_name,
			contract_service.c.service_id == service_id
		)
	).fetchone()
	
	if existing:
		flash(f"Serviço '{service.name}' já está vinculado ao contrato '{contract_name}'.", "warning")
	else:
		# Inserir nova relação
		db.session.execute(
			contract_service.insert().values(
				contract_name=contract_name,
				service_id=service_id
			)
		)
		db.session.commit()
		flash(f"Serviço '{service.name}' vinculado ao contrato '{contract_name}' com sucesso!", "success")
	
	return redirect(url_for("contracts.list_contracts"))


@bp.route("/<contract_name>/unlink-service/<int:service_id>", methods=["POST"])
@login_required
def unlink_service_from_contract(contract_name: str, service_id: int):
	"""Remove a vinculação de um serviço de um contrato"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	# Verificar se o serviço existe
	service = Service.query.get(service_id)
	if not service:
		flash("Serviço não encontrado.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	# Remover a relação
	result = db.session.execute(
		contract_service.delete().where(
			contract_service.c.contract_name == contract_name,
			contract_service.c.service_id == service_id
		)
	)
	
	if result.rowcount > 0:
		db.session.commit()
		flash(f"Serviço '{service.name}' desvinculado do contrato '{contract_name}' com sucesso!", "success")
	else:
		flash(f"Serviço '{service.name}' não estava vinculado ao contrato '{contract_name}'.", "warning")
	
	return redirect(url_for("contracts.list_contracts"))


@bp.route("/<contract_name>/services", methods=["POST"])
@login_required
def update_contract_services(contract_name: str):
	"""Atualiza todos os serviços de um contrato de uma vez"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	service_ids = request.form.getlist("service_ids", type=int)
	
	# Remover todas as relações existentes para este contrato
	db.session.execute(
		contract_service.delete().where(
			contract_service.c.contract_name == contract_name
		)
	)
	
	# Adicionar as novas relações
	for service_id in service_ids:
		# Verificar se o serviço existe
		service = Service.query.get(service_id)
		if service:
			db.session.execute(
				contract_service.insert().values(
					contract_name=contract_name,
					service_id=service_id
				)
			)
	
	db.session.commit()
	flash(f"Serviços do contrato '{contract_name}' atualizados com sucesso!", "success")
	
	return redirect(url_for("contracts.list_contracts"))


@bp.route("/<contract_name>/gerenciar")
@login_required
def manage_contract(contract_name: str):
	"""Página de gerenciamento completo de um contrato"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	# Buscar dados do contrato
	contract_clients = get_clients_by_contract(contract_name)
	contract_services = get_services_for_contract(contract_name)
	all_services = Service.query.order_by(Service.name.asc()).all()
	all_clients = fetch_external_clients()
	
	# Mesclar detalhes do contrato de cada cliente (produto, datas, valor, status)
	details_by_client = {
		r.external_client_id: r.to_dict()
		for r in ClientContract.query.filter_by(contract_name=contract_name).all()
	}
	for client in contract_clients:
		client["contract_details"] = details_by_client.get(client.get("id"))
	
	# Ordenar: vencidos primeiro, depois vencendo, depois demais (por nome)
	def _sort_key(client):
		details = client.get("contract_details") or {}
		priority = {"vencido": 0, "vencendo": 1}.get(details.get("display_status"), 2)
		return (priority, (client.get("name") or "").lower())
	contract_clients.sort(key=_sort_key)
	
	# Produtos já usados (autocomplete do modal de detalhes)
	suggested_products = [
		r[0] for r in db.session.query(ClientContract.product).filter(
			ClientContract.product.isnot(None), ClientContract.product != ""
		).distinct().order_by(ClientContract.product.asc()).all()
	]
	
	return render_template("contracts/manage.html",
		contract_name=contract_name,
		contract_clients=contract_clients,
		contract_services=contract_services,
		all_services=all_services,
		all_clients=all_clients,
		suggested_products=suggested_products
	)


@bp.route("/criar", methods=["GET", "POST"])
@login_required
def create_contract():
	"""Criar novo contrato"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem criar contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	if request.method == "POST":
		contract_name = request.form.get("contract_name", "").strip()
		client_ids = request.form.getlist("client_ids", type=int)
		no_charge = request.form.get("no_charge") == "on"
		
		if not contract_name:
			flash("Nome do contrato é obrigatório.", "error")
			return redirect(url_for("contracts.create_contract"))
		
		try:
			# Verificar se contrato já existe
			existing_contracts = fetch_contract_types()
			if contract_name in existing_contracts:
				flash(f"Contrato '{contract_name}' já existe.", "error")
				return redirect(url_for("contracts.create_contract"))
			
			# Atribuir clientes ao contrato
			if client_ids:
				added_count = 0
				for client_id in client_ids:
					if add_client_to_contract(client_id, contract_name):
						added_count += 1
						_get_or_create_client_contract(contract_name, client_id)
				db.session.commit()
				flash(f"Contrato '{contract_name}' criado com sucesso! {added_count} cliente(s) atribuído(s).", "success")
			else:
				flash(f"Contrato '{contract_name}' criado com sucesso!", "success")
			
			return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
			
		except Exception as e:
			flash(f"Erro ao criar contrato: {str(e)}", "error")
			return redirect(url_for("contracts.create_contract"))
	
	all_clients = fetch_external_clients()
	return render_template("contracts/create.html", all_clients=all_clients)


@bp.route("/<contract_name>/editar", methods=["GET", "POST"])
@login_required
def edit_contract(contract_name: str):
	"""Editar contrato existente"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem editar contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	if request.method == "POST":
		new_name = request.form.get("new_name", "").strip()
		no_charge = request.form.get("no_charge") == "on"
		
		if not new_name:
			flash("Nome do contrato é obrigatório.", "error")
			return redirect(url_for("contracts.edit_contract", contract_name=contract_name))
		
		if new_name == contract_name:
			# Apenas atualizar flag no_charge
			try:
				affected = update_contract_type(contract_name, contract_name, no_charge)
				flash(f"Contrato '{contract_name}' atualizado com sucesso! {affected} cliente(s) afetado(s).", "success")
			except Exception as e:
				flash(f"Erro ao atualizar contrato: {str(e)}", "error")
		else:
			# Renomear contrato
			try:
				affected = update_contract_type(contract_name, new_name, no_charge)
				# Atualizar detalhes por cliente e vínculos de serviços para o novo nome
				ClientContract.query.filter_by(contract_name=contract_name).update(
					{"contract_name": new_name}
				)
				db.session.execute(
					contract_service.update().where(
						contract_service.c.contract_name == contract_name
					).values(contract_name=new_name)
				)
				db.session.commit()
				flash(f"Contrato renomeado de '{contract_name}' para '{new_name}' com sucesso! {affected} cliente(s) afetado(s).", "success")
				return redirect(url_for("contracts.manage_contract", contract_name=new_name))
			except Exception as e:
				db.session.rollback()
				flash(f"Erro ao renomear contrato: {str(e)}", "error")
		
		return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
	
	# Buscar clientes do contrato para mostrar informações
	contract_clients = fetch_clients_by_contract_type(contract_name)
	return render_template("contracts/edit.html", 
		contract_name=contract_name, 
		contract_clients=contract_clients
	)


@bp.route("/<contract_name>/excluir", methods=["POST"])
@login_required
def delete_contract(contract_name: str):
	"""Excluir contrato"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem excluir contratos.", "error")
		return redirect(url_for("contracts.list_contracts"))
	
	try:
		affected = remove_contract_from_all_clients(contract_name)
		# Remover detalhes por cliente e vínculos de serviços do contrato
		ClientContract.query.filter_by(contract_name=contract_name).delete()
		db.session.execute(
			contract_service.delete().where(
				contract_service.c.contract_name == contract_name
			)
		)
		db.session.commit()
		flash(f"Contrato '{contract_name}' excluído com sucesso! {affected} cliente(s) afetado(s).", "success")
	except Exception as e:
		db.session.rollback()
		flash(f"Erro ao excluir contrato: {str(e)}", "error")
	
	return redirect(url_for("contracts.list_contracts"))


@bp.route("/buscar-clientes-para-criacao", methods=["GET"])
@login_required
def search_clients_for_contract_creation():
	"""Buscar clientes para criação de contrato via AJAX com ILIKE"""
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem gerenciar contratos."}), 403
	
	try:
		search_term = request.args.get("q", "").strip()
		
		# Buscar todos os clientes disponíveis usando ILIKE
		from ..external_pg import search_all_clients
		available_clients = search_all_clients(search_term)
		
		# Formatar resposta
		clients_data = []
		for client in available_clients:
			clients_data.append({
				"id": client.get("id"),
				"name": client.get("name", ""),
				"document": client.get("document", ""),
				"phone": client.get("phone", ""),
				"email": client.get("email", "")
			})
		
		return jsonify({
			"clients": clients_data,
			"total": len(clients_data),
			"search_term": search_term
		})
		
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar clientes: {str(e)}"}), 500


@bp.route("/<contract_name>/buscar-clientes", methods=["GET"])
@login_required
def search_clients_for_contract(contract_name: str):
	"""Buscar clientes para adicionar ao contrato via AJAX com ILIKE"""
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas administradores podem gerenciar contratos."}), 403
	
	try:
		search_term = request.args.get("q", "").strip()
		
		# Buscar clientes que não estão no contrato usando ILIKE
		from ..external_pg import search_clients_not_in_contract
		available_clients = search_clients_not_in_contract(contract_name, search_term)
		
		# Formatar resposta
		clients_data = []
		for client in available_clients:
			clients_data.append({
				"id": client.get("id"),
				"name": client.get("name", ""),
				"document": client.get("document", ""),
				"phone": client.get("phone", ""),
				"email": client.get("email", "")
			})
		
		return jsonify({
			"clients": clients_data,
			"total": len(clients_data),
			"search_term": search_term
		})
		
	except Exception as e:
		return jsonify({"error": f"Erro ao buscar clientes: {str(e)}"}), 500


@bp.route("/<contract_name>/adicionar-clientes", methods=["POST"])
@login_required
def add_clients_to_contract_route(contract_name: str):
	"""Adicionar clientes a um contrato existente"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
	
	client_ids = request.form.getlist("client_ids", type=int)
	
	if not client_ids:
		flash("Selecione pelo menos um cliente.", "error")
		return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
	
	try:
		added_count = 0
		for client_id in client_ids:
			if add_client_to_contract(client_id, contract_name):
				added_count += 1
				_get_or_create_client_contract(contract_name, client_id)
		db.session.commit()
		
		if added_count > 0:
			flash(f"{added_count} cliente(s) adicionado(s) ao contrato '{contract_name}' com sucesso!", "success")
		else:
			flash("Nenhum cliente foi adicionado.", "error")
	except Exception as e:
		db.session.rollback()
		flash(f"Erro ao adicionar clientes: {str(e)}", "error")
	
	return redirect(url_for("contracts.manage_contract", contract_name=contract_name))


@bp.route("/<contract_name>/remover-cliente/<int:client_id>", methods=["POST"])
@login_required
def remove_client_from_contract_route(contract_name: str, client_id: int):
	"""Remover um cliente específico de um contrato"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
	
	try:
		# Buscar dados do cliente para confirmar que existe
		all_clients = fetch_external_clients()
		client = next((c for c in all_clients if c.get("id") == client_id), None)
		
		if client:
			# Remover cliente do contrato usando a nova função
			success = remove_client_from_contract(client_id, contract_name)
			if success:
				# Remover também os detalhes do contrato deste cliente
				ClientContract.query.filter_by(
					contract_name=contract_name, external_client_id=client_id
				).delete()
				db.session.commit()
				flash(f"Cliente '{client.get('name', 'N/A')}' removido do contrato '{contract_name}' com sucesso!", "success")
			else:
				flash("Erro ao remover cliente do contrato.", "error")
		else:
			flash("Cliente não encontrado.", "error")
			
	except Exception as e:
		flash(f"Erro ao remover cliente: {str(e)}", "error")

	return redirect(url_for("contracts.manage_contract", contract_name=contract_name))


@bp.route("/<contract_name>/cliente/<int:client_id>/detalhes", methods=["GET"])
@login_required
def get_client_contract_details(contract_name: str, client_id: int):
	"""API para buscar os detalhes do contrato de um cliente específico"""
	record = ClientContract.query.filter_by(
		contract_name=contract_name, external_client_id=client_id
	).first()
	
	if record:
		return jsonify({"success": True, "details": record.to_dict()})
	
	return jsonify({
		"success": True,
		"details": {
			"contract_name": contract_name,
			"external_client_id": client_id,
			"product": "",
			"start_date": "",
			"end_date": "",
			"value": None,
			"status": "ativo",
			"display_status": "ativo",
			"days_to_expire": None,
			"notes": "",
		}
	})


@bp.route("/<contract_name>/cliente/<int:client_id>/detalhes", methods=["POST"])
@login_required
def save_client_contract_details(contract_name: str, client_id: int):
	"""Salva/atualiza os detalhes do contrato de um cliente (produto, datas, valor, status)"""
	if not current_user.has_role("admin"):
		flash("Apenas administradores podem gerenciar contratos.", "error")
		return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
	
	try:
		client_name = (request.form.get("client_name") or "").strip() or None
		record = _get_or_create_client_contract(contract_name, client_id, client_name)
		
		record.product = (request.form.get("product") or "").strip() or None
		record.start_date = _parse_date(request.form.get("start_date"))
		record.end_date = _parse_date(request.form.get("end_date"))
		
		value_raw = (request.form.get("value") or "").strip().replace(",", ".")
		record.value = float(value_raw) if value_raw else None
		
		status = (request.form.get("status") or "ativo").strip().lower()
		record.status = status if status in ("ativo", "cancelado") else "ativo"
		
		record.notes = (request.form.get("notes") or "").strip() or None
		
		if record.start_date and record.end_date and record.end_date < record.start_date:
			db.session.rollback()
			flash("A data de vencimento não pode ser anterior à data de contratação.", "error")
			return redirect(url_for("contracts.manage_contract", contract_name=contract_name))
		
		db.session.commit()
		flash(f"Detalhes do contrato de '{record.external_client_name or client_id}' salvos com sucesso!", "success")
	except ValueError:
		db.session.rollback()
		flash("Valor do contrato inválido.", "error")
	except Exception as e:
		db.session.rollback()
		flash(f"Erro ao salvar detalhes do contrato: {str(e)}", "error")
	
	return redirect(url_for("contracts.manage_contract", contract_name=contract_name))


@bp.route("/produtos-sugeridos", methods=["GET"])
@login_required
def get_suggested_products():
	"""Lista de produtos distintos já usados em contratos (para autocomplete)"""
	rows = db.session.query(ClientContract.product).filter(
		ClientContract.product.isnot(None), ClientContract.product != ""
	).distinct().order_by(ClientContract.product.asc()).all()
	return jsonify({"products": [r[0] for r in rows]})