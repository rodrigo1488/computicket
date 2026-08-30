"""Indexação incremental e busca híbrida do Copiloto."""
from __future__ import annotations

import hashlib
import html
import math
import os
import re
from html.parser import HTMLParser
from typing import Iterable

from sqlalchemy import or_, type_coerce

from .. import db
from ..models import KnowledgeArticle, KnowledgeChunk, Ticket
from .gemini_client import GeminiConfigError, GeminiError, embed_texts

SOURCE_ARTICLE = "knowledge_article"
SOURCE_TICKET = "ticket"
ALLOWED_SOURCES = {SOURCE_ARTICLE, SOURCE_TICKET}

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
_PHONE = re.compile(r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]?\d{4}(?!\d)")
_DOCUMENT = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)|(?<!\d)\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}(?!\d)")
_SECRET = re.compile(
	r"(?i)\b(api[_-]?key|token|secret|senha|password|passwd|authorization)\b\s*[:=]\s*[\"']?[^\s,;\"']{4,}"
)
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")
_PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S)
_TOKEN = re.compile(r"\b[\w.-]+\b", re.UNICODE)


class _TextExtractor(HTMLParser):
	def __init__(self):
		super().__init__()
		self.parts: list[str] = []
		self.hidden = 0

	def handle_starttag(self, tag, attrs):
		if tag.lower() in {"script", "style"}:
			self.hidden += 1
		elif tag.lower() in {"p", "br", "li", "div", "h1", "h2", "h3", "tr"}:
			self.parts.append("\n")

	def handle_endtag(self, tag):
		if tag.lower() in {"script", "style"} and self.hidden:
			self.hidden -= 1
		elif tag.lower() in {"p", "li", "div", "h1", "h2", "h3", "tr"}:
			self.parts.append("\n")

	def handle_data(self, data):
		if not self.hidden:
			self.parts.append(data)


def sanitize_for_rag(value: str | None) -> str:
	"""Remove markup ativo, PII e padrões comuns de credenciais."""
	parser = _TextExtractor()
	try:
		parser.feed(value or "")
		text = " ".join(parser.parts)
	except Exception:
		text = re.sub(r"<[^>]+>", " ", value or "")
	text = html.unescape(text)
	text = _PRIVATE_KEY.sub("[SEGREDO REMOVIDO]", text)
	text = _BEARER.sub("Bearer [SEGREDO REMOVIDO]", text)
	text = _SECRET.sub(lambda m: f"{m.group(1)}=[SEGREDO REMOVIDO]", text)
	text = _EMAIL.sub("[EMAIL REMOVIDO]", text)
	text = _DOCUMENT.sub("[DOCUMENTO REMOVIDO]", text)
	text = _PHONE.sub("[TELEFONE REMOVIDO]", text)
	return re.sub(r"\s+", " ", text).strip()


def fingerprint(value: str) -> str:
	return hashlib.sha256(value.encode("utf-8")).hexdigest()


