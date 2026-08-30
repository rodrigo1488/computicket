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

echo "=== Pasta PS no host ==="
mkdir -p ./data/ps/ps-do-dia
# Se as PS foram copiadas em caminhos legados, espelha para data/ps (sem apagar origem)
for src in ./ps ./api/app/ps ./api/ps; do
  if [ -d "$src" ]; then
    echo "Sincronizando $src -> ./data/ps (rsync se disponível)"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a "$src"/ ./data/ps/
    else
      cp -an "$src"/. ./data/ps/ 2>/dev/null || true
    fi
  fi
done
ls -la ./data/ps | head -20
ls ./data/ps/ps-do-dia 2>/dev/null | head -10 || true

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
