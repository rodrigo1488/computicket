# Documentação de Execução do Backend (Docker)

Este projeto utiliza Docker Compose para facilitar a execução dos serviços de banco de dados e cache necessários para o backend (Postgres e Redis).

## Pré-requisitos

- Docker e Docker Compose instalados.
- Arquivo `.env` configurado na raiz da pasta `backentd`.

## Configuração do .env

Crie um arquivo `.env` na pasta `backentd` com as variáveis necessárias. Abaixo está um exemplo básico compatível com o `docker-compose.databases.yml` e `build-and-run-docker-sql.sh`:

```env
# Banco de Dados
DB_HOST=localhost
DB_PORT=5432
DB_NAME=db_name
DB_USER=user
DB_PASS=senha
DB_DIALECT=postgres

# Redis
REDIS_PORT=6379
REDIS_PASS=123456
REDIS_DBS=redis
```
> **Nota:** Certifique-se de que as portas definidas não estão em uso no seu sistema.

## Iniciando os Bancos de Dados

Para subir os containers do Postgres e Redis, utilize o script facilitador `run-docker-sql.sh` (para Linux/Mac/WSL) ou execute o comando do docker compose diretamente.

### Opção 1: Usando o Script (Recomendado)

No terminal, dentro da pasta `backentd`:

```bash
./run-docker-sql.sh
```

Este script carrega as variáveis do `.env` e inicia os serviços definidos em `docker-compose.databases.yml`.

### Opção 2: Comando Manual

Se preferir rodar manualmente ou não puder usar o script bash:

```bash
docker compose -f docker-compose.databases.yml --env-file .env up
```

## Parando os Serviços

Para parar a execução, pressione `Ctrl+C` no terminal onde o docker está rodando. Para remover os containers, use:

```bash
docker compose -f docker-compose.databases.yml down
```
