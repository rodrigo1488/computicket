#!/usr/bin/env bash
# Garante venv Python em api/app/.venv com deps para migrate_sqlite_to_postgres.py
# Uso: source infra/postgres/ensure-migrate-venv.sh && ensure_migrate_venv "$ROOT"
ensure_migrate_venv() {
  local root="${1:?root obrigatório}"
  local app_dir="$root/api/app"
  # Preferir deps mínimas da migração (evita conflito pywebpush/cryptography etc.)
  local req="$root/api/requirements-migrate.txt"
  if [[ ! -f "$req" ]]; then
    req="$root/api/requirements.txt"
  fi
  local venv_dir="$app_dir/.venv"
  local venv_py="$venv_dir/bin/python"

  if [[ ! -f "$req" ]]; then
    echo "[ERRO] Não encontrei $req" >&2
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERRO] python3 não encontrado." >&2
    echo "       Instale: sudo apt install python3 python3-venv python3-pip" >&2
    return 1
  fi

  _create_venv() {
    echo "      Criando venv em api/app/.venv ..." >&2
    rm -rf "$venv_dir"
    if python3 -m venv --help 2>/dev/null | grep -q 'upgrade-deps'; then
      python3 -m venv --upgrade-deps "$venv_dir"
    else
      python3 -m venv "$venv_dir"
    fi
  }

  _ensure_pip() {
    if "$venv_py" -m pip --version >/dev/null 2>&1; then
      return 0
    fi
    echo "      Instalando pip no venv (ensurepip) ..." >&2
    if ! "$venv_py" -m ensurepip --upgrade >/dev/null 2>&1; then
      return 1
    fi
    "$venv_py" -m pip --version >/dev/null 2>&1
  }

  if [[ ! -x "$venv_py" ]]; then
    _create_venv || {
      echo "[ERRO] Falha ao criar venv. Instale: sudo apt install python3-venv" >&2
      return 1
    }
  fi

  if ! _ensure_pip; then
    echo "      Venv incompleto — recriando ..." >&2
    _create_venv || return 1
    if ! _ensure_pip; then
      echo "[ERRO] venv sem pip. Rode:" >&2
      echo "  sudo apt install -y python3-venv python3-pip" >&2
      echo "  rm -rf api/app/.venv && ./migrate.sh" >&2
      return 1
    fi
  fi

  if ! "$venv_py" -c "import dotenv, sqlalchemy, psycopg2" >/dev/null 2>&1; then
    echo "      Instalando dependências ($(basename "$req")) ..." >&2
    "$venv_py" -m pip install -q --upgrade pip
    "$venv_py" -m pip install -q -r "$req"
  fi

  if ! "$venv_py" -c "import dotenv, sqlalchemy, psycopg2" >/dev/null 2>&1; then
    echo "[ERRO] Falha ao instalar deps de migração no venv." >&2
    echo "       Tente: rm -rf api/app/.venv && ./migrate.sh" >&2
    return 1
  fi

  echo "$venv_py"
}
