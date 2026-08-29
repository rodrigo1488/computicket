#!/bin/sh
# Sobe o engine Baileys (backend_compuchat) contra o Postgres/Redis já
# publicados em 1861/6379, quando o docker.sock do Computicket não estiver
# acessível. O caminho preferido continua sendo:
#   docker compose -f docker-compose.whatsapp.yml up -d --build

set -e
ENGINE_DIR="${ENGINE_DIR:-/home/rodrigo/Documentos/dev/compuchat/backend_compuchat}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20 >/dev/null

cd "$ENGINE_DIR"
if [ ! -f dist/server.js ]; then
  echo "Compilando engine WhatsApp..."
  yarn build
fi
echo "Iniciando engine WhatsApp em :4000"
exec yarn start:prod
