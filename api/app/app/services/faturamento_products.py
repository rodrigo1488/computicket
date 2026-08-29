"""Lógica compartilhada de produtos e DAV (pedido de faturamento) no PostgreSQL."""

from datetime import date, timedelta
from typing import Any

from ..blueprints.utils import connect_postgres

# Mapeamento de usuários locais para IDs do faturamento (PostgreSQL)
# Formato: local_id: (external_user_id, external_rep_id)
USER_MAPPING = {
	1: (1, 161),
	2: (42, 4650),
	3: (35, 4322),
	4: (45, 4713),
	5: (46, 4742),
	6: (34, 4316),
	7: (39, 4423),
	8: (15, 1571),
	9: (1, 161),
	10: (3, 383),
	11: (47, 266),
	12: (48, 4828),
	13: (-1, None),
}


def get_external_user_data(cursor, local_user):
	"""Retorna (user_id, rep_id) do faturamento para um usuário local."""
	mapping = USER_MAPPING.get(local_user.id)
	user_id = None
	rep_id = None

	if mapping:
		user_id, rep_id = mapping
		if rep_id is not None and rep_id > 0:
			return user_id, rep_id

	try:
		nome_busca = local_user.name.strip().upper()

		if not user_id:
			cursor.execute(
				"SELECT id, identidade FROM usuario WHERE (UPPER(nome) = %s OR UPPER(codigo) = %s) AND inativo = '0' LIMIT 1",
				(nome_busca, nome_busca),
			)
			row = cursor.fetchone()
			if row:
				user_id = row[0]
				rep_id = row[1]

		if user_id and (rep_id is None or rep_id == 0):
			cursor.execute("SELECT identidade FROM usuario WHERE id = %s", (user_id,))
			row = cursor.fetchone()
			if row:
				rep_id = row[0]

		if rep_id is None or rep_id == 0:
			cursor.execute(
				"SELECT id FROM entidade WHERE UPPER(nome) LIKE %s LIMIT 1",
				(f"{nome_busca}%",),
			)
			row = cursor.fetchone()
			if row:
				rep_id = row[0]
			elif " " in nome_busca:
				primeiro_nome = nome_busca.split(" ")[0]
				cursor.execute(
					"SELECT id FROM entidade WHERE UPPER(nome) LIKE %s LIMIT 1",
					(f"{primeiro_nome}%",),
				)
				row = cursor.fetchone()
				if row:
					rep_id = row[0]
	except Exception as e:
		print(f"⚠️ Erro no mapeamento dinâmico: {e}")

	return user_id, rep_id


get_external_user_id = get_external_user_data


def search_products(q: str = "") -> list[dict[str, Any]]:
	"""Busca produtos ativos tipo P no PostgreSQL."""
	conn = connect_postgres()
	if not conn:
		raise ConnectionError(
			"Erro de conexão com o banco de faturamento (Postgres Unico). "
			"Confira Configurações → Uniplus — a mesma conexão usada para clientes."
		)

	cursor = conn.cursor()
	try:
		base_sql = (
			"SELECT p.id, p.codigo, p.nome, p.unidademedida, p.preco, COALESCE(s.quantidade, 0) as estoque "
			"FROM produto p "
			"LEFT JOIN saldoestoque s ON s.idproduto = p.id AND s.idfilial = 1 "
			"WHERE p.inativo = '0' AND p.tipo = 'P'"
		)
		params: list[Any] = []
		if q:
			base_sql += " AND (p.nome ILIKE %s OR p.codigo ILIKE %s)"
			like = f"%{q}%"
			params.extend([like, like])
		base_sql += " ORDER BY p.nome ASC LIMIT 50"

		cursor.execute(base_sql, params)
		rows = cursor.fetchall()
		return [
			{
				"id": r[0],
				"codigo": r[1],
				"nome": r[2],
				"unidademedida": r[3],
				"preco": float(r[4]) if r[4] is not None else 0.0,
				"estoque": float(r[5]) if r[5] is not None else 0.0,
			}
			for r in rows
		]
	finally:
		cursor.close()
		conn.close()


def _is_inativo(inativo) -> bool:
	if inativo is None:
		return True
	if isinstance(inativo, bool):
		return inativo
	if isinstance(inativo, (int, float)):
		return inativo != 0
	if isinstance(inativo, str):
		return inativo.strip().upper() not in ("0", "FALSE", "N", "NO", "")
	return True


def _is_tipo_p(tipo) -> bool:
	if tipo is None:
		return False
	if isinstance(tipo, str):
		return tipo.strip().upper() == "P"
	return str(tipo).strip().upper() == "P"


