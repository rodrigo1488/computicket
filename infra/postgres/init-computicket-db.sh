#!/bin/bash
# Cria o database dedicado do app Computicket no mesmo cluster do WhatsApp.
# Roda automaticamente em /docker-entrypoint-initdb.d apenas na primeira
# inicializacao do volume. Em volumes ja existentes, use:
#   infra/postgres/ensure-computicket-db.sh
set -euo pipefail

DB_NAME="${COMPUTICKET_APP_DB:-computicket}"

exists="$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
if [ "$exists" != "1" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE ${DB_NAME}"
  echo "Database '${DB_NAME}' criado (init)."
else
  echo "Database '${DB_NAME}' ja existe (init)."
fi
