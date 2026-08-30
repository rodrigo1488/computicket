#!/usr/bin/env bash
# Limpeza segura de disco + deploy Computicket (não apaga volumes de dados).
set -euo pipefail
cd /home/deploy/computicket

echo "=== ANTES ==="
df -h /
docker system df || true

echo "=== Prune seguro (sem volumes) ==="
docker system prune -f
docker image prune -f
docker builder prune -f || true

echo "=== Pasta PS no host (/home/deploy/computicket/ps) ==="
mkdir -p ./ps/ps-do-dia
# Legado data/ps → canônico ./ps (sem apagar origem)
for src in ./data/ps ./api/app/ps ./api/ps; do
  if [ -d "$src" ] && [ "$src" != "./ps" ]; then
    echo "Sincronizando $src -> ./ps (rsync se disponível)"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a "$src"/ ./ps/
    else
      cp -an "$src"/. ./ps/ 2>/dev/null || true
    fi
  fi
done
ls -la ./ps | head -20
ls ./ps/ps-do-dia 2>/dev/null | head -10 || true

echo "=== Git + rebuild ==="
git fetch --all --prune
git pull --ff-only
docker compose build api web
docker compose up -d
docker compose exec -T api mkdir -p /app/ps/ps-do-dia

echo "=== DEPOIS ==="
df -h /
docker system df || true
docker compose ps
docker compose exec -T api sh -c 'ls /app/ps/ps-do-dia 2>&1 | head -10'
curl -sf -o /dev/null -w "api_tcp=%{http_code}\n" http://127.0.0.1:5000/ || true
echo "ZZDEPLOY_DONE_ZZ"