def validate_products(cursor, produtos: list[dict]) -> tuple[list[dict] | None, str | None]:
	"""
	Valida lista [{id, quantidade}] e retorna (product_details, error_message).
	Se produtos vazio, retorna ([], None).
	Produtos avulsos/customizados (com IDs não inteiros ou <= 0) são ignorados na validação de estoque.
	"""
	if not produtos:
		return [], None

	def _parse_id(v):
		try:
			i = int(v)
			return i if i > 0 else 0
		except (ValueError, TypeError):
			return 0

	ids = []
	qty_by_id: dict[int, float] = {}
	for p in produtos:
		if p.get("is_custom"):
			continue
		pid = _parse_id(p.get("id"))
		if pid <= 0:
			continue
		qtd = float(p.get("quantidade", 0))
		if qtd <= 0:
			return None, f"Quantidade inválida para o produto ID {pid}"
		qty_by_id[pid] = qtd
		ids.append(pid)

	if not ids:
		return [], None

	cursor.execute(
		"""
		SELECT p.id, p.codigo, p.nome, p.unidademedida, p.preco, p.inativo, p.tipo, COALESCE(s.quantidade, 0) as estoque
		FROM produto p
		LEFT JOIN saldoestoque s ON s.idproduto = p.id AND s.idfilial = 1
		WHERE p.id = ANY(%s) AND p.inativo = '0' AND p.tipo = 'P'
		""",
		(ids,),
	)
	rows = cursor.fetchall()
	product_details = []
	found_ids: set[int] = set()

	for r in rows:
		inativo = r[5]
		tipo = r[6]
		stock = float(r[7]) if r[7] is not None else 0.0
		requested_qty = qty_by_id.get(r[0], 0.0)

		if requested_qty > stock:
			return None, f"Saldo insuficiente para o produto '{r[2]}'. Disponível: {stock}, Solicitado: {requested_qty}"

		if _is_inativo(inativo) or not _is_tipo_p(tipo):
			return None, f"Produto '{r[2]}' não está ativo ou não é do tipo P"

		product_details.append({
			"id": r[0],
			"codigo": r[1],
			"nome": r[2],
			"unidademedida": r[3],
			"preco": float(r[4]) if r[4] is not None else 0.0,
			"quantidade": requested_qty,
			"estoque": stock,
		})
		found_ids.add(r[0])

	missing = [str(pid) for pid in ids if pid not in found_ids]
	if missing:
		return None, f"Produto(s) inexistente(s): {', '.join(missing)}"

	return product_details, None


def dav_duplicate_pattern(reference_label: str, reference_code: str) -> str:
	return f"%{reference_label}: {reference_code}%"


def check_dav_duplicate(cursor, reference_label: str, reference_code: str) -> bool:
	cursor.execute(
		"SELECT id FROM dav WHERE observacao ILIKE %s",
		(dav_duplicate_pattern(reference_label, reference_code),),
	)
	return cursor.fetchone() is not None


def create_dav(
	cursor,
	*,
	client_id: int,
	reference_label: str,
	reference_code: str,
	product_details: list[dict],
	local_user,
) -> tuple[int, int]:
	"""
	Cria DAV + davitem. Retorna (dav_id, dav_codigo).
	Levanta ValueError em validações de negócio.
	"""
	from ..uniplus_jobs import agent_enabled, enqueue_and_wait

	if not client_id:
		raise ValueError("Cliente não informado. Não é possível criar DAV sem cliente.")

	if not product_details:
		raise ValueError("É necessário pelo menos 1 produto para criar o DAV")

	valor_total_produtos = 0.0
	for p in product_details:
		if p.get("quantidade", 0) <= 0:
			raise ValueError(f"Quantidade inválida para o produto '{p.get('nome', 'N/A')}'")
		preco = float(p.get("preco", 0))
		if preco < 0:
			raise ValueError(f"Preço inválido para o produto '{p.get('nome', 'N/A')}'")
		valor_total_produtos += preco * float(p.get("quantidade", 0))

	if agent_enabled():
		if check_dav_duplicate(cursor, reference_label, reference_code):
			raise ValueError(f"DAV já existe para {reference_label} {reference_code}")
		external_user_id, external_rep_id = get_external_user_data(cursor, local_user)
		result = enqueue_and_wait("create_dav", {
			"client_id": client_id,
			"reference_label": reference_label,
			"reference_code": str(reference_code),
			"product_details": product_details,
			"external_user_id": external_user_id,
			"external_rep_id": external_rep_id,
			"technician_name": getattr(local_user, "name", "") or "",
		})
		return int(result["dav_id"]), int(result["dav_codigo"])

	if check_dav_duplicate(cursor, reference_label, reference_code):
		raise ValueError(f"DAV já existe para {reference_label} {reference_code}")

	external_user_id, external_rep_id = get_external_user_data(cursor, local_user)

	cursor.execute("SELECT COALESCE(MAX(codigo), 0) FROM dav")
	max_codigo = cursor.fetchone()[0]
	next_codigo = int(max_codigo) + 1

	observacao_dav = (
		f"Documento criado através do {reference_label}: {reference_code} "
		f"pelo técnico {local_user.name}"
	)
	cursor.execute(
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
			1,
			6,
			client_id,
			1,
			valor_total_produtos,
			date.today().isoformat(),
			1,
			observacao_dav,
			external_user_id,
			"PED. FATURAMENTO",
			9,
			next_codigo,
			external_rep_id,
		),
	)
	row = cursor.fetchone()
	if not row or not row[0]:
		raise RuntimeError("Erro ao inserir DAV: registro não foi criado")

	dav_id, dav_codigo = row[0], row[1]

	contador = 1
	for p in product_details:
		cursor.execute(
			"""
			INSERT INTO davitem (
				iddav, contador, preco, quantidade, idproduto, total,
				precooriginal, nomeproduto, codigodav
			) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
			""",
			(
				dav_id,
				contador,
				p["preco"],
				p["quantidade"],
				p["id"],
				p["preco"] * p["quantidade"],
				p["preco"],
				p["nome"],
				dav_codigo,
			),
		)
		contador += 1

	return dav_id, dav_codigo


