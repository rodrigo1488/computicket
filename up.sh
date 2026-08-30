#!/usr/bin/env bash
# Sobe o stack Docker do Computicket e migra tickets.sqlite3 -> Postgres (se existir).
#
# Uso (na raiz do repo):
#   chmod +x up.sh
#   ./up.sh
#   ./up.sh /caminho/tickets.sqlite3
#
# Variáveis opcionais:
#   COMPOSE_FILE=docker-compose.yml   (default)
#   SKIP_BUILD=1                      não passa --build
#   SKIP_MIGRATE=1                    sobe containers e não migra
#   NO_WIPE=1                         migra sem --wipe
#   SQLALCHEMY_DATABASE_URI=...       destino (default localhost:15432/computicket)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[ERRO] Não encontrei $COMPOSE_FILE em $ROOT"
  exit 1
fi

DB_USER="${COMPUTICKET_DB_USER:-computicket}"
DB_PASS="${COMPUTICKET_DB_PASS:-computicket}"
APP_DB="${COMPUTICKET_APP_DB:-computicket}"
PG_PORT="${COMPUTICKET_PG_PORT:-15432}"
URI="${SQLALCHEMY_DATABASE_URI:-postgresql+psycopg2://${DB_USER}:${DB_PASS}@localhost:${PG_PORT}/${APP_DB}}"
export SQLALCHEMY_DATABASE_URI="$URI"

APP_DIR="$ROOT/api/app"
BUILD_FLAG=(--build)
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  BUILD_FLAG=()
fi

echo
echo "=== Computicket: subir containers + migração ==="
echo "Repo:    $ROOT"
echo "Compose: $COMPOSE_FILE"
echo "Destino: $URI"
echo

# ---- 1) Stack ----
echo "[1/5] Subindo containers (docker compose up -d ${BUILD_FLAG[*]:-})..."
docker compose -f "$COMPOSE_FILE" up -d "${BUILD_FLAG[@]}"
echo "      Containers em subida."

# ---- 2) Postgres healthy ----
echo "[2/5] Aguardando Postgres healthy..."
tries=0
until docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_isready -U "$DB_USER" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [[ $tries -ge 60 ]]; then
    echo "[ERRO] Timeout aguardando Postgres."
    exit 1
  fi
  sleep 2
done
echo "      Postgres OK."

# ---- 3) Database app ----
echo "[3/5] Garantindo database \"${APP_DB}\"..."
exists="$(
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${APP_DB}'" \
    | tr -d '[:space:]'
)"
if [[ "$exists" != "1" ]]; then
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${APP_DB};"
  echo "      Database criado."
else
  echo "      Database já existe."
fi

# ---- 4) Migração SQL opcional (ex.: RAG) ----
if [[ -d "$ROOT/api/migrations" ]]; then
  echo "[4/5] Aplicando scripts em api/migrations/ (se houver)..."
  shopt -s nullglob
  for sql in "$ROOT/api/migrations"/*.sql; do
    echo "      -> $(basename "$sql")"
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$DB_USER" -d "$APP_DB" -v ON_ERROR_STOP=1 <"$sql" \
      || echo "      (aviso) falha ao aplicar $(basename "$sql") — pode já ter sido aplicado."
  done
  shopt -u nullglob
else
  echo "[4/5] Sem pasta api/migrations/ — pulando."
fi

# ---- 5) SQLite -> Postgres ----
if [[ "${SKIP_MIGRATE:-0}" == "1" ]]; then
  echo "[5/5] SKIP_MIGRATE=1 — migração SQLite ignorada."
else
  SQLITE="${1:-}"
  if [[ -z "$SQLITE" ]]; then
    CAND_A="$ROOT/api/instance/tickets.sqlite3"
    CAND_B="$APP_DIR/instance/tickets.sqlite3"
    SIZE_A=0
    SIZE_B=0
    [[ -f "$CAND_A" ]] && SIZE_A="$(wc -c <"$CAND_A" | tr -d ' ')"
    [[ -f "$CAND_B" ]] && SIZE_B="$(wc -c <"$CAND_B" | tr -d ' ')"
    if [[ "$SIZE_A" -ge "$SIZE_B" && -f "$CAND_A" ]]; then
      SQLITE="$CAND_A"
    elif [[ -f "$CAND_B" ]]; then
      SQLITE="$CAND_B"
    fi
  fi

  if [[ -z "${SQLITE:-}" || ! -f "$SQLITE" ]]; then
    echo "[5/5] Nenhum tickets.sqlite3 encontrado — pulando migração de dados."
    echo "      Passe o caminho: ./up.sh /caminho/tickets.sqlite3"
  else
    echo "[5/5] Migrando SQLite -> Postgres"
    echo "      Fonte: $SQLITE"
    PY="python3"
    if [[ -x "$APP_DIR/.venv/bin/python" ]]; then
      PY="$APP_DIR/.venv/bin/python"
    elif command -v python3 >/dev/null 2>&1; then
      PY="python3"
    elif command -v python >/dev/null 2>&1; then
      PY="python"
    fi

    WIPE_FLAG=(--wipe)
    if [[ "${NO_WIPE:-0}" == "1" ]]; then
      WIPE_FLAG=()
    fi

    (
      cd "$APP_DIR"
      "$PY" tools/migrate_sqlite_to_postgres.py "${WIPE_FLAG[@]}" --sqlite "$SQLITE" --uri "$URI"
    )
    echo "      Migração SQLite concluída."
  fi
fi

echo
echo "[OK] Stack no ar."
echo "     Web:      http://localhost:${COMPUTICKET_WEB_PORT:-3000}"
echo "     API:      http://localhost:${COMPUTICKET_API_PORT:-5000}"
echo "     WhatsApp: http://localhost:${COMPUTICKET_WHATSAPP_PORT:-4000}"
echo "     Postgres: localhost:${PG_PORT} (não use 5432 — reservado ao Uniplus)"
echo
