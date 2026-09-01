#!/usr/bin/env bash
# Sobe o stack Docker do Computicket e migra tickets.sqlite3 -> Postgres (se existir).
#
# Uso (na raiz do repo):
#   chmod +x up.sh
#   ./up.sh
#   ./up.sh /caminho/tickets.sqlite3
#
# Variaveis opcionais:
#   COMPOSE_FILE=docker-compose.yml   (default)
#   SKIP_PULL=1                       nao faz git pull
#   SKIP_BUILD=1                      nao rebuilda imagens
#   SKIP_MIGRATE=1                    sobe containers e nao migra SQLite (recomendado apos 1a migracao)
#   FORCE_WIPE=1                      migra com --wipe (preserva system_config / Uniplus)
#   NO_WIPE=1                         legado (wipe ja e off por padrao)
#   SQLALCHEMY_DATABASE_URI=...       destino (default localhost:15432/computicket)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[ERRO] Nao encontrei $COMPOSE_FILE em $ROOT"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERRO] Docker nao encontrado no PATH."
  exit 1
fi

# Acesso ao socket (usuario precisa estar no grupo docker, ou usar sudo)
if ! docker info >/dev/null 2>&1; then
  echo "[ERRO] Sem permissao no Docker (socket /var/run/docker.sock)."
  echo
  echo "Corriga com (uma vez, como root/sudo):"
  echo "  sudo usermod -aG docker \"\$USER\""
  echo "  # depois: saia e entre de novo no SSH (ou: newgrp docker)"
  echo
  echo "Ou rode agora com:"
  echo "  sudo ./up.sh"
  echo
  exit 1
fi

DB_USER="${COMPUTICKET_DB_USER:-computicket}"
DB_PASS="${COMPUTICKET_DB_PASS:-computicket}"
APP_DB="${COMPUTICKET_APP_DB:-computicket}"
PG_PORT="${COMPUTICKET_PG_PORT:-15432}"
URI="${SQLALCHEMY_DATABASE_URI:-postgresql+psycopg2://${DB_USER}:${DB_PASS}@localhost:${PG_PORT}/${APP_DB}}"
export SQLALCHEMY_DATABASE_URI="$URI"

APP_DIR="$ROOT/api/app"
# shellcheck source=infra/postgres/ensure-migrate-venv.sh
source "$ROOT/infra/postgres/ensure-migrate-venv.sh"

APP_SERVICES=(whatsapp-engine api web)

echo
echo "=== Computicket: pull + rebuild api/web/engine ==="
echo "Repo:    $ROOT"
echo "Compose: $COMPOSE_FILE"
echo "Destino: ${APP_DB} @ localhost:${PG_PORT}"
echo

# ---- 0) Codigo ----
if [[ "${SKIP_PULL:-0}" == "1" ]]; then
  echo "[0/6] SKIP_PULL=1 — git pull ignorado."
elif [[ -d "$ROOT/.git" ]] && command -v git >/dev/null 2>&1; then
  echo "[0/6] Atualizando codigo (git pull --ff-only)..."
  git pull --ff-only
  echo "      Repo atualizado."
else
  echo "[0/6] Sem repositorio git — pulando pull."
fi

# ---- 1) Infra (sem force-recreate, sem mexer em volumes) ----
echo "[1/6] Garantindo postgres e redis..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis
echo "      Infra em subida."

# ---- 2) Postgres e Redis healthy ----
echo "[2/6] Aguardando Postgres healthy..."
tries=0
until docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_isready -U "$DB_USER" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [[ $tries -ge 60 ]]; then
    echo "[ERRO] Timeout aguardando Postgres."
    docker compose -f "$COMPOSE_FILE" logs postgres --tail 80 || true
    exit 1
  fi
  sleep 2
done
echo "      Postgres OK."

