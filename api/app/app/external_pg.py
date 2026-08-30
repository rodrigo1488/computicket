from typing import List, Dict, Any, Iterable

try:
	import psycopg2
except ImportError:
	psycopg2 = None

PG_UNAVAILABLE = "PostgreSQL indisponível: o pacote psycopg2 não está instalado neste ambiente."


class ExternalPgError(RuntimeError):
	"""Falha ao alcançar o Postgres Unico (leituras diretas da API)."""


def _pg_params() -> dict:
	"""Host/credenciais via SystemConfig (Configurações → Uniplus). Sem .env."""
	from .uniplus_jobs import get_unico_pg_config
	return get_unico_pg_config()


def _via_agent(job_type: str, payload: dict, *, timeout: float = 60.0) -> dict:
	from .uniplus_jobs import agent_enabled, enqueue_and_wait
	if not agent_enabled():
		return None  # type: ignore
	return enqueue_and_wait(job_type, payload, timeout=timeout)


def _require_pg():
	if psycopg2 is None:
		raise RuntimeError(PG_UNAVAILABLE)


def _pg_connect(*, connect_timeout: int | None = None):
	_require_pg()
	cfg = _pg_params()
	host = (cfg.get("host") or "").strip()
	if not host:
		raise ExternalPgError(
			"Postgres Unico não configurado. Em Configurações → Uniplus, informe o host "
			"(e usuário/senha) usado pela API para leituras e fallback legado."
		)
	timeout = connect_timeout if connect_timeout is not None else int(cfg.get("connect_timeout") or 5)
	try:
		return psycopg2.connect(
			host=host,
			port=int(cfg.get("port") or 5432),
			dbname=(cfg.get("database") or "unico").strip() or "unico",
			user=(cfg.get("user") or "").strip(),
			password=cfg.get("password") or "",
			connect_timeout=timeout,
		)
	except ExternalPgError:
		raise
	except Exception as e:
		db_name = (cfg.get("database") or "unico").strip() or "unico"
		port = int(cfg.get("port") or 5432)
		raise ExternalPgError(
			f"Não foi possível conectar ao PostgreSQL Unico em {host}:{port}/{db_name}. "
			f"Leituras (lista de clientes) vão direto da API — confira Configurações → Uniplus "
			f"(host/rede/firewall). Detalhe: {e}"
		) from e

SQL_ENTIDADES_BASE = """
select id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra9, extra10, observacao from entidade e 
"""


def _rows_to_clients(rows, cols) -> List[Dict[str, Any]]:
	result: List[Dict[str, Any]] = []
	for r in rows:
		row = dict(zip(cols, r))
		result.append({
			"id": row.get("id"),
			"name": row.get("nome"),
			"document": row.get("cnpjcpf"),
			"phone": row.get("celular"),
			"email": row.get("email"),
			"address": row.get("endereco"),
			"address_number": row.get("numeroendereco"),
			"contract_type": row.get("extra9"),
			"no_charge": bool(row.get("extra10")) if row.get("extra10") is not None else False,
			"notes": row.get("observacao"),
		})
	return result


def fetch_external_clients() -> List[Dict[str, Any]]:
	if psycopg2 is None:
		raise ExternalPgError(PG_UNAVAILABLE)
	cfg = _pg_params()
	conn = _pg_connect(connect_timeout=3)
	try:
		with conn.cursor() as cur:
			cur.execute(SQL_ENTIDADES_BASE + " WHERE inativo = 0 ORDER BY nome ASC")
			rows = cur.fetchall()
			cols = [desc[0] for desc in cur.description]
			return _rows_to_clients(rows, cols)
	except ExternalPgError:
		raise
	except Exception as e:
		host = cfg.get("host") or "?"
		raise ExternalPgError(f"Erro ao listar clientes no Unico ({host}): {e}") from e
	finally:
		conn.close()


