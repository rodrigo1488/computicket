# Copiloto RAG

O Copiloto usa somente artigos com `status=published` e tickets com
`status=fechado`. `SystemConfig`, `PasswordVault` e anexos não fazem parte do
pipeline. Antes da indexação, HTML ativo, e-mails, telefones, CPF/CNPJ, chaves,
tokens e padrões comuns de senha são removidos.

## Configuração

Variáveis suportadas:

- `GEMINI_API_KEY` (obrigatória para embeddings e geração);
- `AI_CONFIG_ENCRYPTION_KEY` (opcional; chave estável dedicada para proteger a
  API key salva em Configurações → IA; sem ela, usa `SECRET_KEY`);
- `GEMINI_MODEL` (padrão `gemini-2.0-flash`);
- `GEMINI_EMBEDDING_MODEL` (padrão `gemini-embedding-001`);
- `GEMINI_EMBEDDING_DIMENSION` (deve ser `768`);
- `GEMINI_TIMEOUT_MS` (padrão `30000`, máximo `120000`);
- `COPILOT_RATE_LIMIT_PER_MINUTE` (padrão `20` por usuário/processo);
- `RAG_CHUNK_SIZE` (padrão `1200`);
- `RAG_CHUNK_OVERLAP` (padrão `180`);
- `RAG_MIN_SCORE` (padrão `0.35`);
- `RAG_SEARCH_SCAN_LIMIT` (padrão `3000`).

O SQLite continua suportado e armazena vetores como JSON. No PostgreSQL, a
busca semântica usa o índice HNSW do pgvector e combina seus candidatos com a
busca lexical. Use a
imagem `pgvector/pgvector:pg16` do `docker-compose.yml` e aplique a migração:

```sh
psql "postgresql://computicket:SENHA@localhost:15432/computicket" \
  -f api/migrations/001_copilot_rag_pg.sql
```

A migração é idempotente. A aplicação também garante a extensão antes de
`db.create_all`, facilitando instalações novas.

## Operação

Para indexar o acervo atual e remover chunks obsoletos:

```sh
flask --app run:app rag-reindex
```

Use `--keep-stale` somente para diagnóstico. Publicações/edições de artigos e
fechamentos de tickets são capturados após o commit e enviados a uma fila local
de uma thread. Falhas do Gemini não bloqueiam a operação original; nesse caso o
chunk sanitizado permanece pesquisável pelo fallback lexical e uma reindexação
posterior tenta preencher o vetor.

## API

Todas as rotas exigem sessão autenticada:

- `POST /helpdesk/api/ai/query` — `{question, conversation_id?}`;
- `POST /helpdesk/api/conversations/<id>/ai/suggest-reply` — body opcional;
- `POST /helpdesk/api/conversations/<id>/ai/improve` — `{text}`;
- `POST /helpdesk/api/conversations/<id>/ai/suggest-ticket`.

As respostas de texto têm `{draft, sources}`. A sugestão de ticket retorna
`{ticket: {title, description, solicitante, clientQuery}, sources}`.

A auditoria guarda hash SHA-256, quantidade de caracteres, operação, duração,
status e contagem de fontes. Prompt, histórico e resposta brutos não são
persistidos.

Administradores também podem configurar e testar a chave em
**Configurações → IA**. A chave salva tem precedência sobre `GEMINI_API_KEY`,
fica criptografada no banco e nunca é devolvida pela API.
