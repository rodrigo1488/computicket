from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required
from io import TextIOWrapper
import csv
from .. import db
from ..models import Client
from ..external_pg import fetch_external_clients, fetch_external_clients_search, update_external_client, fetch_contract_types

bp = Blueprint("clients", __name__)


@bp.route("/")
@login_required
def list_clients():
	# Busca server-side com ILIKE e ordem alfabética
	q = (request.args.get("q") or "").strip()
	contract_type = (request.args.get("contract_type") or "").strip()
	if q:
		external_clients = fetch_external_clients_search(q)
	else:
		external_clients = fetch_external_clients()
	if contract_type:
		external_clients = [c for c in external_clients if (c.get("contract_type") or "") == contract_type]
	# Paginação
	try:
		page = int(request.args.get("page", 1))
	except Exception:
		page = 1
	try:
		per_page = int(request.args.get("per_page", 25))
	except Exception:
		per_page = 25
	if page < 1:
		page = 1
	if per_page < 1:
		per_page = 25
	total = len(external_clients)
	total_pages = max(1, (total + per_page - 1) // per_page)
	if page > total_pages:
		page = total_pages
	start = (page - 1) * per_page
	end = start + per_page
	items = external_clients[start:end]
	has_prev = page > 1
	has_next = end < total
	try:
		contract_types = fetch_contract_types()
	except Exception:
		contract_types = []
	return render_template(
		"clients/list.html",
		clients=items,
		external=True,
		page=page,
		per_page=per_page,
		total=total,
		total_pages=total_pages,
		has_prev=has_prev,
		has_next=has_next,
		q=q,
		contract_type=contract_type,
		contract_types=contract_types,
	)


@bp.route("/search")
@login_required
def search_clients():
	q = (request.args.get("q") or "").strip()
	limit = int(request.args.get("limit", 18))
	if not q:
		results = fetch_external_clients()[:limit]
	else:
		results = fetch_external_clients_search(q)[:limit]
	print(f"DEBUG: Clientes retornados para a pesquisa: {results}")
	return jsonify(results)


@bp.route("/<int:client_id>/editar", methods=["GET", "POST"])
@login_required
def edit_client(client_id: int):
	clients = fetch_external_clients()
	client = next((c for c in clients if c.get("id") == client_id), None)
	if not client:
		flash("Cliente não encontrado.")
		return redirect(url_for("clients.list_clients"))
	if request.method == "POST":
		name = request.form.get("name")
		document = request.form.get("document")
		phone = request.form.get("phone")
		email = request.form.get("email")
		address = request.form.get("address")
		address_number = request.form.get("address_number")
		notes = request.form.get("notes")
		update_external_client(client_id, name, document, phone, email, address, address_number, notes=notes)
		flash("Cliente atualizado.")
		return redirect(url_for("clients.list_clients"))
	return render_template("clients/edit.html", client=client)


@bp.route("/novo", methods=["GET", "POST"])
@login_required
def create_client():
	# Mantido apenas para compatibilidade, porém ideal é desabilitar quando usando fonte externa
	if request.method == "POST":
		name = request.form.get("name")
		phone = request.form.get("phone")
		document = request.form.get("document")
		contract_type = request.form.get("contract_type")
		c = Client(name=name, phone=phone, document=document, contract_type=contract_type)
		db.session.add(c)
		db.session.commit()
		flash("Cliente criado localmente (fonte externa ativa).")
		return redirect(url_for("clients.list_clients"))
	return render_template("clients/new.html")


@bp.route("/importar", methods=["GET", "POST"])
@login_required
def import_clients():
	# Import local permanece opcional; recomendável usar apenas fonte externa
	if request.method == "POST":
		file = request.files.get("file")
		default_contract_type = request.form.get("contract_type")
		if not file:
			flash("Selecione um arquivo CSV.")
			return redirect(url_for("clients.import_clients"))
		stream = TextIOWrapper(file.stream, encoding="utf-8")
		reader = csv.DictReader(stream)
		count = 0
		for row in reader:
			name = row.get("nome") or row.get("name")
			phone = row.get("telefone") or row.get("phone")
			document = row.get("cpf_cnpj") or row.get("document")
			contract_type = row.get("tipo_contrato") or default_contract_type
			if not name:
				continue
			client = Client(name=name.strip(), phone=(phone or "").strip(), document=(document or "").strip(), contract_type=(contract_type or "").strip())
			db.session.add(client)
			count += 1
		db.session.commit()
		flash(f"Importados {count} clientes localmente (fonte externa ativa).")
		return redirect(url_for("clients.list_clients"))
	return render_template("clients/import.html")
