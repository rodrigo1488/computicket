-- Copiloto RAG (PostgreSQL). Seguro para reaplicação.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id SERIAL PRIMARY KEY,
    source_type VARCHAR(30) NOT NULL,
    source_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    title VARCHAR(250) NOT NULL,
    content TEXT NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    source_fingerprint VARCHAR(64) NOT NULL,
    embedding vector(768),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_rag_source_chunk UNIQUE (source_type, source_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_source_type ON knowledge_chunk (source_type);
CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_source_id ON knowledge_chunk (source_id);
CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_fingerprint ON knowledge_chunk (fingerprint);
CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_source_fingerprint ON knowledge_chunk (source_fingerprint);
CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_embedding_hnsw
    ON knowledge_chunk USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ai_audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NULL REFERENCES "user"(id),
    operation VARCHAR(40) NOT NULL,
    conversation_id INTEGER NULL,
    prompt_hash VARCHAR(64) NOT NULL,
    input_chars INTEGER NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    error_code VARCHAR(80),
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ai_audit_log_user_id ON ai_audit_log (user_id);
CREATE INDEX IF NOT EXISTS ix_ai_audit_log_operation ON ai_audit_log (operation);
CREATE INDEX IF NOT EXISTS ix_ai_audit_log_conversation_id ON ai_audit_log (conversation_id);
CREATE INDEX IF NOT EXISTS ix_ai_audit_log_created_at ON ai_audit_log (created_at);
