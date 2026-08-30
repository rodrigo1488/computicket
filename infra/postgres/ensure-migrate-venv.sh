#!/usr/bin/env bash
# Garante venv Python em api/app/.venv com deps para migrate_sqlite_to_postgres.py
# Uso: source infra/postgres/ensure-migrate-venv.sh && ensure_migrate_venv
ensure_migrate_venv() {
  local root="${1:?root obrigatório}"
  local app_dir="$root/api/app"
  local req="$root/api/requirements.txt"
  local venv_py="$app_dir/.venv/bin/python"
  local venv_pip="$app_dir/.venv/bin/pip"

  if [[ ! -f "$req" ]]; then
    echo "[ERRO] Não encontrei $req"
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERRO] python3 não encontrado. Instale: sudo apt install python3 python3-venv python3-pip"
    return 1
  fi

  if [[ ! -x "$venv_py" ]]; then
    echo "      Criando venv em api/app/.venv ..."
    python3 -m venv "$app_dir/.venv"
  fi

  if ! "$venv_py" -c "import dotenv, sqlalchemy, psycopg2" >/dev/null 2>&1; then
    echo "      Instalando dependências (api/requirements.txt) ..."
    "$venv_pip" install -q --upgrade pip
    "$venv_pip" install -q -r "$req"
  fi

  if ! "$venv_py" -c "import dotenv" >/dev/null 2>&1; then
    echo "[ERRO] Falha ao instalar python-dotenv no venv."
    return 1
  fi

  echo "$venv_py"
}
