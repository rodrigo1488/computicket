#!/usr/bin/env bash
# Migra tickets.sqlite3 -> Postgres (15432). Containers já devem estar no ar.
#
# Uso:
#   chmod +x migrate.sh
#   ./migrate.sh
#   ./migrate.sh /caminho/tickets.sqlite3
#
# Variáveis: NO_WIPE=1, SQLALCHEMY_DATABASE_URI=...
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# shellcheck source=infra/postgres/ensure-migrate-venv.sh
source "$ROOT/infra/postgres/ensure-migrate-venv.sh"

DB_USER="${COMPUTICKET_DB_USER:-computicket}"
DB_PASS="${COMPUTICKET_DB_PASS:-computicket}"
APP_DB="${COMPUTICKET_APP_DB:-computicket}"
PG_PORT="${COMPUTICKET_PG_PORT:-15432}"
URI="${SQLALCHEMY_DATABASE_URI:-postgresql+psycopg2://${DB_USER}:${DB_PASS}@localhost:${PG_PORT}/${APP_DB}}"
export SQLALCHEMY_DATABASE_URI="$URI"

APP_DIR="$ROOT/api/app"
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
  echo "[ERRO] Nenhum tickets.sqlite3 encontrado."
  echo "       Uso: ./migrate.sh /caminho/tickets.sqlite3"
  exit 1
fi

echo "=== Migração SQLite -> Postgres ==="
echo "Fonte:  $SQLITE"
echo "Destino: $URI"
echo

PY="$(ensure_migrate_venv "$ROOT")"

WIPE_FLAG=(--wipe)
if [[ "${NO_WIPE:-0}" == "1" ]]; then
  WIPE_FLAG=()
fi

(
  cd "$APP_DIR"
  "$PY" tools/migrate_sqlite_to_postgres.py "${WIPE_FLAG[@]}" --sqlite "$SQLITE" --uri "$URI"
)

echo
echo "[OK] Migração concluída. Confira o resumo [OK] acima."
echo "     Verificar: docker compose exec -T postgres psql -U $DB_USER -d $APP_DB -c \"SELECT COUNT(*) FROM ticket;\""
