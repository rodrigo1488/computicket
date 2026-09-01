"""Cliente Gemini compartilhado pelos serviços de IA."""
from __future__ import annotations

import os
import threading
from typing import Any

from flask import has_app_context


class GeminiConfigError(RuntimeError):
	"""Configuração obrigatória do Gemini ausente."""


class GeminiError(RuntimeError):
	"""Falha ao chamar o Gemini."""


_client: Any = None
_client_key: str | None = None
_lock = threading.Lock()


def _saved_setting(key: str) -> str:
	if not has_app_context():
		return ""
	from ..models import SystemConfig

	return (SystemConfig.get(key, "") or "").strip()


def api_key() -> str:
	saved = _saved_setting("gemini_api_key")
	if saved:
		from .config_secrets import decrypt_secret

		return decrypt_secret(saved)
	return (os.environ.get("GEMINI_API_KEY") or "").strip()


_DEPRECATED_GENERATION_MODELS = {
	"gemini-2.0-flash",
	"gemini-2.0-flash-001",
	"gemini-2.0-flash-lite",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	"gemini-1.5-flash",
	"gemini-1.5-flash-latest",
	"gemini-1.5-pro",
	"gemini-pro",
}

DEFAULT_GENERATION_MODEL = "gemini-3.6-flash"


def _normalize_generation_model(model: str) -> str:
	name = (model or "").strip()
	if not name:
		return DEFAULT_GENERATION_MODEL
	# Aceita tanto "gemini-3.6-flash" quanto "models/gemini-3.6-flash".
	bare = name.split("/", 1)[-1] if name.startswith("models/") else name
	if bare in _DEPRECATED_GENERATION_MODELS:
		return DEFAULT_GENERATION_MODEL
	return bare


def generation_model() -> str:
	raw = (
		_saved_setting("gemini_model")
		or os.environ.get("GEMINI_MODEL")
		or DEFAULT_GENERATION_MODEL
	)
	return _normalize_generation_model(raw)


def embedding_model() -> str:
	return (
		_saved_setting("gemini_embedding_model")
		or os.environ.get("GEMINI_EMBEDDING_MODEL")
		or "gemini-embedding-001"
	).strip()


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
		return max(1000, min(int(os.environ.get("GEMINI_TIMEOUT_MS") or "90000"), 120000))
	except ValueError:
		return 90000


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
