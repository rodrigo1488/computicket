# Computicket em Docker

Stack: **web** (Next) + **api** (Flask) + **whatsapp-engine** + **postgres** + **redis**.

## Portas (host)

| Serviço | Porta host | Porta interna | Observação |
|---------|------------|---------------|------------|
| Web | **3000** | 3000 | UI |
| API | **5000** | 5000 | Flask + Socket.IO (`/uniplus`) |
| WhatsApp | **4000** | 4000 | Engine Baileys |
| Postgres app | **15432** | 5432 | Databases `computicket` + `computicket_whatsapp` |
| Redis | **16379** | 6379 | |

**Não publique Postgres na 5432 do host.** Essa porta fica para o **Uniplus/ERP**.
Dentro da rede Docker, os containers usam `postgres:5432` normalmente.

Credenciais Unico (leituras da API / fallback): **Configurações → Uniplus** (SystemConfig), não `.env`.

## Subir tudo

```bash
# opcional: cp .env.example .env
./up.sh
# ou: docker compose up -d --build
```

O `up.sh` sobe o stack, garante o database `computicket`, aplica `api/migrations/*.sql` e migra `tickets.sqlite3` → Postgres (com `--wipe` se achar o SQLite).

Opções: `SKIP_BUILD=1`, `SKIP_MIGRATE=1`, `NO_WIPE=1`, `./up.sh /caminho/tickets.sqlite3`.

Só migrar dados (containers já no ar):

```bash
chmod +x migrate.sh
./migrate.sh
# ou: ./migrate.sh /caminho/tickets.sqlite3
```

O script cria `api/app/.venv` e instala `api/requirements.txt` se faltar `python-dotenv`.

Verificar após migrar:

```bash
docker compose exec -T postgres psql -U computicket -d computicket -c "SELECT COUNT(*) FROM ticket;"
```

### Permissão Docker no Linux

Se aparecer `permission denied ... docker.sock`, o usuário precisa do grupo `docker`:

```bash
sudo usermod -aG docker "$USER"
# saia e entre de novo no SSH (ou: newgrp docker)
./up.sh
```

Alternativa pontual: `sudo ./up.sh` (menos ideal no dia a dia).

UI: http://localhost:3000  
API: http://localhost:5000  

Só infra WhatsApp (legado):

```bash
docker compose -f docker-compose.whatsapp.yml up -d --build
```

## Postgres do app

URI **de fora** dos containers (host):

```
postgresql+psycopg2://computicket:computicket@localhost:15432/computicket
```

URI **entre** containers:

```
postgresql+psycopg2://computicket:computicket@postgres:5432/computicket
```

Ver também `infra/postgres/README.md`.

## Agente Uniplus

Continua **fora** deste compose (instalado no servidor Uniplus, `.exe` / `agents/uniplus_agent`).
Aponta a URL do Computicket para a API alcançável (ex.: `http://<host>:5000`).
