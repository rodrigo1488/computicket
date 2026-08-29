from typing import List, Dict, Any, Iterable
import psycopg2

PG_HOST = "192.168.2.98"
PG_DB = "unico"
PG_USER = "postgres"
PG_PASSWORD = "postgres"

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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
			cur.execute(SQL_ENTIDADES_BASE + " WHERE inativo = 0 ORDER BY nome ASC")
			rows = cur.fetchall()
			cols = [desc[0] for desc in cur.description]
			return _rows_to_clients(rows, cols)
	finally:
		conn.close()


def get_client_by_email(email: str) -> Dict[str, Any]:
	"""Busca um cliente específico por email"""
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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


def fetch_contract_types() -> List[str]:
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
			cur.execute("SELECT DISTINCT extra9 FROM entidade WHERE inativo = 0 AND extra9 IS NOT NULL AND TRIM(extra9) <> '' ORDER BY extra9 ASC")
			rows = cur.fetchall()
			return [r[0] for r in rows]
	finally:
		conn.close()


def fetch_clients_by_contract_type(contract_type: str) -> List[Dict[str, Any]]:
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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


def update_external_client(client_id: int, name: str, document: str, phone: str, email: str, address: str, address_number: str, no_charge: bool | None = None, notes: str = None) -> None:
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
			ids = list(client_ids)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
			ids = list(client_ids)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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


def remove_client_from_contract(client_id: int) -> bool:
	"""Remove um cliente específico de qualquer contrato (seta extra9=NULL e extra10=NULL)"""
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
			cur.execute("UPDATE entidade SET extra9 = NULL, extra10 = NULL WHERE id = %s", (client_id,))
			affected = cur.rowcount
			conn.commit()
			return affected > 0
	finally:
		conn.close()


def search_clients_not_in_contract(contract_name: str, search_term: str = "") -> List[Dict[str, Any]]:
	"""Busca clientes que não estão em um contrato específico usando ILIKE"""
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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


def add_client_to_contract(client_id: int, contract_name: str) -> bool:
	"""Adiciona um cliente a um contrato, usando extra9 se vazio ou extra11 se já tem contrato"""
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
			# Verificar se o cliente já tem contratos
			cur.execute("SELECT extra9, extra11 FROM entidade WHERE id = %s", (client_id,))
			result = cur.fetchone()
			
			if not result:
				return False
			
			primary_contract = result[0]
			additional_contracts = result[1] or ""
			
			# Se não tem contrato principal, usar extra9
			if not primary_contract:
				cur.execute("UPDATE entidade SET extra9 = %s WHERE id = %s", (contract_name, client_id))
			else:
				# Se já tem contrato principal, adicionar em extra11
				contracts_list = additional_contracts.split(",") if additional_contracts else []
				if contract_name not in contracts_list:
					contracts_list.append(contract_name)
					new_contracts = ",".join(contracts_list)
					cur.execute("UPDATE entidade SET extra11 = %s WHERE id = %s", (new_contracts, client_id))
			
			conn.commit()
			return True
	finally:
		conn.close()


def remove_client_from_contract(client_id: int, contract_name: str) -> bool:
	"""Remove um cliente de um contrato específico"""
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
	try:
		with conn.cursor() as cur:
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


def get_clients_by_contract(contract_name: str) -> List[Dict[str, Any]]:
	"""Busca clientes que pertencem a um contrato específico (extra9 ou extra11)"""
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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
	conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
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