def products_summary(product_details: list[dict]) -> str:
	if not product_details:
		return ""
	resumo = "; ".join(
		[f"{p['nome']} x {p['quantidade']} (R$ {p['preco']:.2f})" for p in product_details]
	)
	return f"Produtos: {resumo}"


def create_out_of_stock_finance_record(
	cursor,
	*,
	client_id: int,
	product_name: str,
	quantity: float,
	unit_price: float,
	idrepresentante: int | None = None,
) -> int:
	"""
	Lança o título a receber no crediário no PostgreSQL para um produto fora de estoque.
	Adiciona um dígito/número sequencial no início do campo documento (ex: '1 produto X', '2 produto X')
	para evitar rejeições de duplicidade no sistema.
	Retorna o ID gerado na tabela financeiro.
	"""
	from ..uniplus_jobs import agent_enabled, enqueue_and_wait

	if not client_id:
		raise ValueError("Cliente não informado para o lançamento do produto fora de estoque.")
	if not product_name:
		raise ValueError("Nome do produto fora de estoque não informado.")

	if agent_enabled():
		result = enqueue_and_wait("insert_finance_avulso", {
			"client_id": int(client_id),
			"product_name": product_name,
			"quantity": quantity,
			"unit_price": unit_price,
			"idrepresentante": idrepresentante,
		})
		return int(result["finance_id"])

	base_name = product_name.strip()
	pattern = f"%{base_name}%" if len(base_name) <= 50 else "%venda produto%"

	cursor.execute("SELECT COUNT(*) FROM financeiro WHERE documento ILIKE %s", (pattern,))
	row = cursor.fetchone()
	seq_num = (row[0] if row else 0) + 1

	if len(base_name) <= 50:
		doc_name = f"{seq_num} {base_name}"[:60]
	else:
		doc_name = f"{seq_num} venda produto"[:60]

	# Garantir unicidade absoluta no campo documento
	while True:
		cursor.execute("SELECT 1 FROM financeiro WHERE documento = %s", (doc_name,))
		if not cursor.fetchone():
			break
		seq_num += 1
		if len(base_name) <= 50:
			doc_name = f"{seq_num} {base_name}"[:60]
		else:
			doc_name = f"{seq_num} venda produto"[:60]

	total_price = round(quantity * unit_price, 2)
	today_date = date.today()
	tomorrow_date = today_date + timedelta(days=1)
	today_str = today_date.isoformat()
	tomorrow_str = tomorrow_date.isoformat()
	historico_str = f"{product_name} x {quantity} (R$ {unit_price:.2f})"

	cursor.execute(
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
			1,
			client_id,
			doc_name,
			today_str,
			tomorrow_str,
			total_price,
			total_price,
			historico_str,
			idrepresentante,
		),
	)
	row = cursor.fetchone()
	if not row or not row[0]:
		raise RuntimeError("Erro ao inserir lançamento de produto fora de estoque no financeiro")
	return row[0]


def process_out_of_stock_products(cursor, produtos: list[dict], default_client_id: int | None = None) -> list[dict]:
	"""
	Identifica e processa produtos avulsos/customizados (is_custom=True ou ID não numérico).
	Gera o lançamento no crediário (tabela financeiro) no PostgreSQL e retorna lista de detalhes dos produtos criados.
	"""
	custom_details = []
	if not produtos:
		return custom_details

	for idx, p in enumerate(produtos):
		is_custom = p.get("is_custom")
		pid_str = str(p.get("id", ""))
		if is_custom or not pid_str.isdigit() or int(pid_str) <= 0:
			client_id = p.get("client_id") or default_client_id
			if not client_id:
				continue
			pname = p.get("nome") or p.get("product_name") or "Produto Avulso"
			try:
				pqty = float(p.get("quantidade", 1))
			except (ValueError, TypeError):
				pqty = 1.0
			try:
				pprice = float(p.get("preco", 0))
			except (ValueError, TypeError):
				pprice = 0.0

			fid = create_out_of_stock_finance_record(
				cursor,
				client_id=int(client_id),
				product_name=pname,
				quantity=pqty,
				unit_price=pprice,
			)
			custom_details.append({
				"id": -int(fid),
				"codigo": "AVULSO",
				"nome": pname,
				"unidademedida": "UN",
				"preco": pprice,
				"quantidade": pqty,
				"is_custom": True,
				"finance_id": fid,
			})

	return custom_details
