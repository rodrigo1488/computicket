"""Helpers de schema dialeto-agnósticos (SQLite e PostgreSQL)."""
from __future__ import annotations

from typing import Iterable

from sqlalchemy import inspect, text

from . import db


def _dialect_name() -> str:
	bind = db.session.get_bind() if db.session else None
	if bind is None:
		return ""
	return bind.dialect.name


def table_exists(table_name: str) -> bool:
	bind = db.session.get_bind()
	return table_name in inspect(bind).get_table_names()


def column_names(table_name: str) -> set[str]:
	bind = db.session.get_bind()
	insp = inspect(bind)
	if table_name not in insp.get_table_names():
		return set()
	return {c["name"] for c in insp.get_columns(table_name)}


def ensure_column(table_name: str, column_name: str, type_sql: str) -> bool:
	"""
	Adiciona coluna se a tabela existir e a coluna não existir.
	type_sql: fragmento SQL do tipo (ex.: 'BOOLEAN DEFAULT FALSE', 'VARCHAR(50)').
	Retorna True se adicionou.
	"""
	if not table_exists(table_name):
		return False
	if column_name in column_names(table_name):
		return False
	# "user" é palavra reservada no Postgres
	quoted = f'"{table_name}"' if _dialect_name() == "postgresql" else table_name
	db.session.execute(text(f"ALTER TABLE {quoted} ADD COLUMN {column_name} {type_sql}"))
	db.session.commit()
	return True


def ensure_tables_from_metadata(table_names: Iterable[str] | None = None) -> None:
	"""Cria tabelas ausentes a partir do metadata do SQLAlchemy."""
	bind = db.session.get_bind()
	if table_names:
		tables = [db.metadata.tables[n] for n in table_names if n in db.metadata.tables]
		db.metadata.create_all(bind=bind, tables=tables)
	else:
		db.metadata.create_all(bind=bind)
