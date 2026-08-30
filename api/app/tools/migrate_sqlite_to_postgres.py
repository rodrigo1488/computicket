#!/usr/bin/env python
"""
Migra dados de instance/tickets.sqlite3 para o PostgreSQL configurado em
SQLALCHEMY_DATABASE_URI (database dedicado `computicket`).

Uso (a partir de api/app):

  # Defina a URI de destino no .env ou no ambiente
  set SQLALCHEMY_DATABASE_URI=postgresql+psycopg2://computicket:computicket@localhost:15432/computicket

  python tools/migrate_sqlite_to_postgres.py
  python tools/migrate_sqlite_to_postgres.py --wipe
  python tools/migrate_sqlite_to_postgres.py --sqlite path/to/tickets.sqlite3 --wipe

Preserva PKs e ajusta sequences (setval) no Postgres.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Garante imports do pacote `app` quando rodado como script
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
	sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

# Ordem de cópia respeitando FKs (pais antes dos filhos)
TABLE_ORDER: list[str] = [
	"user",
	"client",
	"contract",
	"service",
	"contract_service",
	"system_config",
	"system",
	"plan",
	"plan_additional",
	"custom_plan",
	"custom_plan_item",
	"client_plan",
	"plan_usage",
	"client_contract",
	"budget_theme",
	"ticket",
	"ticket_product",
	"ticket_addon",
	"time_entry",
	"user_availability",
	"technician_location",
	"service_order",
	"help_desk_session",
	"help_desk_message",
	"helpdesk_agent_map",
	"helpdesk_ticket_link",
	"password_vault",
	"knowledge_category",
	"knowledge_article",
	"knowledge_attachment",
	"budget",
	"budget_item",
	"appointment",
	"inventory_item",
	"inventory_item_photo",
	"inventory_event",
	"shift_swap",
]

# Tabelas com nome reservado no Postgres precisam de aspas
RESERVED = {"user", "system"}


def qname(table: str) -> str:
	return f'"{table}"' if table in RESERVED else table


def default_sqlite_path() -> Path:
	"""Prefere o SQLite com dados reais (api/instance) sobre o instance vazio do pacote."""
	candidates = [
		ROOT.parent / "instance" / "tickets.sqlite3",  # api/instance
		ROOT / "instance" / "tickets.sqlite3",  # api/app/instance
	]
	existing = [p for p in candidates if p.is_file()]
	if not existing:
		return candidates[0]
	# Maior arquivo = provavelmente o banco em uso
	return max(existing, key=lambda p: p.stat().st_size)


def require_postgres_uri(uri: str) -> None:
	if not uri or not uri.startswith("postgresql"):
		raise SystemExit(
			"SQLALCHEMY_DATABASE_URI deve apontar para PostgreSQL.\n"
			"Ex.: postgresql+psycopg2://computicket:computicket@localhost:15432/computicket"
		)


def list_tables(engine: Engine) -> set[str]:
	return set(inspect(engine).get_table_names())


def table_columns(engine: Engine, table: str) -> list[str]:
	return [c["name"] for c in inspect(engine).get_columns(table)]


def table_column_types(engine: Engine, table: str) -> dict[str, str]:
	"""Nome da coluna -> tipo SQLAlchemy lowercase (ex.: boolean, integer, datetime)."""
	out: dict[str, str] = {}
	for c in inspect(engine).get_columns(table):
		t = c["type"]
		out[c["name"]] = type(t).__name__.lower()
	return out


def _coerce_value(value, type_name: str):
	"""Converte valores vindos do SQLite para tipos aceitos pelo Postgres."""
	if value is None:
		return None
	# Boolean: SQLite guarda 0/1 (ou "0"/"1")
	if type_name in {"boolean", "bool"}:
		if isinstance(value, bool):
			return value
		if isinstance(value, (int, float)):
			return bool(value)
		if isinstance(value, (bytes, bytearray)):
			value = value.decode("utf-8", errors="ignore")
		if isinstance(value, str):
			v = value.strip().lower()
			if v in {"1", "true", "t", "yes", "y", "on"}:
				return True
			if v in {"0", "false", "f", "no", "n", "off", ""}:
				return False
		return bool(value)
	# Bytes / memoryview → str se a coluna for texto
	if type_name in {"varchar", "string", "text", "unicode", "unicodetext"}:
		if isinstance(value, (bytes, bytearray, memoryview)):
			return bytes(value).decode("utf-8", errors="replace")
	return value


# Tabelas que NÃO devem ser truncadas/sobrescritas na migração.
# system_config guarda Uniplus PG host/senha, agent token, etc. — vivem só no Postgres
# depois do go-live; o SQLite antigo não as tem e um --wipe apagava a UI Uniplus.
PRESERVE_ON_MIGRATE: set[str] = {
	"system_config",
}


def count_rows(engine: Engine, table: str) -> int:
	with engine.connect() as conn:
		return int(conn.execute(text(f"SELECT COUNT(*) FROM {qname(table)}")).scalar() or 0)


def wipe_postgres(engine: Engine, tables: list[str]) -> None:
	"""TRUNCATE CASCADE das tabelas existentes (ordem inversa), preservando config do sistema."""
	existing = list_tables(engine)
	targets = [t for t in reversed(tables) if t in existing and t not in PRESERVE_ON_MIGRATE]
	skipped = [t for t in tables if t in existing and t in PRESERVE_ON_MIGRATE]
	if skipped:
		print(f"  preserve: {', '.join(skipped)} (não truncadas)")
	if not targets:
		return
	with engine.begin() as conn:
		joined = ", ".join(qname(t) for t in targets)
		conn.execute(text(f"TRUNCATE TABLE {joined} RESTART IDENTITY CASCADE"))
	print(f"  wipe: {len(targets)} tabelas truncadas")


def copy_table(src: Engine, dst: Engine, table: str, *, disable_fks: bool = True) -> tuple[int, int]:
	src_cols = table_columns(src, table)
	dst_cols = table_columns(dst, table)
	dst_types = table_column_types(dst, table)
	common = [c for c in src_cols if c in dst_cols]
	if not common:
		print(f"  skip {table}: sem colunas em comum")
		return 0, 0

	col_list = ", ".join(f'"{c}"' for c in common)
	placeholders = ", ".join(f":{c}" for c in common)

	with src.connect() as sconn:
		rows = sconn.execute(text(f"SELECT {col_list} FROM {qname(table)}")).mappings().all()

	if not rows:
		return 0, 0

	insert_sql = text(
		f"INSERT INTO {qname(table)} ({col_list}) VALUES ({placeholders})"
	)
	payload = []
	for r in rows:
		row = {}
		for c in common:
			row[c] = _coerce_value(r[c], dst_types.get(c, ""))
		payload.append(row)

	# Inserção em lotes para tabelas grandes
	batch_size = 500
	with dst.begin() as dconn:
		if disable_fks:
			# SQLite costuma ter FKs órfãs (PRAGMA foreign_keys=OFF); Postgres rejeita.
			dconn.execute(text("SET LOCAL session_replication_role = 'replica'"))
		for i in range(0, len(payload), batch_size):
			dconn.execute(insert_sql, payload[i : i + batch_size])

	return len(payload), count_rows(dst, table)


# FKs opcionais que no SQLite legado apontam para linhas inexistentes
ORPHAN_FK_NULLS: list[tuple[str, str, str]] = [
	# (tabela, coluna_fk, tabela_pai)
	("ticket", "client_id", "client"),
	("ticket", "contract_id", "contract"),
	("ticket", "service_id", "service"),
	("ticket", "parent_id", "ticket"),
	("time_entry", "ticket_id", "ticket"),
	("time_entry", "user_id", "user"),
	("ticket_product", "ticket_id", "ticket"),
	("ticket_addon", "ticket_id", "ticket"),
	("password_vault", "client_id", "client"),
	("password_vault", "created_by_id", "user"),
	("help_desk_session", "assigned_to_id", "user"),
	("help_desk_session", "ticket_id", "ticket"),
	("help_desk_message", "session_id", "help_desk_session"),
	("help_desk_message", "sender_id", "user"),
	("budget", "client_id", "client"),
	("budget", "theme_id", "budget_theme"),
	("budget", "created_by_id", "user"),
	("budget_item", "budget_id", "budget"),
	("budget_item", "service_id", "service"),
	("appointment", "user_id", "user"),
	("service_order", "technician_id", "user"),
	("plan", "system_id", "system"),
	("client_plan", "plan_id", "plan"),
	("plan_usage", "client_plan_id", "client_plan"),
	("plan_additional", "plan_id", "plan"),
	("knowledge_article", "category_id", "knowledge_category"),
	("knowledge_attachment", "article_id", "knowledge_article"),
	("inventory_item_photo", "item_id", "inventory_item"),
	("inventory_event", "item_id", "inventory_item"),
	("technician_location", "user_id", "user"),
	("shift_swap", "user_1_id", "user"),
	("shift_swap", "user_2_id", "user"),
	("shift_swap", "requested_by_id", "user"),
]


def nullify_orphan_fks(engine: Engine) -> None:
	"""Zera FKs nullable que apontam para PKs inexistentes (legado SQLite sem enforcement)."""
	existing = list_tables(engine)
	with engine.begin() as conn:
		for table, col, parent in ORPHAN_FK_NULLS:
			if table not in existing or parent not in existing:
				continue
			col_meta = {c["name"]: c for c in inspect(engine).get_columns(table)}
			if col not in col_meta:
				continue
			if col_meta[col].get("nullable") is False:
				# Não dá para zerar NOT NULL; mantém valor (FK já foi ignorada na carga)
				continue
			sql = text(
				f"""
				UPDATE {qname(table)} t
				SET "{col}" = NULL
				WHERE t."{col}" IS NOT NULL
				  AND NOT EXISTS (
					SELECT 1 FROM {qname(parent)} p WHERE p.id = t."{col}"
				  )
				"""
			)
			res = conn.execute(sql)
			if res.rowcount:
				print(f"  orphan FK nullified: {table}.{col} → {parent} ({res.rowcount} rows)")


def reset_sequences(engine: Engine, tables: list[str]) -> None:
	existing = list_tables(engine)
	with engine.begin() as conn:
		for table in tables:
			if table not in existing:
				continue
			cols = inspect(engine).get_columns(table)
			pk_cols = [c["name"] for c in cols if c.get("autoincrement")]
			# Fallback: coluna "id" inteira
			if not pk_cols and any(c["name"] == "id" for c in cols):
				pk_cols = ["id"]
			for col in pk_cols:
				seq = conn.execute(
					text("SELECT pg_get_serial_sequence(:tbl, :col)"),
					{"tbl": table, "col": col},
				).scalar()
				if not seq:
					continue
				max_id = conn.execute(
					text(f"SELECT MAX(\"{col}\") FROM {qname(table)}")
				).scalar()
				if max_id is None:
					continue
				conn.execute(
					text("SELECT setval(:seq, :val, true)"),
					{"seq": seq, "val": int(max_id)},
				)
				print(f"  setval {seq} = {max_id}")


def ensure_schema(pg_uri: str) -> None:
	"""Cria schema no Postgres via create_app (sem blueprints) + create_all."""
	os.environ["SQLALCHEMY_DATABASE_URI"] = pg_uri
	# Evita importar openpyxl/reportlab/pywebpush/etc. só para criar tabelas.
	os.environ["COMPUTICKET_SCHEMA_ONLY"] = "1"
	from app import create_app, db

	app = create_app()
	with app.app_context():
		db.create_all()
		print(f"Schema Postgres OK ({db.engine.url.render_as_string(hide_password=False)})")


def main() -> None:
	parser = argparse.ArgumentParser(description="Migra SQLite → PostgreSQL (app Computicket)")
	parser.add_argument(
		"--sqlite",
		type=Path,
		default=None,
		help="Caminho do tickets.sqlite3 (default: instance/tickets.sqlite3)",
	)
	parser.add_argument(
		"--wipe",
		action="store_true",
		help="TRUNCATE das tabelas no Postgres antes de copiar",
	)
	parser.add_argument(
		"--uri",
		default=None,
		help="Override de SQLALCHEMY_DATABASE_URI de destino",
	)
	args = parser.parse_args()

	sqlite_path = (args.sqlite or default_sqlite_path()).resolve()
	if not sqlite_path.is_file():
		raise SystemExit(f"SQLite não encontrado: {sqlite_path}")

	pg_uri = (args.uri or os.environ.get("SQLALCHEMY_DATABASE_URI", "")).strip()
	require_postgres_uri(pg_uri)

	print(f"Fonte : sqlite:///{sqlite_path}")
	print(f"Destino: {pg_uri}")

	print("\n1) Criando schema no Postgres...")
	ensure_schema(pg_uri)

	src = create_engine(f"sqlite:///{sqlite_path}")
	dst = create_engine(pg_uri)

	src_tables = list_tables(src)
	dst_tables = list_tables(dst)

	ordered = [t for t in TABLE_ORDER if t in src_tables and t in dst_tables]
	extras_src = sorted(src_tables - set(TABLE_ORDER) - {"sqlite_sequence", "alembic_version"})
	if extras_src:
		print(f"\nTabelas no SQLite fora da ordem conhecida (serão ignoradas se não estiverem no destino): {extras_src}")
		for t in extras_src:
			if t in dst_tables and t not in ordered:
				ordered.append(t)

	if args.wipe:
		print("\n2) Limpando destino (--wipe)...")
		wipe_postgres(dst, ordered)
	else:
		print("\n2) Sem --wipe (dados existentes no destino são mantidos; risco de conflito de PK)")

	print("\n3) Copiando tabelas...")
	results: list[tuple[str, int, int, int]] = []
	for table in ordered:
		src_n = count_rows(src, table)
		if table in PRESERVE_ON_MIGRATE and count_rows(dst, table) > 0:
			dst_n = count_rows(dst, table)
			print(f"  {table}: PRESERVADO no Postgres (sqlite={src_n} postgres={dst_n})")
			results.append((table, src_n, 0, dst_n))
			continue
		try:
			copied, dst_n = copy_table(src, dst, table)
			print(f"  {table}: sqlite={src_n} copiados={copied} postgres={dst_n}")
			results.append((table, src_n, copied, dst_n))
		except Exception as e:
			print(f"  ERRO {table}: {e}")
			results.append((table, src_n, -1, -1))
			raise

	print("\n4) Limpando FKs órfãs (legado SQLite)...")
	nullify_orphan_fks(dst)

	print("\n5) Ajustando sequences...")
	reset_sequences(dst, [t for t in ordered if t not in PRESERVE_ON_MIGRATE])

	print("\n=== Resumo ===")
	ok = True
	for table, src_n, copied, dst_n in results:
		if table in PRESERVE_ON_MIGRATE:
			status = "KEEP"
		else:
			# Após wipe, dst deve == src; sem wipe, dst >= src tipicamente
			status = "OK" if dst_n == src_n or (not args.wipe and dst_n >= src_n) else "DIFF"
			if status != "OK":
				ok = False
		print(f"  [{status}] {table}: sqlite={src_n} postgres={dst_n}")

	if ok:
		print("\nMigração concluída. Defina SQLALCHEMY_DATABASE_URI no .env e reinicie a API.")
	else:
		print("\nMigração terminou com divergências de contagem — revise as tabelas marcadas DIFF.")
		sys.exit(1)


if __name__ == "__main__":
	main()