def get_external_client_by_id(client_id: int) -> Dict[str, Any] | None:
	"""Busca um único cliente Unico por id (evita listar toda a base)."""
	if psycopg2 is None:
		raise ExternalPgError(PG_UNAVAILABLE)
	try:
		cid = int(client_id)
	except (TypeError, ValueError) as e:
		raise ExternalPgError("ID de cliente inválido") from e
	conn = _pg_connect(connect_timeout=5)
	try:
		with conn.cursor() as cur:
			cur.execute(
				SQL_ENTIDADES_BASE + " WHERE inativo = 0 AND id = %s",
				(cid,),
			)
			rows = cur.fetchall()
			cols = [desc[0] for desc in cur.description]
			clients = _rows_to_clients(rows, cols)
			return clients[0] if clients else None
	except ExternalPgError:
		raise
	except Exception as e:
		raise ExternalPgError(f"Erro ao buscar cliente #{cid} no Unico: {e}") from e
	finally:
		conn.close()


def get_client_by_email(email: str) -> Dict[str, Any]:
	"""Busca um cliente específico por email"""
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				SQL_ENTIDADES_BASE + " WHERE inativo = 0 AND LOWER(email) = LOWER(%s)",
				(email,)
			)
			rows = cur.fetchall()
			cols = [desc[0] for desc in cur.description]
			clients = _rows_to_clients(rows, cols)
			return clients[0] if clients else None
	finally:
		conn.close()


def fetch_external_clients_search(q: str) -> List[Dict[str, Any]]:
	pattern = f"%{q}%"
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				SQL_ENTIDADES_BASE +
				" WHERE inativo = 0 AND (nome ILIKE %s OR cnpjcpf ILIKE %s OR celular ILIKE %s OR email ILIKE %s OR endereco ILIKE %s OR CAST(numeroendereco AS TEXT) ILIKE %s OR extra9 ILIKE %s) ORDER BY nome ASC",
				(pattern, pattern, pattern, pattern, pattern, pattern, pattern),
			)
			rows = cur.fetchall()
			cols = [desc[0] for desc in cur.description]
			return _rows_to_clients(rows, cols)
	finally:
		conn.close()


def fetch_ps_financial_records(search: str = "") -> List[Dict[str, Any]]:
	"""Lista lançamentos de PS cuja fonte de verdade é o financeiro do Unico."""
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			params: list[Any] = ["PS%"]
			search_sql = ""
			if search.strip():
				pattern = f"%{search.strip()}%"
				search_sql = """
					AND (
						f.documento ILIKE %s
						OR COALESCE(e.nome, '') ILIKE %s
						OR COALESCE(f.historico, '') ILIKE %s
					)
				"""
				params.extend([pattern, pattern, pattern])
			cur.execute(
				f"""
					SELECT
						f.id,
						f.documento,
						f.identidade,
						COALESCE(e.nome, '') AS client_name,
						f.emissao,
						f.valor,
						f.saldo,
						f.status,
						COALESCE(f.historico, '') AS description
					FROM financeiro f
					LEFT JOIN entidade e ON e.id = f.identidade
					WHERE f.documento ILIKE %s
					{search_sql}
					ORDER BY f.emissao DESC NULLS LAST, f.id DESC
				""",
				params,
			)
			cols = [desc[0] for desc in cur.description]
			return [dict(zip(cols, row)) for row in cur.fetchall()]
	except Exception as e:
		raise ExternalPgError(f"Erro ao listar PS no PostgreSQL Unico: {e}") from e
	finally:
		conn.close()


def fetch_contract_types() -> List[str]:
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT DISTINCT extra9 FROM entidade WHERE inativo = 0 AND extra9 IS NOT NULL AND TRIM(extra9) <> '' ORDER BY extra9 ASC")
			rows = cur.fetchall()
			return [r[0] for r in rows]
	finally:
		conn.close()


def fetch_clients_by_contract_type(contract_type: str) -> List[Dict[str, Any]]:
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			cur.execute(
				SQL_ENTIDADES_BASE + " WHERE inativo = 0 AND extra9 = %s ORDER BY nome ASC",
				(contract_type,),
			)
			rows = cur.fetchall()
			cols = [desc[0] for desc in cur.description]
			return _rows_to_clients(rows, cols)
	finally:
		conn.close()


def _digits_only(value: str | None) -> str:
	return "".join(ch for ch in (value or "") if ch.isdigit())


def _infer_tipopessoa(document: str | None) -> int:
	"""0 = física, 1 = jurídica (padrão Uniplus)."""
	digits = _digits_only(document)
	return 1 if len(digits) >= 14 else 0


