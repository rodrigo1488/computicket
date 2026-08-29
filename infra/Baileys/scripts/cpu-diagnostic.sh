#!/usr/bin/env bash
# Diagnóstico rápido de CPU — rodar na VPS: bash scripts/cpu-diagnostic.sh
set -euo pipefail

echo "=== PM2 ==="
pm2 list 2>/dev/null || echo "pm2 não encontrado"

echo ""
echo "=== Top processos (CPU) ==="
ps aux --sort=-%cpu | head -12

echo ""
echo "=== Node backend (PM2) ==="
pm2 show compumais-backend 2>/dev/null | grep -E "status|cpu|memory|restarts|uptime" || true

echo ""
echo "=== Load / CPU (1 linha) ==="
uptime

echo ""
echo "=== PostgreSQL: WhatsApps conectados (ajuste DATABASE_URL se necessário) ==="
if command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -t -c "SELECT status, count(*) FROM \"Whatsapps\" GROUP BY status ORDER BY count DESC;"
elif command -v psql >/dev/null 2>&1 && [ -n "${DB_HOST:-}" ]; then
  PGPASSWORD="${DB_PASS:-}" psql -h "${DB_HOST}" -U "${DB_USER:-postgres}" -d "${DB_NAME:-}" -t -c "SELECT status, count(*) FROM \"Whatsapps\" GROUP BY status ORDER BY count DESC;"
else
  echo "Defina DATABASE_URL ou DB_* para contar conexões WhatsApp."
fi

echo ""
echo "=== Variáveis de shard (se configuradas) ==="
echo "WHATSAPP_SHARD_INDEX=${WHATSAPP_SHARD_INDEX:-0}"
echo "WHATSAPP_SHARD_COUNT=${WHATSAPP_SHARD_COUNT:-1}"
echo "WHATSAPP_MAX_SESSIONS_PER_PROCESS=${WHATSAPP_MAX_SESSIONS_PER_PROCESS:-0 (ilimitado)}"
