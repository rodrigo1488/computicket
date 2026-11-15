"""Regras de consulta somente leitura para o MCP do banco Computicket."""

from __future__ import annotations

import re

MAX_SQL_CHARS = 20_000
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
CELL_CHARS = 2_000

_LEADING = re.compile(r"^(select|with|explain|show|table)\b", re.IGNORECASE)
_WRITING = re.compile(
	r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|"
	r"vacuum|call|do|execute|merge|listen|notify|lock|reindex|refresh|comment|"
	r"security|import|load)\b",
	re.IGNORECASE,
)
_BLOCKED_FN = re.compile(
	r"\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_export|"
	r"lo_import|lo_from_bytea|dblink|dblink_exec|pg_terminate_backend|"
	r"pg_cancel_backend|pg_sleep)\b",
	re.IGNORECASE,
)
_DOLLAR = re.compile(r"\$[A-Za-z0-9_]*\$")
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SECRET = re.compile(
	r"(password|passwd|secret|token|api_key|apikey|private_key|credential|hash)",
	re.IGNORECASE,
)
_HEAVY = re.compile(r"(embedding|vector|bytea)", re.IGNORECASE)


class SqlRejected(ValueError):
	pass


def validate_readonly_sql(sql: str) -> str:
	raw = (sql or "").strip()
	if not raw:
		raise SqlRejected("SQL vazio.")
	if len(raw) > MAX_SQL_CHARS:
		raise SqlRejected("SQL longo demais.")
	if _DOLLAR.search(raw):
		raise SqlRejected("Delimitadores dollar-quote não são aceitos.")
	cleaned = _strip_comments(raw).strip().rstrip(";").strip()
	if not cleaned:
		raise SqlRejected("SQL vazio.")
	if ";" in cleaned:
		raise SqlRejected("Apenas um comando por vez.")
	if not _LEADING.match(cleaned):
		raise SqlRejected("Só consulta: SELECT, WITH, EXPLAIN, SHOW ou TABLE.")
	if _WRITING.search(cleaned):
		raise SqlRejected("Comando de escrita não é permitido.")
	if cleaned.lower().startswith("select") and re.search(r"\binto\b", cleaned, re.IGNORECASE):
		raise SqlRejected("SELECT INTO não é permitido.")
	if _BLOCKED_FN.search(cleaned):
		raise SqlRejected("Essa função não pode ser chamada por aqui.")
	return cleaned


def is_row_query(sql: str) -> bool:
	return bool(re.match(r"^(select|with|table)\b", sql, re.IGNORECASE))


def clamp_limit(limit: int | None) -> int:
	if limit is None:
		return DEFAULT_LIMIT
	try:
		value = int(limit)
	except (TypeError, ValueError) as exc:
		raise SqlRejected("limit precisa ser um número.") from exc
	if value < 1:
		raise SqlRejected("limit precisa ser pelo menos 1.")
	return min(value, MAX_LIMIT)


def valid_ident(name: str, label: str = "nome") -> str:
	cleaned = (name or "").strip()
	if not _IDENT.match(cleaned):
		raise SqlRejected(f"{label} inválido.")
	return cleaned


def secret_column(name: str) -> bool:
	return bool(_SECRET.search(name or ""))


def heavy_column(name: str) -> bool:
	return bool(_HEAVY.search(name or ""))


def present_cell(column: str, value):
	if secret_column(column):
		return "[redigido]"
	if heavy_column(column):
		return "[omitido]"
	if isinstance(value, (bytes, memoryview)):
		return "[binário]"
	if isinstance(value, str) and len(value) > CELL_CHARS:
		return value[:CELL_CHARS] + "… [truncado]"
	return value


def _strip_comments(sql: str) -> str:
	without_block = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
	return re.sub(r"--[^\n]*", " ", without_block)
