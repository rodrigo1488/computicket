#!/bin/sh
# Repara AOF incremental corrompido (shutdown sujo no Redis 8) e sobe o servidor.
# Nunca bloqueia a subida: se o reparo falhar, tenta o redis-server mesmo assim.
set -u

REDIS_ARGS="--appendonly yes --aof-load-truncated yes"
MANIFEST=/data/appendonly.aof.manifest

confirm_fix() {
	# redis-check-aof --fix exige a palavra "yes", não "y".
	printf 'yes\n'
}

run_fix() {
	target=$1
	if [ ! -f "$target" ]; then
		return 0
	fi
	if command -v timeout >/dev/null 2>&1; then
		confirm_fix | timeout 20 redis-check-aof --fix "$target" || true
	else
		confirm_fix | redis-check-aof --fix "$target" || true
	fi
}

aof_ok() {
	if [ ! -f "$MANIFEST" ]; then
		return 0
	fi
	redis-check-aof "$MANIFEST" >/dev/null 2>&1
}

backup_aof() {
	ts=$(date +%Y%m%d%H%M%S)
	dest="/data/aof-corrupt-backup-$ts"
	mkdir -p "$dest"
	cp -a /data/appendonly.aof* "$dest"/ 2>/dev/null || true
	echo "computicket-redis: backup AOF em $dest"
}

drop_incr() {
	echo "computicket-redis: AOF incremental irrecuperável — removendo .incr.aof (RDB preservado)."
	backup_aof
	rm -f /data/appendonly.aof*.incr.aof
	if [ -f "$MANIFEST" ]; then
		# Sem pipefail: grep=1 (nenhuma linha) não pode derrubar o script.
		grep -v "type i" "$MANIFEST" > /tmp/aof.manifest || true
		cat /tmp/aof.manifest > "$MANIFEST" 2>/dev/null || true
		rm -f /tmp/aof.manifest
	fi
}

drop_all_aof() {
	echo "computicket-redis: AOF ainda inválido — pondo de lado para subir com RDB."
	backup_aof
	rm -f /data/appendonly.aof /data/appendonly.aof.* 2>/dev/null || true
}

echo "computicket-redis: verificando AOF..."
if [ -f "$MANIFEST" ]; then
	echo "computicket-redis: tentando redis-check-aof --fix..."
	run_fix "$MANIFEST"
	for incr in /data/appendonly.aof*.incr.aof; do
		[ -f "$incr" ] || continue
		run_fix "$incr"
	done
	if ! aof_ok; then
		drop_incr
	fi
	if ! aof_ok; then
		drop_all_aof
	fi
fi

echo "computicket-redis: iniciando redis-server..."
if [ -x /usr/local/bin/docker-entrypoint.sh ]; then
	exec /usr/local/bin/docker-entrypoint.sh redis-server $REDIS_ARGS
fi
if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
	exec gosu redis redis-server $REDIS_ARGS
fi
exec redis-server $REDIS_ARGS
