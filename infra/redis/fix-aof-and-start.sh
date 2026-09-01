#!/bin/sh
# Redis 8: AOF multipart em /data/appendonlydir.
# incr.aof com "Bad file format" aborta o server; --aof-load-truncated não resolve.
# Remove incrementais (após backup) e sobe com o RDB base.
set -u

REDIS_ARGS="--appendonly yes --aof-load-truncated yes"

echo "computicket-redis: verificando AOF..."
echo "computicket-redis: /data =>"
ls -la /data 2>/dev/null || true
echo "computicket-redis: /data/appendonlydir =>"
ls -la /data/appendonlydir 2>/dev/null || true

ts=$(date +%Y%m%d%H%M%S)
dest="/data/aof-corrupt-backup-$ts"
mkdir -p "$dest"

incr_found=0
# find cobre /data e appendonlydir; -o sem parênteses ainda funciona no busybox/debian find.
for incr in $(find /data -maxdepth 2 -type f \( -name '*.incr.aof' -o -name 'appendonly.aof*.incr.aof' \) 2>/dev/null); do
	incr_found=1
	echo "computicket-redis: backup+remoção $incr"
	cp -a "$incr" "$dest"/ 2>/dev/null || true
	rm -f "$incr"
done

for manifest in $(find /data -maxdepth 2 -type f -name 'appendonly.aof.manifest' 2>/dev/null); do
	echo "computicket-redis: ajustando manifest $manifest"
	cp -a "$manifest" "$dest"/ 2>/dev/null || true
	grep -v "type i" "$manifest" > /tmp/aof.manifest || true
	if [ -s /tmp/aof.manifest ]; then
		cat /tmp/aof.manifest > "$manifest"
	fi
	rm -f /tmp/aof.manifest
done

if [ "$incr_found" -eq 0 ]; then
	echo "computicket-redis: nenhum .incr.aof encontrado."
else
	echo "computicket-redis: incrementais removidos; backup em $dest"
fi

echo "computicket-redis: iniciando redis-server..."
if [ -x /usr/local/bin/docker-entrypoint.sh ]; then
	exec /usr/local/bin/docker-entrypoint.sh redis-server $REDIS_ARGS
fi
if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
	exec gosu redis redis-server $REDIS_ARGS
fi
exec redis-server $REDIS_ARGS
