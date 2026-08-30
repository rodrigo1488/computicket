"""Cliente Gemini compartilhado pelos serviços de IA."""
from __future__ import annotations

import os
import threading
from typing import Any


class GeminiConfigError(RuntimeError):
	"""Configuração obrigatória do Gemini ausente."""


class GeminiError(RuntimeError):
	"""Falha ao chamar o Gemini."""


_client: Any = None
_client_key: str | None = None
_lock = threading.Lock()


def api_key() -> str:
	return (os.environ.get("GEMINI_API_KEY") or "").strip()


def generation_model() -> str:
	return (os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash").strip()


def embedding_model() -> str:
	return (os.environ.get("GEMINI_EMBEDDING_MODEL") or "gemini-embedding-001").strip()


def embedding_dimension() -> int:
	try:
		value = int(os.environ.get("GEMINI_EMBEDDING_DIMENSION") or "768")
	except ValueError:
		value = 768
	if value != 768:
		raise GeminiConfigError("GEMINI_EMBEDDING_DIMENSION deve ser 768 para o schema atual.")
	return value


def timeout_ms() -> int:
	try:
		return max(1000, min(int(os.environ.get("GEMINI_TIMEOUT_MS") or "30000"), 120000))
	except ValueError:
		return 30000


def get_client():
	"""Retorna um cliente reutilizável, recriando-o se a chave mudar."""
	global _client, _client_key
	key = api_key()
	if not key:
		raise GeminiConfigError("GEMINI_API_KEY não configurada.")
	with _lock:
		if _client is not None and _client_key == key:
			return _client
		try:
			from google import genai
			from google.genai import types
		except ImportError as exc:
			raise GeminiConfigError("Pacote google-genai não instalado.") from exc
		_client = genai.Client(
			api_key=key,
			http_options=types.HttpOptions(timeout=timeout_ms()),
		)
		_client_key = key
		return _client


def embed_texts(texts: list[str]) -> list[list[float]]:
	if not texts:
		return []
	try:
		response = get_client().models.embed_content(
			model=embedding_model(),
			contents=texts,
			config={"output_dimensionality": embedding_dimension()},
		)
		vectors = [list(item.values) for item in (response.embeddings or [])]
	except GeminiConfigError:
		raise
	except Exception as exc:
		raise GeminiError(f"Falha ao gerar embeddings: {exc}") from exc
	if len(vectors) != len(texts) or any(len(v) != embedding_dimension() for v in vectors):
		raise GeminiError("O Gemini retornou embeddings com dimensão inesperada.")
	return vectors
