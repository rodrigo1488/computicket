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
docker compose up -d --build
```

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
