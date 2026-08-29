# Postgres do Computicket (Docker)

O serviço `postgres` em `docker-compose.yml` (e no subset `docker-compose.whatsapp.yml`)
hospeda dois databases no **mesmo** container:

| Database | Uso |
|----------|-----|
| `computicket_whatsapp` | Engine WhatsApp / Baileys |
| `computicket` | App Flask (tickets, users, orçamentos, etc.) |

## Portas — não colidir com Uniplus

| Onde | Porta |
|------|-------|
| **Host** (seu Windows/Linux) | **15432** → mapeia para 5432 no container |
| **Rede Docker** (`postgres` hostname) | **5432** interno |
| **Uniplus / ERP** | **5432** no host (ou servidor Uniplus) — **não** reutilizar para este Postgres |

## URI da aplicação

Do host (API local / migração):

```
postgresql+psycopg2://computicket:computicket@localhost:15432/computicket
```

Entre containers (serviço `api` no compose):

```
postgresql+psycopg2://computicket:computicket@postgres:5432/computicket
```

Defina em `api/app/.env` só se rodar a API **fora** do Docker:

```
SQLALCHEMY_DATABASE_URI=postgresql+psycopg2://computicket:computicket@localhost:15432/computicket
```

Credenciais: `COMPUTICKET_DB_USER` / `COMPUTICKET_DB_PASS` (ver `.env.example` na raiz).

## Criar o database

- **Volume novo:** `init-computicket-db.sh` no first boot.
- **Volume já existente:**

```bash
./infra/postgres/ensure-computicket-db.sh
```

## Migrar SQLite

```bat
migrate-sqlite-to-postgres.bat
```

Detalhes em `docs/DOCKER.md`.
