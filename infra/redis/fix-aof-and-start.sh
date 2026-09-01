#!/bin/sh
# Sobe o Redis 8 mesmo com AOF incremental corrompido (shutdown sujo).
# 1) tenta redis-check-aof --fix no manifest
# 2) se ainda inválido, descarta só o .incr.aof e mantém o RDB base
set -eu

MANIFEST=/data/appendonly.aof.manifest
REDIS_ARGS="--appendonly yes --aof-load-truncated yes"

aof_ok() {
  if [ ! -f "$MANIFEST" ]; then
    return 0
  fi
  redis-check-aof "$MANIFEST" >/dev/null 2>&1
}

try_fix() {
  if [ ! -f "$MANIFEST" ]; then
    return 0
  fi
  echo "computicket-redis: tentando redis-check-aof --fix no manifest..."
  yes | redis-check-aof --fix "$MANIFEST" || true
  for incr in /data/appendonly.aof*.incr.aof; do
    [ -f "$incr" ] || continue
    yes | redis-check-aof --fix "$incr" || true
  done
}

drop_incr() {
  echo "computicket-redis: AOF incremental irrecuperável — backup e drop (RDB base preservado)."
  ts=$(date +%Y%m%d%H%M%S)
  dest="/data/aof-corrupt-backup-$ts"
  mkdir -p "$dest"
  cp -a /data/appendonly.aof* "$dest"/ 2>/dev/null || true
  rm -f /data/appendonly.aof*.incr.aof
  if [ -f "$MANIFEST" ]; then
    grep -v "type i" "$MANIFEST" > /tmp/aof.manifest
    cat /tmp/aof.manifest > "$MANIFEST"
    rm -f /tmp/aof.manifest
  fi
}

try_fix
if ! aof_ok; then
  drop_incr
fi

exec redis-server $REDIS_ARGS
