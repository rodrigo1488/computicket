#!/bin/bash
# Garante o database 'computicket' em um container Postgres ja em execucao.
set -euo pipefail

CONTAINER="${CONTAINER:-}"
if [ -z "$CONTAINER" ]; then
  CONTAINER="$(docker compose -f docker-compose.whatsapp.yml ps -q postgres 2>/dev/null || true)"
fi
if [ -z "$CONTAINER" ]; then
  CONTAINER="$(docker ps -qf 'ancestor=postgres:16.9' | head -n1)"
fi
if [ -z "$CONTAINER" ]; then
  echo "Nenhum container Postgres encontrado. Suba com: docker compose -f docker-compose.whatsapp.yml up -d postgres"
  exit 1
fi

USER_NAME="${WHATSAPP_DB_USER:-computicket}"
DB_NAME="${COMPUTICKET_APP_DB:-computicket}"

exists="$(docker exec "$CONTAINER" psql -U "$USER_NAME" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
if [ "$exists" != "1" ]; then
  docker exec "$CONTAINER" psql -U "$USER_NAME" -d postgres -c "CREATE DATABASE ${DB_NAME}"
  echo "Database '${DB_NAME}' criado no container $CONTAINER"
else
  echo "Database '${DB_NAME}' ja existe no container $CONTAINER"
fi