def create_external_client(
	name: str,
	document: str = "",
	phone: str = "",
	email: str = "",
	address: str = "",
	address_number: str = "",
	notes: str | None = None,
	*,
	tipopessoa: int | None = None,
) -> Dict[str, Any]:
	"""Insere cliente em `entidade` (Unico). Retorna dict no formato fetch_external_clients."""
	name = (name or "").strip()
	if not name:
		raise ValueError("Nome é obrigatório")

	payload = {
		"name": name,
		"document": document or "",
		"phone": phone or "",
		"email": email or "",
		"address": address or "",
		"address_number": address_number or "",
		"notes": notes or "",
		"tipopessoa": tipopessoa if tipopessoa is not None else _infer_tipopessoa(document),
	}
	via = _via_agent("create_client", payload)
	if via is not None:
		client_id = via.get("id")
		if client_id is not None:
			return {
				"id": int(client_id),
				"name": name,
				"document": document or "",
				"phone": phone or "",
				"email": email or "",
				"address": address or "",
				"address_number": address_number or "",
				"contract_type": None,
				"no_charge": False,
				"notes": notes or "",
			}
		# fallback: agent ok sem id
		return {
			"id": 0,
			"name": name,
			"document": document or "",
			"phone": phone or "",
			"email": email or "",
			"address": address or "",
			"address_number": address_number or "",
			"contract_type": None,
			"no_charge": False,
			"notes": notes or "",
		}

	_require_pg()
	conn = _pg_connect()
	tp = int(payload["tipopessoa"])
	tipocontribuinte = 9 if tp == 0 else 1
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
					document or "",
					phone or "",
					email or "",
					address or "",
					address_number or "",
					notes or "",
					tp,
					tipocontribuinte,
					next_codigo,
					phone or "",
				),
			)
			new_id = int(cur.fetchone()[0])
			conn.commit()
			return {
				"id": new_id,
				"name": name,
				"document": document or "",
				"phone": phone or "",
				"email": email or "",
				"address": address or "",
				"address_number": address_number or "",
				"contract_type": None,
				"no_charge": False,
				"notes": notes or "",
			}
	except Exception:
		conn.rollback()
		raise
	finally:
		conn.close()


def update_external_client(client_id: int, name: str, document: str, phone: str, email: str, address: str, address_number: str, no_charge: bool | None = None, notes: str = None) -> None:
	via = _via_agent("update_client", {
		"client_id": client_id,
		"name": name,
		"document": document,
		"phone": phone,
		"email": email,
		"address": address,
		"address_number": address_number,
		"no_charge": no_charge,
		"notes": notes,
	})
	if via is not None:
		return
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			if no_charge is None:
				cur.execute(
					"""
					UPDATE entidade
					SET nome = %s,
						cnpjcpf = %s,
						celular = %s,
						email = %s,
						endereco = %s,
						numeroendereco = %s,
						observacao = %s
					WHERE id = %s
					""",
					(name, document, phone, email, address, address_number, notes, client_id),
				)
			else:
				cur.execute(
					"""
					UPDATE entidade
					SET nome = %s,
						cnpjcpf = %s,
						celular = %s,
						email = %s,
						endereco = %s,
						numeroendereco = %s,
						extra10 = %s,
						observacao = %s
					WHERE id = %s
					""",
					(name, document, phone, email, address, address_number, 1 if no_charge else 0, notes, client_id),
				)
			conn.commit()
	finally:
		conn.close()


def assign_contract_to_clients(contract_name: str, client_ids: Iterable[int], no_charge: bool | None = None) -> int:
	"""Define extra9=contract_name e opcionalmente extra10 (flag) para todos ids."""
	ids = list(client_ids)
	via = _via_agent("assign_contract", {
		"contract_name": contract_name,
		"client_ids": ids,
		"no_charge": no_charge,
	})
	if via is not None:
		return int(via.get("affected") or 0)
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			if not ids:
				return 0
			if no_charge is None:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE id = ANY(%s)", (contract_name, ids))
			else:
				cur.execute("UPDATE entidade SET extra9 = %s, extra10 = %s WHERE id = ANY(%s)", (contract_name, 1 if no_charge else 0, ids))
			affected = cur.rowcount
			conn.commit()
			return affected
	finally:
		conn.close()


