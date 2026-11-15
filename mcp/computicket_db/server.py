"""MCP somente leitura do Postgres do Computicket.

Usa o mesmo cluster do docker compose (porta 15432 no host): banco `computicket`
da aplicação e `computicket_whatsapp` do motor Baileys. Credenciais vêm do
ambiente ou de `.env` / `api/app/.env`. Senhas, tokens e hashes saem redigidos.

O assistente do dashboard chama `dbtools` direto. Este processo existe para o
agente do Cursor, que fala MCP.

Recriar o ambiente, na raiz do repositório:

    py -3 -m venv mcp/computicket_db/.venv
    mcp\\computicket_db\\.venv\\Scripts\\python.exe -m pip install -r mcp/computicket_db/requirements.txt
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import dbtools
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("computicket-db")


@mcp.tool()
def list_databases() -> str:
	"""Lista os bancos Computicket que este MCP alcança e testa a conexão de cada um."""
	return dbtools.list_databases()


@mcp.tool()
def list_tables(database: str = "computicket", schema: str = "public") -> str:
	"""Lista tabelas, views e o número estimado de linhas. database: computicket ou whatsapp."""
	return dbtools.list_tables(database, schema)


@mcp.tool()
def describe_table(table: str, database: str = "computicket", schema: str = "public") -> str:
	"""Mostra colunas, chave primária e chaves estrangeiras de uma tabela."""
	return dbtools.describe_table(table, database, schema)


@mcp.tool()
def find_columns(term: str, database: str = "computicket") -> str:
	"""Procura colunas pelo nome, nos schemas do usuário. Útil para achar onde um campo mora."""
	return dbtools.find_columns(term, database)


@mcp.tool()
def query(sql: str, database: str = "computicket", limit: int = 50) -> str:
	"""Executa uma consulta somente leitura (SELECT, WITH, EXPLAIN, SHOW ou TABLE).

	database é computicket (aplicação) ou whatsapp (motor Baileys).
	Senha, token, hash e embedding não vêm no resultado. Não há INSERT, UPDATE, DELETE nem DDL.
	"""
	return dbtools.query(sql, database, limit)


if __name__ == "__main__":
	mcp.run(transport="stdio")