echo "      Aguardando Redis healthy..."
tries=0
until docker compose -f "$COMPOSE_FILE" exec -T redis \
  redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG; do
  tries=$((tries + 1))
  if [[ $tries -ge 30 ]]; then
    echo "[ERRO] Timeout aguardando Redis (healthcheck/IPv6 ou processo fora)."
    docker compose -f "$COMPOSE_FILE" ps redis || true
    docker compose -f "$COMPOSE_FILE" logs redis --tail 80 || true
    exit 1
  fi
  sleep 2
done
echo "      Redis OK."

# ---- 3) Database app ----
echo "[3/6] Garantindo database \"${APP_DB}\"..."
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
  echo "      Database ja existe."
fi

# ---- 4) Migracao SQL opcional (ex.: RAG) ----
if [[ -d "$ROOT/api/migrations" ]]; then
  echo "[4/6] Aplicando scripts em api/migrations/ (se houver)..."
  shopt -s nullglob
  for sql in "$ROOT/api/migrations"/*.sql; do
    echo "      -> $(basename "$sql")"
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$DB_USER" -d "$APP_DB" -v ON_ERROR_STOP=1 <"$sql" \
      || echo "      (aviso) falha ao aplicar $(basename "$sql") — pode ja ter sido aplicado."
  done
  shopt -u nullglob
else
  echo "[4/6] Sem pasta api/migrations/ — pulando."
fi

# ---- 5) Rebuild api, web e whatsapp-engine ----
# O CMD do engine (infra/whatsapp-engine/Dockerfile) roda:
#   npx sequelize db:migrate; npx sequelize db:seed:all || true; exec node dist/server.js
# server.ts chama ensureTicketsAllowMultiplePerContact (drop UNIQUE contactid_companyid_unique).
# Recreate desses 3 servicos aplica o codigo novo e o migrate; nao mexe em postgres/redis/volumes/.env.
echo "[5/6] Rebuild e recreate: ${APP_SERVICES[*]}..."
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "      SKIP_BUILD=1 — sem build, so recreate."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "${APP_SERVICES[@]}"
else
  docker compose -f "$COMPOSE_FILE" build "${APP_SERVICES[@]}"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "${APP_SERVICES[@]}"
fi
docker compose -f "$COMPOSE_FILE" up -d
echo "      Engine aplica sequelize db:migrate no start (e o drop UNIQUE no startup)."

# ---- 6) SQLite -> Postgres ----
if [[ "${SKIP_MIGRATE:-0}" == "1" ]]; then
  echo "[6/6] SKIP_MIGRATE=1 — migracao SQLite ignorada."
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
    echo "[6/6] Nenhum tickets.sqlite3 encontrado — pulando migracao de dados."
    echo "      Passe o caminho: ./up.sh /caminho/tickets.sqlite3"
  else
    echo "[6/6] Migrando SQLite -> Postgres"
    echo "      Fonte: $SQLITE"
    PY="$(ensure_migrate_venv "$ROOT")"

    WIPE_FLAG=()
    if [[ "${FORCE_WIPE:-0}" == "1" ]]; then
      echo "      FORCE_WIPE=1 — wipe ativo (system_config preservada)."
      WIPE_FLAG=(--wipe)
    else
      echo "      Sem wipe (padrao). Use FORCE_WIPE=1 so se quiser limpar o destino."
    fi

    (
      cd "$APP_DIR"
      "$PY" tools/migrate_sqlite_to_postgres.py "${WIPE_FLAG[@]}" --sqlite "$SQLITE" --uri "$URI"
    )
    echo "      Migracao SQLite concluida."
    echo "      Verificar: docker compose exec -T postgres psql -U $DB_USER -d $APP_DB -c \"SELECT COUNT(*) FROM ticket;\""
  fi
fi

echo
echo "[OK] Stack no ar."
echo "     Web:      http://localhost:${COMPUTICKET_WEB_PORT:-3000}"
echo "     API:      http://localhost:${COMPUTICKET_API_PORT:-5000}"
echo "     WhatsApp: http://localhost:${COMPUTICKET_WHATSAPP_PORT:-4000}"
echo "     Postgres: localhost:${PG_PORT} (nao use 5432 — reservado ao Uniplus)"
echo