def update_contract_type(old_name: str, new_name: str, no_charge: bool | None = None) -> int:
	"""Atualiza extra9 de old_name para new_name e opcionalmente define extra10 para todos com old_name/new_name. Retorna registros afetados."""
	via = _via_agent("update_contract_type", {
		"old_name": old_name,
		"new_name": new_name,
		"no_charge": no_charge,
	})
	if via is not None:
		return int(via.get("affected") or 0)
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			if no_charge is None:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE extra9 = %s", (new_name, old_name))
			else:
				cur.execute("UPDATE entidade SET extra9 = %s, extra10 = %s WHERE extra9 = %s", (new_name, 1 if no_charge else 0, old_name))
			affected = cur.rowcount
			conn.commit()
			return affected
	finally:
		conn.close()


def add_clients_to_contract(contract_name: str, client_ids: Iterable[int]) -> int:
	"""Adiciona clientes a um contrato existente (define extra9=contract_name para os IDs fornecidos)."""
	ids = list(client_ids)
	via = _via_agent("add_clients_to_contract", {"contract_name": contract_name, "client_ids": ids})
	if via is not None:
		return int(via.get("affected") or 0)
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			if not ids:
				return 0
			
			# Verificar se o contrato existe (se há pelo menos um cliente com esse contrato)
			cur.execute("SELECT COUNT(*) FROM entidade WHERE extra9 = %s", (contract_name,))
			contract_exists = cur.fetchone()[0] > 0
			
			if not contract_exists:
				raise ValueError(f"Contrato '{contract_name}' não existe")
			
			# Adicionar clientes ao contrato
			cur.execute("UPDATE entidade SET extra9 = %s WHERE id = ANY(%s)", (contract_name, ids))
			affected = cur.rowcount
			conn.commit()
			return affected
	finally:
		conn.close()


def remove_contract_from_all_clients(contract_name: str) -> int:
	"""Remove um contrato de todos os clientes (seta extra9=NULL e extra10=NULL para todos os clientes do contrato)."""
	via = _via_agent("remove_contract_from_all", {"contract_name": contract_name})
	if via is not None:
		return int(via.get("affected") or 0)
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			# Primeiro, contar quantos clientes serão afetados
			cur.execute("SELECT COUNT(*) FROM entidade WHERE extra9 = %s", (contract_name,))
			affected = cur.fetchone()[0]
			
			if affected == 0:
				raise ValueError(f"Contrato '{contract_name}' não existe ou não possui clientes")
			
			# Remover o contrato de todos os clientes (setar campos como NULL)
			cur.execute("UPDATE entidade SET extra9 = NULL, extra10 = NULL WHERE extra9 = %s", (contract_name,))
			conn.commit()
			return affected
	finally:
		conn.close()


def get_contracts_with_services(search_term: str = None) -> List[Dict[str, Any]]:
	"""Retorna todos os contratos do PostgreSQL com seus serviços vinculados (do SQLite)"""
	from .models import Service, contract_service

	_require_pg()
	# Buscar todos os tipos de contrato únicos
	contract_types = fetch_contract_types()
	
	result = []
	for contract_name in contract_types:
		# Se há termo de busca, filtrar por nome do contrato
		if search_term and search_term.lower() not in contract_name.lower():
			continue
		
		# Buscar serviços vinculados a este contrato
		services = Service.query.join(contract_service).filter(
			contract_service.c.contract_name == contract_name
		).all()
		
		# Se há termo de busca e não encontrou pelo nome do contrato,
		# verificar se algum cliente do contrato corresponde ao termo
		if search_term and search_term.lower() not in contract_name.lower():
			# Buscar clientes deste contrato
			contract_clients = fetch_clients_by_contract_type(contract_name)
			client_matches = any(
				search_term.lower() in client.get('name', '').lower() 
				for client in contract_clients
			)
			if not client_matches:
				continue
		
		result.append({
			"name": contract_name,
			"services": [{"id": s.id, "name": s.name, "hourly_rate": s.hourly_rate} for s in services]
		})
	
	return result


def get_services_for_contract(contract_name: str) -> List[Dict[str, Any]]:
	"""Retorna os serviços vinculados a um contrato específico"""
	from .models import Service, contract_service
	
	services = Service.query.join(contract_service).filter(
		contract_service.c.contract_name == contract_name
	).all()
	
	return [{"id": s.id, "name": s.name, "hourly_rate": s.hourly_rate} for s in services]


