#!/bin/sh
# Redis 8 guarda o AOF em /data/appendonlydir (não na raiz de /data).
# incr.aof corrompido impede a subida; --aof-load-truncated não cobre "Bad file format".
# Sempre tenta reparar; se falhar, remove só os incrementais e sobe com o RDB base.
set -u

REDIS_ARGS="--appendonly yes --aof-load-truncated yes"

confirm_fix() {
	printf 'yes\n'
}

run_fix() {
	target=$1
	if [ ! -f "$target" ]; then
		return 0
	fi
	echo "computicket-redis: redis-check-aof --fix $target"
	if command -v timeout >/dev/null 2>&1; then
		confirm_fix | timeout 20 redis-check-aof --fix "$target" || true
	else
		confirm_fix | redis-check-aof --fix "$target" || true
	fi
}

dir_has_incr() {
	dir=$1
	for f in "$dir"/appendonly.aof*.incr.aof "$dir"/*.incr.aof; do
		[ -f "$f" ] && return 0
	done
	return 1
}

aof_ok() {
	dir=$1
	manifest="$dir/appendonly.aof.manifest"
	if [ -f "$manifest" ]; then
		redis-check-aof "$manifest" >/dev/null 2>&1 && return 0
		return 1
	fi
	# Sem manifest: qualquer incr.aof residual ainda pode matar o server.
	if dir_has_incr "$dir"; then
		return 1
	fi
	return 0
}

backup_dir() {
	dir=$1
	ts=$(date +%Y%m%d%H%M%S)
	dest="/data/aof-corrupt-backup-$ts"
	mkdir -p "$dest"
	cp -a "$dir"/. "$dest"/ 2>/dev/null || true
	echo "computicket-redis: backup AOF em $dest"
}

drop_incr() {
	dir=$1
	echo "computicket-redis: removendo incrementais em $dir (base RDB preservada)."
	backup_dir "$dir"
	rm -f "$dir"/appendonly.aof*.incr.aof "$dir"/*.incr.aof
	manifest="$dir/appendonly.aof.manifest"
	if [ -f "$manifest" ]; then
		grep -v "type i" "$manifest" > /tmp/aof.manifest || true
		if [ -s /tmp/aof.manifest ]; then
			cat /tmp/aof.manifest > "$manifest"
		fi
		rm -f /tmp/aof.manifest
	fi
}

discover_dirs() {
	# Redis 8: appenddirname=appendonlydir. Legado: arquivos soltos em /data.
	for dir in /data/appendonlydir /data; do
		[ -d "$dir" ] || continue
		if [ -f "$dir/appendonly.aof.manifest" ] || dir_has_incr "$dir"; then
			echo "$dir"
		fi
	done
}

echo "computicket-redis: verificando AOF..."
found=0
for dir in $(discover_dirs); do
	found=1
	echo "computicket-redis: AOF em $dir"
	manifest="$dir/appendonly.aof.manifest"
	if [ -f "$manifest" ]; then
		run_fix "$manifest"
	fi
	for incr in "$dir"/appendonly.aof*.incr.aof "$dir"/*.incr.aof; do
		[ -f "$incr" ] || continue
		run_fix "$incr"
	done
	if ! aof_ok "$dir"; then
		drop_incr "$dir"
	fi
done
if [ "$found" -eq 0 ]; then
	echo "computicket-redis: nenhum AOF incremental encontrado."
fi

echo "computicket-redis: iniciando redis-server..."
if [ -x /usr/local/bin/docker-entrypoint.sh ]; then
	exec /usr/local/bin/docker-entrypoint.sh redis-server $REDIS_ARGS
fi
if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
	exec gosu redis redis-server $REDIS_ARGS
fi
exec redis-server $REDIS_ARGS
