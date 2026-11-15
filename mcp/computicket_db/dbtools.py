"""Consultas somente leitura usadas pelo MCP e pelo assistente do dashboard.

O Cursor enxerga isto como servidor MCP. O Gemini da API chama as mesmas
funções, porque ele não tem acesso aos MCP configurados no editor.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import UUID

from dotenv import load_dotenv

from guard import (
	SqlRejected,
	clamp_limit,
	heavy_column,
	is_row_query,
	present_cell,
	secret_column,
	valid_ident,
	validate_readonly_sql,
)

ROOT = Path(__file__).resolve().parents[2]
_PG_OPTIONS = "-c statement_timeout=15000 -c default_transaction_read_only=on"


def _load_env() -> None:
	load_dotenv(ROOT / ".env", override=False)
	load_dotenv(ROOT / "api" / "app" / ".env", override=False)


def _parse_uri(uri: str) -> dict[str, Any]:
	normalized = uri.strip()
	for prefix in ("postgresql+psycopg2://", "postgresql+psycopg://"):
		if normalized.startswith(prefix):
			normalized = "postgresql://" + normalized[len(prefix) :]
			break
	parsed = urlparse(normalized)
	return {
		"user": unquote(parsed.username or ""),
		"password": unquote(parsed.password or ""),
		"host": parsed.hostname or "127.0.0.1",
		"port": parsed.port or 5432,
		"dbname": unquote(parsed.path.lstrip("/")),
	}


def _settings() -> dict[str, Any]:
	_load_env()
	uri = os.environ.get("COMPUTICKET_DATABASE_URL") or os.environ.get("SQLALCHEMY_DATABASE_URI") or ""
	parsed = _parse_uri(uri) if uri.startswith("postgres") else {}
	app_db = os.environ.get("COMPUTICKET_APP_DB") or parsed.get("dbname") or "computicket"
	whatsapp_db = os.environ.get("COMPUTICKET_WHATSAPP_DB") or "computicket_whatsapp"
	host = os.environ.get("COMPUTICKET_PG_HOST") or parsed.get("host") or "127.0.0.1"
	if host == "localhost":
		host = "127.0.0.1"
	return {
		"host": host,
		"port": int(os.environ.get("COMPUTICKET_PG_PORT") or parsed.get("port") or 15432),
		"user": os.environ.get("COMPUTICKET_DB_USER") or parsed.get("user") or "computicket",
		"password": os.environ.get("COMPUTICKET_DB_PASS") or parsed.get("password") or "computicket",
		"app_db": app_db,
		"whatsapp_db": whatsapp_db,
	}


def resolve_database(name: str | None) -> str:
	settings = _settings()
	raw = (name or "computicket").strip().lower()
	aliases = {
		"computicket": settings["app_db"],
		"app": settings["app_db"],
		"aplicacao": settings["app_db"],
		"whatsapp": settings["whatsapp_db"],
		"baileys": settings["whatsapp_db"],
		"engine": settings["whatsapp_db"],
		settings["app_db"].lower(): settings["app_db"],
		settings["whatsapp_db"].lower(): settings["whatsapp_db"],
	}
	if raw not in aliases:
		raise SqlRejected("Banco não permitido. Use computicket ou whatsapp.")
	return aliases[raw]


def _public_error(exc: Exception) -> str:
	text = str(exc)
	password = str(_settings().get("password") or "")
	if password:
		text = text.replace(password, "***")
	return text[:500]


def _json_default(value: Any):
	if isinstance(value, (datetime, date)):
		return value.isoformat()
	if isinstance(value, Decimal):
		return str(value)
	if isinstance(value, UUID):
		return str(value)
	if isinstance(value, (bytes, memoryview)):
		return "[binário]"
	return str(value)


def _dump(payload: dict[str, Any]) -> str:
	return json.dumps(payload, ensure_ascii=False, default=_json_default)


class _CursorResult:
	def __init__(self, cursor):
		self._cursor = cursor
		self.description = cursor.description

	def fetchall(self):
		return [dict(row) for row in self._cursor.fetchall()]

	def fetchmany(self, size: int):
		return [dict(row) for row in self._cursor.fetchmany(size)]

	def fetchone(self):
		row = self._cursor.fetchone()
		return dict(row) if row is not None else None


class _Psycopg2Connection:
	def __init__(self, conn):
		self._conn = conn

	def execute(self, sql: str, params=None):
		cursor = self._conn.cursor()
		cursor.execute(sql, params)
		return _CursorResult(cursor)

	def close(self):
		self._conn.close()

	def __enter__(self):
		return self

	def __exit__(self, *_args):
		self.close()


def _connect(database: str):
	settings = _settings()
	common = {
		"host": settings["host"],
		"port": settings["port"],
		"user": settings["user"],
		"password": settings["password"],
		"dbname": database,
		"connect_timeout": 5,
		"options": _PG_OPTIONS,
	}
	try:
		import psycopg
		from psycopg.rows import dict_row
	except ImportError:
		psycopg = None
	if psycopg is not None:
		return psycopg.connect(**common, autocommit=True, row_factory=dict_row)
	import psycopg2
	from psycopg2.extras import RealDictCursor

	conn = psycopg2.connect(**common, cursor_factory=RealDictCursor)
	conn.autocommit = True
	return _Psycopg2Connection(conn)


def _run(database: str | None, fn):
	try:
		dbname = resolve_database(database)
		with _connect(dbname) as conn:
			return _dump(fn(conn, dbname))
	except Exception as exc:  # noqa: BLE001 — o modelo recebe o erro e segue a conversa
		return _dump({"error": _public_error(exc)})


def _present_row(row: dict[str, Any]) -> dict[str, Any]:
	return {key: present_cell(str(key), value) for key, value in row.items()}


def _column_name(item) -> str:
	return item.name if hasattr(item, "name") else item[0]


def list_databases() -> str:
	settings = _settings()
	items = []
	for label, dbname in (("computicket", settings["app_db"]), ("whatsapp", settings["whatsapp_db"])):
		try:
			with _connect(dbname) as conn:
				version = conn.execute(
					"SELECT current_database() AS name, current_setting('server_version') AS version"
				).fetchone()
			items.append(
				{
					"alias": label,
					"database": dbname,
					"ok": True,
					"version": (version or {}).get("version", ""),
				}
			)
		except Exception as exc:  # noqa: BLE001
			items.append({"alias": label, "database": dbname, "ok": False, "error": _public_error(exc)})
	return _dump({"host": settings["host"], "port": settings["port"], "databases": items})


def list_tables(database: str = "computicket", schema: str = "public") -> str:
	def work(conn, dbname: str) -> dict[str, Any]:
		schema_name = valid_ident(schema, "schema")
		rows = conn.execute(
			"""
			SELECT c.relname AS table_name,
			       CASE c.relkind
			           WHEN 'r' THEN 'table'
			           WHEN 'p' THEN 'partitioned'
			           WHEN 'v' THEN 'view'
			           WHEN 'm' THEN 'materialized'
			           ELSE c.relkind::text
			       END AS kind,
			       COALESCE(s.n_live_tup, 0) AS estimated_rows
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
			WHERE n.nspname = %s AND c.relkind IN ('r', 'p', 'v', 'm')
			ORDER BY c.relname
			""",
			(schema_name,),
		).fetchall()
		return {"database": dbname, "schema": schema_name, "tables": rows}

	return _run(database, work)


def describe_table(table: str, database: str = "computicket", schema: str = "public") -> str:
	def work(conn, dbname: str) -> dict[str, Any]:
		schema_name = valid_ident(schema, "schema")
		table_name = valid_ident(table, "tabela")
		columns = conn.execute(
			"""
			SELECT a.attname AS name,
			       pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
			       NOT a.attnotnull AS nullable,
			       pg_get_expr(ad.adbin, ad.adrelid) AS default_value
			FROM pg_attribute a
			JOIN pg_class c ON c.oid = a.attrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
			WHERE n.nspname = %s AND c.relname = %s AND a.attnum > 0 AND NOT a.attisdropped
			ORDER BY a.attnum
			""",
			(schema_name, table_name),
		).fetchall()
		if not columns:
			raise SqlRejected(f"Tabela {schema_name}.{table_name} não encontrada.")
		for column in columns:
			if secret_column(column["name"]) or heavy_column(column["name"]):
				column["note"] = "valor omitido nas consultas"
		primary_key = [
			row["name"]
			for row in conn.execute(
				"""
				SELECT a.attname AS name
				FROM pg_index i
				JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
				JOIN pg_class c ON c.oid = i.indrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE i.indisprimary AND n.nspname = %s AND c.relname = %s
				ORDER BY a.attnum
				""",
				(schema_name, table_name),
			).fetchall()
		]
		foreign_keys = conn.execute(
			"""
			SELECT kcu.column_name,
			       ccu.table_schema AS foreign_schema,
			       ccu.table_name AS foreign_table,
			       ccu.column_name AS foreign_column
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
			  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage ccu
			  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
			WHERE tc.constraint_type = 'FOREIGN KEY'
			  AND tc.table_schema = %s AND tc.table_name = %s
			ORDER BY kcu.column_name
			""",
			(schema_name, table_name),
		).fetchall()
		return {
			"database": dbname,
			"schema": schema_name,
			"table": table_name,
			"columns": columns,
			"primary_key": primary_key,
			"foreign_keys": foreign_keys,
		}

	return _run(database, work)


def find_columns(term: str, database: str = "computicket") -> str:
	def work(conn, dbname: str) -> dict[str, Any]:
		cleaned = (term or "").strip()
		if len(cleaned) < 2:
			raise SqlRejected("Informe pelo menos 2 caracteres.")
		escaped = cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
		pattern = f"%{escaped}%"
		rows = conn.execute(
			"""
			SELECT table_schema, table_name, column_name, data_type
			FROM information_schema.columns
			WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
			  AND column_name ILIKE %s ESCAPE '\\'
			ORDER BY table_schema, table_name, ordinal_position
			LIMIT 100
			""",
			(pattern,),
		).fetchall()
		return {"database": dbname, "term": cleaned, "matches": rows}

	return _run(database, work)


def query(sql: str, database: str = "computicket", limit: int = 50) -> str:
	try:
		statement = validate_readonly_sql(sql)
		row_limit = clamp_limit(limit)
	except SqlRejected as exc:
		return _dump({"error": str(exc)})

	def work(conn, dbname: str) -> dict[str, Any]:
		if is_row_query(statement):
			cursor = conn.execute(
				f"SELECT * FROM ({statement}) AS computicket_mcp_q LIMIT %s",
				(row_limit + 1,),
			)
		else:
			cursor = conn.execute(statement)
		if cursor.description is None:
			return {"database": dbname, "columns": [], "rows": [], "row_count": 0, "truncated": False}
		columns = [_column_name(item) for item in cursor.description]
		fetched = cursor.fetchmany(row_limit + 1)
		truncated = len(fetched) > row_limit
		rows = [_present_row(row) for row in fetched[:row_limit]]
		redacted = [name for name in columns if secret_column(name) or heavy_column(name)]
		return {
			"database": dbname,
			"columns": columns,
			"rows": rows,
			"row_count": len(rows),
			"truncated": truncated,
			"redacted_columns": redacted,
		}

	return _run(database, work)


def dispatch(name: str, args: dict | None = None) -> str:
	payload = dict(args or {})
	try:
		if name == "list_databases":
			return list_databases()
		if name == "list_tables":
			return list_tables(payload.get("database") or "computicket", payload.get("schema") or "public")
		if name == "describe_table":
			return describe_table(
				str(payload.get("table") or ""),
				payload.get("database") or "computicket",
				payload.get("schema") or "public",
			)
		if name == "find_columns":
			return find_columns(str(payload.get("term") or ""), payload.get("database") or "computicket")
		if name == "query":
			return query(
				str(payload.get("sql") or ""),
				payload.get("database") or "computicket",
				payload.get("limit") or 50,
			)
	except Exception as exc:  # noqa: BLE001
		return _dump({"error": _public_error(exc)})
	return _dump({"error": f"Ferramenta desconhecida: {name}"})