def chunk_text(value: str, size: int | None = None, overlap: int | None = None) -> list[str]:
	size = size or int(os.environ.get("RAG_CHUNK_SIZE") or "1200")
	overlap = overlap if overlap is not None else int(os.environ.get("RAG_CHUNK_OVERLAP") or "180")
	size = max(300, min(size, 4000))
	overlap = max(0, min(overlap, size // 2))
	if len(value) <= size:
		return [value] if value else []
	chunks: list[str] = []
	start = 0
	while start < len(value):
		end = min(start + size, len(value))
		if end < len(value):
			break_at = max(value.rfind(". ", start, end), value.rfind("\n", start, end), value.rfind(" ", start, end))
			if break_at > start + size // 2:
				end = break_at + 1
		chunk = value[start:end].strip()
		if chunk:
			chunks.append(chunk)
		if end >= len(value):
			break
		start = max(start + 1, end - overlap)
	return chunks


def _source_data(source_type: str, source_id: int) -> tuple[str, str] | None:
	if source_type == SOURCE_ARTICLE:
		row = db.session.get(KnowledgeArticle, source_id)
		if not row or row.status != "published":
			return None
		return row.title, " ".join(filter(None, [row.title, row.summary, row.tags, row.content]))
	if source_type == SOURCE_TICKET:
		row = db.session.get(Ticket, source_id)
		if not row or row.status != "fechado":
			return None
		return row.title, " ".join(filter(None, [row.title, row.description]))
	raise ValueError("Tipo de fonte não permitido.")


def index_source(source_type: str, source_id: int) -> dict:
	"""Atualiza uma fonte atomicamente; sem Gemini mantém índice lexical."""
	if source_type not in ALLOWED_SOURCES:
		raise ValueError("Tipo de fonte não permitido.")
	data = _source_data(source_type, source_id)
	existing = KnowledgeChunk.query.filter_by(source_type=source_type, source_id=source_id).all()
	if data is None:
		for row in existing:
			db.session.delete(row)
		db.session.commit()
		return {"source_type": source_type, "source_id": source_id, "removed": len(existing), "indexed": 0}

	title, raw = data
	clean_title = sanitize_for_rag(title)[:250] or f"{source_type} #{source_id}"
	clean = sanitize_for_rag(raw)
	source_hash = fingerprint(f"{clean_title}\n{clean}")
	if existing and all(row.source_fingerprint == source_hash and row.embedding is not None for row in existing):
		return {"source_type": source_type, "source_id": source_id, "removed": 0, "indexed": 0, "unchanged": True}

	parts = chunk_text(clean)
	vectors: list[list[float] | None]
	try:
		vectors = list(embed_texts(parts))
	except (GeminiConfigError, GeminiError):
		vectors = [None] * len(parts)

	by_index = {row.chunk_index: row for row in existing}
	for index, content in enumerate(parts):
		row = by_index.pop(index, None)
		if row is None:
			row = KnowledgeChunk(source_type=source_type, source_id=source_id, chunk_index=index)
			db.session.add(row)
		row.title = clean_title
		row.content = content
		row.fingerprint = fingerprint(content)
		row.source_fingerprint = source_hash
		row.embedding = vectors[index]
	for stale in by_index.values():
		db.session.delete(stale)
	db.session.commit()
	return {
		"source_type": source_type,
		"source_id": source_id,
		"removed": len(by_index),
		"indexed": len(parts),
		"embedded": sum(vector is not None for vector in vectors),
	}


def reindex_all(remove_stale: bool = True) -> dict:
	article_ids = [row.id for row in KnowledgeArticle.query.filter_by(status="published").all()]
	ticket_ids = [row.id for row in Ticket.query.filter_by(status="fechado").all()]
	valid = {(SOURCE_ARTICLE, item) for item in article_ids} | {(SOURCE_TICKET, item) for item in ticket_ids}
	results = [index_source(SOURCE_ARTICLE, item) for item in article_ids]
	results.extend(index_source(SOURCE_TICKET, item) for item in ticket_ids)
	removed = 0
	if remove_stale:
		for row in KnowledgeChunk.query.all():
			if (row.source_type, row.source_id) not in valid:
				db.session.delete(row)
				removed += 1
		db.session.commit()
	return {"sources": len(results), "chunks": KnowledgeChunk.query.count(), "removed": removed}


def _tokens(value: str) -> set[str]:
	return {token.lower() for token in _TOKEN.findall(value) if len(token) > 2}


def _cosine(left: Iterable[float] | None, right: Iterable[float] | None) -> float:
	if left is None or right is None:
		return 0.0
	a, b = list(left), list(right)
	if len(a) != len(b):
		return 0.0
	dot = sum(x * y for x, y in zip(a, b))
	norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
	return max(0.0, dot / norm) if norm else 0.0


def _lexical_score(clean: str, terms: set[str], row: KnowledgeChunk) -> float:
	row_text = f"{row.title} {row.content}"
	row_tokens = _tokens(row_text)
	score = len(terms & row_tokens) / max(len(terms), 1)
	if clean.lower() in row_text.lower():
		score = max(score, 0.9)
	return score


def _postgres_candidates(
	query_vector: list[float],
	terms: set[str],
	candidate_limit: int,
) -> tuple[list[KnowledgeChunk], dict[int, float]]:
	"""Usa o índice HNSW e combina candidatos lexicais sem varrer a tabela."""
	from pgvector.sqlalchemy import Vector

	vector_column = type_coerce(KnowledgeChunk.embedding, Vector(768))
	distance = vector_column.cosine_distance(query_vector)
	vector_rows = (
		db.session.query(KnowledgeChunk, distance.label("distance"))
		.filter(KnowledgeChunk.embedding.isnot(None))
		.order_by(distance)
		.limit(candidate_limit)
		.all()
	)
	vector_scores = {
		row.id: max(0.0, 1.0 - float(vector_distance))
		for row, vector_distance in vector_rows
		if vector_distance is not None
	}
	candidates = {row.id: row for row, _distance in vector_rows}

	if terms:
		clauses = []
		for term in sorted(terms)[:12]:
			pattern = f"%{term}%"
			clauses.extend((KnowledgeChunk.title.ilike(pattern), KnowledgeChunk.content.ilike(pattern)))
		for row in KnowledgeChunk.query.filter(or_(*clauses)).limit(candidate_limit).all():
			candidates[row.id] = row

	return list(candidates.values()), vector_scores


def _source_link(row: KnowledgeChunk) -> dict:
	if row.source_type == SOURCE_TICKET:
		return {"href": f"/tickets/{row.source_id}"}
	if row.source_type == SOURCE_ARTICLE:
		article = db.session.get(KnowledgeArticle, row.source_id)
		if article:
			return {
				"category_id": article.category_id,
				"href": f"/conhecimento/{article.category_id}",
			}
	return {}


def hybrid_search(query: str, limit: int = 6) -> list[dict]:
	clean = sanitize_for_rag(query)
	if not clean:
		return []
	query_vector = None
	try:
		query_vector = embed_texts([clean])[0]
	except (GeminiConfigError, GeminiError):
		pass
	terms = _tokens(clean)
	try:
		scan_limit = max(100, min(int(os.environ.get("RAG_SEARCH_SCAN_LIMIT") or "3000"), 20000))
	except ValueError:
		scan_limit = 3000
	vector_scores: dict[int, float] = {}
	is_postgres = db.session.get_bind().dialect.name == "postgresql"
	if query_vector is not None and is_postgres:
		try:
			rows, vector_scores = _postgres_candidates(
				query_vector,
				terms,
				max(40, min(scan_limit, max(limit, 1) * 12)),
			)
		except Exception:
			# Mantém o copiloto disponível caso o índice/extensão ainda não tenha sido migrado.
			db.session.rollback()
			rows = KnowledgeChunk.query.limit(scan_limit).all()
	else:
		rows = KnowledgeChunk.query.limit(scan_limit).all()
	scored: list[tuple[float, KnowledgeChunk]] = []
	try:
		min_score = max(0.0, min(float(os.environ.get("RAG_MIN_SCORE") or "0.35"), 1.0))
	except ValueError:
		min_score = 0.35
	for row in rows:
		lexical = _lexical_score(clean, terms, row)
		vector = vector_scores.get(row.id)
		if vector is None:
			vector = _cosine(query_vector, row.embedding)
		has_vector = row.id in vector_scores or row.embedding is not None
		score = (0.65 * vector + 0.35 * lexical) if query_vector is not None and has_vector else lexical
		if score >= min_score:
			scored.append((score, row))
	scored.sort(key=lambda item: item[0], reverse=True)
	results = []
	for score, row in scored[: max(1, min(limit, 12))]:
		result = {
			"source_type": row.source_type,
			"source_id": row.source_id,
			"title": row.title,
			"snippet": row.content[:320],
			"score": round(score, 4),
		}
		result.update(_source_link(row))
		results.append(result)
	return results