def add_client_to_contract(client_id: int, contract_name: str) -> bool:
	"""Adiciona um cliente a um contrato: extra9 se vazio, senão acrescenta em extra11 (CSV)."""
	via = _via_agent("add_client_to_contract", {
		"client_id": client_id,
		"contract_name": contract_name,
	})
	if via is not None:
		return bool(via.get("ok"))
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT extra9, extra11 FROM entidade WHERE id = %s", (client_id,))
			result = cur.fetchone()
			if not result:
				return False

			primary_contract = result[0]
			additional_contracts = result[1] or ""

			if not primary_contract:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE id = %s", (contract_name, client_id))
			else:
				contracts_list = [x for x in additional_contracts.split(",") if x] if additional_contracts else []
				if contract_name not in contracts_list and contract_name != primary_contract:
					contracts_list.append(contract_name)
					cur.execute(
						"UPDATE entidade SET extra11 = %s WHERE id = %s",
						(",".join(contracts_list), client_id),
					)

			conn.commit()
			return True
	finally:
		conn.close()


def remove_client_from_contract(client_id: int, contract_name: str | None = None) -> bool:
	"""Remove cliente de um contrato específico, ou de todos se contract_name for None."""
	via = _via_agent("remove_client_from_contract", {
		"client_id": client_id,
		"contract_name": contract_name,
	})
	if via is not None:
		return bool(via.get("ok"))
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			if not contract_name:
				cur.execute("UPDATE entidade SET extra9 = NULL, extra10 = NULL WHERE id = %s", (client_id,))
				affected = cur.rowcount
				conn.commit()
				return affected > 0

			# Verificar contratos do cliente
			cur.execute("SELECT extra9, extra11 FROM entidade WHERE id = %s", (client_id,))
			result = cur.fetchone()
			
			if not result:
				return False
			
			primary_contract = result[0]
			additional_contracts = result[1] or ""
			
			# Se é o contrato principal, mover um contrato adicional para principal se existir
			if primary_contract == contract_name:
				contracts_list = additional_contracts.split(",") if additional_contracts else []
				if contracts_list:
					# Mover primeiro contrato adicional para principal
					new_primary = contracts_list.pop(0)
					new_additional = ",".join(contracts_list) if contracts_list else None
					cur.execute("UPDATE entidade SET extra9 = %s, extra11 = %s WHERE id = %s", 
							   (new_primary, new_additional, client_id))
				else:
					# Remover contrato principal se não há adicionais
					cur.execute("UPDATE entidade SET extra9 = NULL WHERE id = %s", (client_id,))
			else:
				# Remover de contratos adicionais
				contracts_list = additional_contracts.split(",") if additional_contracts else []
				if contract_name in contracts_list:
					contracts_list.remove(contract_name)
					new_contracts = ",".join(contracts_list) if contracts_list else None
					cur.execute("UPDATE entidade SET extra11 = %s WHERE id = %s", (new_contracts, client_id))
			
			conn.commit()
			return True
	finally:
		conn.close()


def search_clients_not_in_contract(contract_name: str, search_term: str = "") -> List[Dict[str, Any]]:
	"""Busca clientes que não estão em um contrato específico usando ILIKE"""
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			# Query base para clientes que não estão no contrato (nem em extra9 nem em extra11)
			base_query = """
				SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra10, extra9, extra11, observacao
				FROM entidade 
				WHERE (extra9 IS NULL OR extra9 != %s)
				AND (extra11 IS NULL OR extra11 NOT LIKE %s)
				AND nome IS NOT NULL 
				AND nome != ''
				AND inativo = 0
			"""
			params = [contract_name, f"%{contract_name}%"]
			
			# Adicionar filtro de busca se fornecido
			if search_term and len(search_term.strip()) > 0:
				search_term = f"%{search_term.strip()}%"
				base_query += " AND (nome ILIKE %s OR cnpjcpf ILIKE %s)"
				params.extend([search_term, search_term])
			
			# Ordenar por nome e limitar resultados
			base_query += " ORDER BY nome ASC LIMIT 50"
			
			cur.execute(base_query, params)
			rows = cur.fetchall()
			
			# Converter para lista de dicionários
			clients = []
			for row in rows:
				clients.append({
					"id": row[0],
					"name": row[1] or "",
					"document": row[2] or "",
					"phone": row[3] or "",
					"email": row[4] or "",
					"address": row[5] or "",
					"address_number": row[6] or "",
					"no_charge": bool(row[7]) if row[7] is not None else False,
					"primary_contract": row[8] or "",
					"additional_contracts": row[9] or "",
					"notes": row[10] or ""
				})
			
			return clients
	finally:
		conn.close()


