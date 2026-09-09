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


_IMPLANTATION_STATUS_CHECK = (
	"CHECK (status IN ('in_progress', 'paused', 'completed', 'cancelled'))"
)
_IMPLANTATION_STATUS_INDEXES = (
	"CREATE INDEX IF NOT EXISTS ix_implantation_external_client_id ON implantation (external_client_id)",
	"CREATE INDEX IF NOT EXISTS ix_implantation_current_step_id ON implantation (current_step_id)",
	"CREATE INDEX IF NOT EXISTS ix_implantation_due_at ON implantation (due_at)",
	"CREATE INDEX IF NOT EXISTS ix_implantation_model_id ON implantation (model_id)",
	"CREATE INDEX IF NOT EXISTS ix_implantation_status ON implantation (status)",
	"CREATE INDEX IF NOT EXISTS ix_implantation_assigned_to_id ON implantation (assigned_to_id)",
)


def ensure_implantation_status_check() -> None:
	"""Garante que o CHECK de status aceite 'paused' (SQLite precisa recriar a tabela)."""
	if not table_exists("implantation"):
		return
	bind = db.session.get_bind()
	if bind is None:
		return
	dialect = bind.dialect.name
	if dialect == "postgresql":
		db.session.execute(text("ALTER TABLE implantation DROP CONSTRAINT IF EXISTS ck_implantation_status"))
		db.session.execute(text(
			"ALTER TABLE implantation ADD CONSTRAINT ck_implantation_status "
			+ _IMPLANTATION_STATUS_CHECK
		))
		db.session.commit()
		return
	if dialect != "sqlite":
		return
	row = db.session.execute(
		text("SELECT sql FROM sqlite_master WHERE type='table' AND name='implantation'")
	).fetchone()
	ddl = (row[0] or "") if row else ""
	if "'paused'" in ddl:
		return
	if "ck_implantation_status" not in ddl and "CHECK (status" not in ddl:
		return
	new_ddl = ddl.replace(
		"CHECK (status IN ('in_progress', 'completed', 'cancelled'))",
		_IMPLANTATION_STATUS_CHECK,
	)
	if "'paused'" not in new_ddl:
		new_ddl = ddl.replace(
			"CONSTRAINT ck_implantation_status CHECK (status IN ('in_progress', 'completed', 'cancelled'))",
			f"CONSTRAINT ck_implantation_status {_IMPLANTATION_STATUS_CHECK}",
		)
	if "'paused'" not in new_ddl:
		return
	new_ddl = new_ddl.replace("CREATE TABLE implantation", "CREATE TABLE implantation__status_fix", 1)
	cols = sorted(column_names("implantation"), key=lambda name: 0 if name == "id" else 1)
	col_list = ", ".join(cols)
	db.session.execute(text("PRAGMA foreign_keys=OFF"))
	db.session.execute(text(new_ddl))
	db.session.execute(text(
		f"INSERT INTO implantation__status_fix ({col_list}) SELECT {col_list} FROM implantation"
	))
	db.session.execute(text("DROP TABLE implantation"))
	db.session.execute(text("ALTER TABLE implantation__status_fix RENAME TO implantation"))
	for index_sql in _IMPLANTATION_STATUS_INDEXES:
		db.session.execute(text(index_sql))
	db.session.commit()
	db.session.execute(text("PRAGMA foreign_keys=ON"))
