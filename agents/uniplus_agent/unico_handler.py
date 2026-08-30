"""Executa jobs de escrita no Postgres Unico."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import db as local_db

try:
	import psycopg2
	from psycopg2.extras import RealDictCursor
except ImportError:
	psycopg2 = None
	RealDictCursor = None


class UniplusPermanentError(Exception):
	"""Erro que o SaaS não deve retentar."""


class UniplusOperationalError(Exception):
	"""Erro transitório (rede, lock, etc.)."""


def _connect():
	if psycopg2 is None:
		raise UniplusPermanentError("psycopg2 não instalado no agente")
	return psycopg2.connect(
		host=local_db.get_config("pg_host", "127.0.0.1"),
		port=int(local_db.get_config("pg_port", "5432") or 5432),
		dbname=local_db.get_config("pg_db", "unico"),
		user=local_db.get_config("pg_user", "postgres"),
		password=local_db.get_config("pg_password", "postgres"),
		connect_timeout=10,
	)


def handle(job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
	handlers = {
		"create_client": _create_client,
		"update_client": _update_client,
		"assign_contract": _assign_contract,
		"add_client_to_contract": _add_client_to_contract,
		"remove_client_from_contract": _remove_client_from_contract,
		"update_contract_type": _update_contract_type,
		"remove_contract_from_all": _remove_contract_from_all,
		"add_clients_to_contract": _add_clients_to_contract,
		"insert_finance_ps": _insert_finance_ps,
		"delete_finance_ps": _delete_finance_ps,
		"create_dav": _create_dav,
		"insert_finance_avulso": _insert_finance_avulso,
		"cancel_finance_avulso": _cancel_finance_avulso,
		"finalize_ordemservico": _finalize_ordemservico,
	}
	fn = handlers.get(job_type)
	if not fn:
		raise UniplusPermanentError(f"job_type desconhecido: {job_type}")
	try:
		return fn(payload or {})
	except (UniplusPermanentError, UniplusOperationalError):
		raise
	except Exception as e:
		msg = str(e).lower()
		if any(x in msg for x in ("could not connect", "timeout", "connection refused", "server closed")):
			raise UniplusOperationalError(str(e)) from e
		raise UniplusPermanentError(str(e)) from e


def _create_client(p: dict) -> dict:
	name = (p.get("name") or "").strip()
	if not name:
		raise UniplusPermanentError("Nome é obrigatório")
	document = p.get("document") or ""
	digits = "".join(ch for ch in document if ch.isdigit())
	tp = p.get("tipopessoa")
	if tp is None:
		tp = 1 if len(digits) >= 14 else 0
	else:
		tp = int(tp)
	tipocontribuinte = 9 if tp == 0 else 1
	phone = p.get("phone") or ""
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				"""
				SELECT COALESCE(MAX(NULLIF(codigo, '')::bigint), 0) + 1
				FROM entidade
				WHERE codigo ~ '^[0-9]+$'
				"""
			)
			next_codigo = str(cur.fetchone()[0])
			cur.execute(
				"""
				INSERT INTO entidade (
					nome, cnpjcpf, celular, email, endereco, numeroendereco, observacao,
					tipopessoa, cliente, fornecedor, inativo,
					idfilialcadastro, idpais, idestado, tipocontribuinte, destacaricmsst,
					datacadastro, codigo, whatsapp
				) VALUES (
					%s, %s, %s, %s, %s, %s, %s,
					%s, 1, 0, 0,
					1, 31, 18, %s, 1,
					CURRENT_DATE, %s, %s
				)
				RETURNING id
				""",
				(
					name,
					document,
					phone,
					p.get("email") or "",
					p.get("address") or "",
					p.get("address_number") or "",
					p.get("notes") or "",
					tp,
					tipocontribuinte,
					next_codigo,
					phone,
				),
			)
			new_id = int(cur.fetchone()[0])
			conn.commit()
			return {"id": new_id, "codigo": next_codigo}
	except Exception:
		conn.rollback()
		raise
	finally:
		conn.close()


def _update_client(p: dict) -> dict:
	client_id = int(p["client_id"])
	conn = _connect()
	try:
		with conn.cursor() as cur:
			no_charge = p.get("no_charge")
			if no_charge is None:
				cur.execute(
					"""
					UPDATE entidade
					SET nome = %s, cnpjcpf = %s, celular = %s, email = %s,
						endereco = %s, numeroendereco = %s, observacao = %s
					WHERE id = %s
					""",
					(
						p.get("name"), p.get("document"), p.get("phone"), p.get("email"),
						p.get("address"), p.get("address_number"), p.get("notes"), client_id,
					),
				)
			else:
				cur.execute(
					"""
					UPDATE entidade
					SET nome = %s, cnpjcpf = %s, celular = %s, email = %s,
						endereco = %s, numeroendereco = %s, extra10 = %s, observacao = %s
					WHERE id = %s
					""",
					(
						p.get("name"), p.get("document"), p.get("phone"), p.get("email"),
						p.get("address"), p.get("address_number"),
						1 if no_charge else 0, p.get("notes"), client_id,
					),
				)
			conn.commit()
			return {"affected": cur.rowcount}
	finally:
		conn.close()


def _assign_contract(p: dict) -> dict:
	ids = [int(x) for x in (p.get("client_ids") or [])]
	name = p.get("contract_name") or ""
	no_charge = p.get("no_charge")
	if not ids:
		return {"affected": 0}
	conn = _connect()
	try:
		with conn.cursor() as cur:
			if no_charge is None:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE id = ANY(%s)", (name, ids))
			else:
				cur.execute(
					"UPDATE entidade SET extra9 = %s, extra10 = %s WHERE id = ANY(%s)",
					(name, 1 if no_charge else 0, ids),
				)
			affected = cur.rowcount
			conn.commit()
			return {"affected": affected}
	finally:
		conn.close()


def _add_clients_to_contract(p: dict) -> dict:
	ids = [int(x) for x in (p.get("client_ids") or [])]
	name = p.get("contract_name") or ""
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT COUNT(*) FROM entidade WHERE extra9 = %s", (name,))
			if cur.fetchone()[0] == 0:
				raise UniplusPermanentError(f"Contrato '{name}' não existe")
			cur.execute("UPDATE entidade SET extra9 = %s WHERE id = ANY(%s)", (name, ids))
			affected = cur.rowcount
			conn.commit()
			return {"affected": affected}
	finally:
		conn.close()


def _update_contract_type(p: dict) -> dict:
	old_name = p.get("old_name") or ""
	new_name = p.get("new_name") or ""
	no_charge = p.get("no_charge")
	conn = _connect()
	try:
		with conn.cursor() as cur:
			if no_charge is None:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE extra9 = %s", (new_name, old_name))
			else:
				cur.execute(
					"UPDATE entidade SET extra9 = %s, extra10 = %s WHERE extra9 = %s",
					(new_name, 1 if no_charge else 0, old_name),
				)
			affected = cur.rowcount
			conn.commit()
			return {"affected": affected}
	finally:
		conn.close()


def _remove_contract_from_all(p: dict) -> dict:
	name = p.get("contract_name") or ""
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT COUNT(*) FROM entidade WHERE extra9 = %s", (name,))
			affected = cur.fetchone()[0]
			if affected == 0:
				raise UniplusPermanentError(f"Contrato '{name}' não existe ou não possui clientes")
			cur.execute("UPDATE entidade SET extra9 = NULL, extra10 = NULL WHERE extra9 = %s", (name,))
			conn.commit()
			return {"affected": affected}
	finally:
		conn.close()


def _add_client_to_contract(p: dict) -> dict:
	client_id = int(p["client_id"])
	contract_name = p.get("contract_name") or ""
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT extra9, extra11 FROM entidade WHERE id = %s", (client_id,))
			row = cur.fetchone()
			if not row:
				raise UniplusPermanentError(f"Cliente {client_id} não encontrado")
			primary, additional = row[0], row[1] or ""
			if not primary:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE id = %s", (contract_name, client_id))
			else:
				lst = [x for x in additional.split(",") if x] if additional else []
				if contract_name not in lst and contract_name != primary:
					lst.append(contract_name)
					cur.execute("UPDATE entidade SET extra11 = %s WHERE id = %s", (",".join(lst), client_id))
			conn.commit()
			return {"ok": True}
	finally:
		conn.close()


def _remove_client_from_contract(p: dict) -> dict:
	client_id = int(p["client_id"])
	contract_name = p.get("contract_name")
	conn = _connect()
	try:
		with conn.cursor() as cur:
			if not contract_name:
				cur.execute("UPDATE entidade SET extra9 = NULL, extra10 = NULL WHERE id = %s", (client_id,))
				conn.commit()
				return {"ok": cur.rowcount > 0}

			cur.execute("SELECT extra9, extra11 FROM entidade WHERE id = %s", (client_id,))
			row = cur.fetchone()
			if not row:
				return {"ok": False}
			primary, additional = row[0], row[1] or ""
			if primary == contract_name:
				lst = [x for x in additional.split(",") if x] if additional else []
				if lst:
					new_primary = lst.pop(0)
					new_add = ",".join(lst) if lst else None
					cur.execute(
						"UPDATE entidade SET extra9 = %s, extra11 = %s WHERE id = %s",
						(new_primary, new_add, client_id),
					)
				else:
					cur.execute("UPDATE entidade SET extra9 = NULL WHERE id = %s", (client_id,))
			else:
				lst = [x for x in additional.split(",") if x] if additional else []
				if contract_name in lst:
					lst.remove(contract_name)
					cur.execute(
						"UPDATE entidade SET extra11 = %s WHERE id = %s",
						(",".join(lst) if lst else None, client_id),
					)
			conn.commit()
			return {"ok": True}
	finally:
		conn.close()


def _insert_finance_ps(p: dict) -> dict:
	id_entidade = int(p["id_entidade"])
	document = p.get("document") or ""
	description = p.get("description_service") or p.get("historico") or ""
	total = float(p.get("total") or 0)
	operation_key = str(p.get("operation_key") or "").strip()
	operation_marker = f"PSOP:{operation_key}" if operation_key else ""
	today = date.today()
	tomorrow = today + timedelta(days=1)
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				"SELECT observacaoboleto FROM financeiro WHERE documento = %s LIMIT 1",
				(document,),
			)
			existing = cur.fetchone()
			if existing:
				existing_note = str(existing[0] or "")
				if operation_marker and operation_marker in existing_note:
					return {"ok": True, "document": document, "replayed": True}
				raise UniplusPermanentError(f"PS_DOCUMENT_CONFLICT:{document}")
			cur.execute(
				"""
				INSERT INTO financeiro (
					idfilial, identidade, tipo, documento, idtipodocumentofinanceiro,
					status, emissao, vencimento, valor, saldo,
					historico, idcodigocontabil, observacaoboleto
				) VALUES (%s, %s, 'R', %s, %s, 'A', %s, %s, %s, %s, %s, 192, %s)
				""",
				(
					1, id_entidade, document, 8,
					today.isoformat(), tomorrow.isoformat(),
					total, total, description,
					f"Avulso|{operation_marker}" if operation_marker else "Avulso",
				),
			)
			conn.commit()
			return {"ok": True, "document": document}
	finally:
		conn.close()


def _delete_finance_ps(p: dict) -> dict:
	document = p.get("document") or p.get("ps_number") or ""
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute("DELETE FROM financeiro WHERE documento = %s", (document,))
			n = cur.rowcount
			conn.commit()
			return {"deleted": n}
	finally:
		conn.close()


def _create_dav(p: dict) -> dict:
	client_id = int(p["client_id"])
	product_details = p.get("product_details") or []
	reference_label = p.get("reference_label") or "Ticket"
	reference_code = str(p.get("reference_code") or "")
	external_user_id = p.get("external_user_id")
	external_rep_id = p.get("external_rep_id")
	technician_name = p.get("technician_name") or ""
	observacao = p.get("observacao") or (
		f"Documento criado através do {reference_label}: {reference_code} pelo técnico {technician_name}"
	)

	if not product_details:
		raise UniplusPermanentError("É necessário pelo menos 1 produto para criar o DAV")

	conn = _connect()
	try:
		with conn.cursor() as cur:
			pattern = f"%{reference_label}: {reference_code}%"
			cur.execute("SELECT id FROM dav WHERE observacao ILIKE %s", (pattern,))
			if cur.fetchone():
				raise UniplusPermanentError(f"DAV já existe para {reference_label} {reference_code}")

			valor_total = 0.0
			for prod in product_details:
				qty = float(prod.get("quantidade") or 0)
				preco = float(prod.get("preco") or 0)
				if qty <= 0:
					raise UniplusPermanentError(f"Quantidade inválida para '{prod.get('nome')}'")
				valor_total += preco * qty

			cur.execute("SELECT COALESCE(MAX(codigo), 0) FROM dav")
			next_codigo = int(cur.fetchone()[0]) + 1

			cur.execute(
				"""
				INSERT INTO dav (
					idfilial, tipodocumento, idcliente, status, valor, data,
					idcondicaopagamento, observacao, idusuario, titulodav, tipofrete,
					codigo, idrepresentante
				) VALUES (
					%s, %s, %s, %s, %s, %s,
					%s, %s, %s, %s, %s, %s, %s
				) RETURNING id, codigo
				""",
				(
					1, 6, client_id, 1, valor_total, date.today().isoformat(),
					1, observacao, external_user_id, "PED. FATURAMENTO", 9,
					next_codigo, external_rep_id,
				),
			)
			row = cur.fetchone()
			if not row:
				raise UniplusPermanentError("Erro ao inserir DAV")
			dav_id, dav_codigo = row[0], row[1]

			contador = 1
			for prod in product_details:
				preco = float(prod.get("preco") or 0)
				qty = float(prod.get("quantidade") or 0)
				cur.execute(
					"""
					INSERT INTO davitem (
						iddav, contador, preco, quantidade, idproduto, total,
						precooriginal, nomeproduto, codigodav
					) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
					""",
					(
						dav_id, contador, preco, qty, prod.get("id"),
						preco * qty, preco, prod.get("nome"), dav_codigo,
					),
				)
				contador += 1

			conn.commit()
			return {"dav_id": dav_id, "dav_codigo": dav_codigo}
	finally:
		conn.close()


def _insert_finance_avulso(p: dict) -> dict:
	client_id = int(p["client_id"])
	product_name = (p.get("product_name") or "").strip()
	quantity = float(p.get("quantity") or 1)
	unit_price = float(p.get("unit_price") or 0)
	idrepresentante = p.get("idrepresentante")
	if not product_name:
		raise UniplusPermanentError("Nome do produto não informado")

	base_name = product_name
	pattern = f"%{base_name}%" if len(base_name) <= 50 else "%venda produto%"
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT COUNT(*) FROM financeiro WHERE documento ILIKE %s", (pattern,))
			seq_num = (cur.fetchone()[0] or 0) + 1
			if len(base_name) <= 50:
				doc_name = f"{seq_num} {base_name}"[:60]
			else:
				doc_name = f"{seq_num} venda produto"[:60]
			while True:
				cur.execute("SELECT 1 FROM financeiro WHERE documento = %s", (doc_name,))
				if not cur.fetchone():
					break
				seq_num += 1
				doc_name = (f"{seq_num} {base_name}" if len(base_name) <= 50 else f"{seq_num} venda produto")[:60]

			total_price = round(quantity * unit_price, 2)
			today = date.today()
			tomorrow = today + timedelta(days=1)
			historico = f"{product_name} x {quantity} (R$ {unit_price:.2f})"
			cur.execute(
				"""
				INSERT INTO financeiro (
					idfilial, identidade, tipo, documento, idtipodocumentofinanceiro,
					status, emissao, vencimento,
					valor, saldo, historico, idcodigocontabil, observacaoboleto, idrepresentante
				) VALUES (
					%s, %s, 'R', %s, 8,
					'A', %s, %s,
					%s, %s, %s, 71, 'Avulso', %s
				) RETURNING id
				""",
				(
					1, client_id, doc_name,
					today.isoformat(), tomorrow.isoformat(),
					total_price, total_price, historico, idrepresentante,
				),
			)
			fid = cur.fetchone()[0]
			conn.commit()
			return {"finance_id": fid, "documento": doc_name}
	finally:
		conn.close()


def _cancel_finance_avulso(p: dict) -> dict:
	sale_id = int(p["sale_id"])
	reason = (p.get("reason") or "Não informado").strip()
	today_str = date.today().isoformat()
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				"""
				SELECT id FROM financeiro
				WHERE id = %s AND observacaoboleto = 'Avulso' AND idcodigocontabil = 71
				  AND documento NOT LIKE 'PS%%' AND documento NOT LIKE 'NFSe%%'
				""",
				(sale_id,),
			)
			if not cur.fetchone():
				raise UniplusPermanentError("Lançamento não encontrado ou não é venda avulsa")
			cur.execute(
				"""
				UPDATE financeiro
				SET status = 'C', devolucaodescricao = %s, devolucaocodigo = 1, devolucaodata = %s
				WHERE id = %s
				""",
				(reason, today_str, sale_id),
			)
			conn.commit()
			return {"ok": True}
	finally:
		conn.close()


def _finalize_ordemservico(p: dict) -> dict:
	codigo = p.get("codigo")
	conn = _connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				"""
				UPDATE ordemservico
				SET servicoexecutado = %s, valor = %s, status = %s, fimservico = %s,
					geroufinanceiro = %s, impresso = 1, datahoraimpressao = %s,
					idusuarioentrega = %s, nomeresponsavelretirada = %s,
					descricaoultimoevento = %s, dataultimoevento = %s
				WHERE codigo = %s
				""",
				(
					p.get("servico_executado"),
					float(p.get("valor") or 0),
					int(p.get("status") or 5),
					p.get("fimservico") or datetime.now(),
					1 if float(p.get("valor") or 0) > 0 else 0,
					p.get("datahoraimpressao") or datetime.now(),
					p.get("idusuarioentrega"),
					p.get("nomeresponsavelretirada"),
					p.get("descricaoultimoevento") or f"Ordem de serviço {codigo} finalizada",
					p.get("dataultimoevento") or datetime.now(),
					codigo,
				),
			)
			conn.commit()
			result: dict[str, Any] = {"ok": True, "codigo": codigo}

			# DAV opcional no mesmo payload
			if p.get("create_dav") and p.get("product_details"):
				dav = _create_dav({
					"client_id": p.get("client_id"),
					"product_details": p.get("product_details"),
					"reference_label": "OS",
					"reference_code": str(codigo),
					"external_user_id": p.get("external_user_id"),
					"external_rep_id": p.get("external_rep_id"),
					"technician_name": p.get("nomeresponsavelretirada"),
				})
				result.update(dav)

			# PS financeiro opcional
			if p.get("insert_finance_ps"):
				fin = _insert_finance_ps(p["insert_finance_ps"])
				result["finance"] = fin

			return result
	finally:
		conn.close()