def search_all_clients(search_term: str = "") -> List[Dict[str, Any]]:
	"""Busca todos os clientes disponíveis usando ILIKE"""
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			# Query base para todos os clientes
			base_query = """
				SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra10, extra9, extra11, observacao
				FROM entidade 
				WHERE nome IS NOT NULL 
				AND nome != ''
				AND inativo = 0
			"""
			params = []
			
			# Adicionar filtro de busca se fornecido
			if search_term and len(search_term.strip()) > 0:
				search_term = f"%{search_term.strip()}%"
				base_query += " AND (nome ILIKE %s OR cnpjcpf ILIKE %s)"
				params.extend([search_term, search_term])
			
			# Ordenar por nome e limitar resultados
			base_query += " ORDER BY nome ASC LIMIT 50"
			
			cur.execute(base_query, params)
			rows = cur.fetchall()
			
			# Converter para lista de dicionários
			clients = []
			for row in rows:
				clients.append({
					"id": row[0],
					"name": row[1] or "",
					"document": row[2] or "",
					"phone": row[3] or "",
					"email": row[4] or "",
					"address": row[5] or "",
					"address_number": row[6] or "",
					"no_charge": bool(row[7]) if row[7] is not None else False,
					"primary_contract": row[8] or "",
					"additional_contracts": row[9] or "",
					"notes": row[10] or ""
				})
			
			return clients
	finally:
		conn.close()


def get_clients_by_contract(contract_name: str) -> List[Dict[str, Any]]:
	"""Busca clientes que pertencem a um contrato específico (extra9 ou extra11)"""
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			cur.execute("""
				SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco, extra10, extra9, extra11, observacao
				FROM entidade 
				WHERE (extra9 = %s OR extra11 LIKE %s)
				AND nome IS NOT NULL 
				AND nome != ''
				AND inativo = 0
				ORDER BY nome ASC
			""", (contract_name, f"%{contract_name}%"))
			
			rows = cur.fetchall()
			clients = []
			for row in rows:
				clients.append({
					"id": row[0],
					"name": row[1] or "",
					"document": row[2] or "",
					"phone": row[3] or "",
					"email": row[4] or "",
					"address": row[5] or "",
					"address_number": row[6] or "",
					"no_charge": bool(row[7]) if row[7] is not None else False,
					"primary_contract": row[8] or "",
					"additional_contracts": row[9] or "",
					"notes": row[10] or ""
				})
			
			return clients
	finally:
		conn.close()


def client_has_contract_for_service(client_id: int, service_id: int) -> bool:
	"""Verifica se um cliente tem um contrato que contempla um serviço específico"""
	from .models import contract_service
	from . import db
	
	# Buscar contratos do cliente no PostgreSQL
	conn = _pg_connect()
	try:
		with conn.cursor() as cur:
			# Buscar contratos do cliente (extra9 e extra11)
			cur.execute("SELECT extra9, extra11 FROM entidade WHERE id = %s AND inativo = 0", (client_id,))
			result = cur.fetchone()
			
			if not result:
				return False
			
			primary_contract = result[0]
			additional_contracts = result[1] or ""
			
			# Lista de todos os contratos do cliente
			client_contracts = []
			if primary_contract:
				client_contracts.append(primary_contract)
			if additional_contracts:
				client_contracts.extend(additional_contracts.split(","))
			
			# Verificar se algum contrato contempla o serviço (usando SQLite)
			for contract_name in client_contracts:
				contract_name = contract_name.strip()
				if contract_name:
					# Verificar se o serviço está vinculado a este contrato na tabela SQLite
					from sqlalchemy import text
					result = db.session.execute(
						text("SELECT COUNT(*) FROM contract_service WHERE contract_name = :contract_name AND service_id = :service_id"),
						{"contract_name": contract_name, "service_id": service_id}
					).fetchone()
					
					if result and result[0] > 0:
						return True
			
			return False
	finally:
		conn.close()