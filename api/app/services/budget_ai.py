"""Geração de orçamentos com Gemini (itens, condições e observações)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from ..models import Service
from ..rich_text_utils import sanitize_rich_html
from .faturamento_products import search_products

MIN_PROMPT_LEN = 15
MAX_PRODUCT_CANDIDATES = 40
MAX_SERVICE_CANDIDATES = 30

STOPWORDS = {
	"a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos",
	"e", "em", "no", "na", "nos", "nas", "para", "por", "com", "sem", "que", "se",
	"ao", "à", "às", "ou", "mais", "menos", "muito", "muita", "já", "só", "seu",
	"sua", "seus", "suas", "este", "esta", "esse", "essa", "isto", "isso", "como",
	"sobre", "entre", "até", "também", "há", "ser", "são", "foi", "era", "ter",
	"tem", "cliente", "orçamento", "orcamento", "preciso", "necessito", "quero",
	"fazer", "incluir", "inclua", "montar", "gere", "gerar", "favor", "porfavor",
}

BUDGET_JSON_SCHEMA: dict[str, Any] = {
	"type": "object",
	"properties": {
		"title": {"type": "string"},
		"description": {"type": "string"},
		"payment_terms": {"type": "string"},
		"internal_notes": {"type": "string"},
		"items": {
			"type": "array",
			"items": {
				"type": "object",
				"properties": {
					"item_type": {"type": "string", "enum": ["product", "service", "manual"]},
					"description": {"type": "string"},
					"quantity": {"type": "number"},
					"unit_price": {"type": "number"},
					"observations": {"type": "string"},
					"product_id": {"type": ["integer", "null"]},
					"service_id": {"type": ["integer", "null"]},
					"codigo": {"type": ["string", "null"]},
					"unit_of_measure": {"type": ["string", "null"]},
				},
				"required": [
					"item_type",
					"description",
					"quantity",
					"unit_price",
					"observations",
					"product_id",
					"service_id",
					"codigo",
					"unit_of_measure",
				],
			},
		},
	},
	"required": ["title", "description", "payment_terms", "internal_notes", "items"],
}

SYSTEM_INSTRUCTION = """Você é um assistente comercial de uma empresa de TI e infraestrutura.
Monte orçamentos profissionais em português do Brasil.

Regras:
- Use HTML simples apenas com <p>, <ul>, <li>, <strong>, <em>, <br>.
- Valores monetários em reais (BRL), realistas para o mercado brasileiro.
- Prefira produtos e serviços da lista de candidatos quando houver correspondência clara.
- Só use product_id, service_id, codigo e unit_of_measure se vierem exatamente da lista de candidatos.
- Se não houver match no catálogo, use item_type "manual" com product_id e service_id nulos.
- Para produtos do catálogo: item_type "product"; para serviços locais: item_type "service".
- payment_terms: condições visíveis ao cliente (pagamento, validade, garantia, prazo).
- internal_notes: anotações internas da equipe (margem, riscos, lembretes) — não para o cliente.
- description: introdução comercial curta do orçamento.
- title: título objetivo do orçamento.
- Cada item deve ter descrição clara; observations por item é opcional (string vazia se não houver).
- Inclua quantidade e preço unitário coerentes com a descrição do usuário.
"""


class BudgetAIConfigError(Exception):
	"""Chave ou configuração do Gemini ausente/inválida."""


class BudgetAIGenerationError(Exception):
	"""Falha ao gerar o orçamento com a IA."""


def get_gemini_api_key() -> str:
	return (os.environ.get("GEMINI_API_KEY") or "").strip()


def get_gemini_model() -> str:
	raw = (os.environ.get("GEMINI_MODEL") or "gemini-3.6-flash").strip()
	deprecated = {
		"gemini-2.0-flash",
		"gemini-2.0-flash-001",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gemini-1.5-flash",
		"gemini-1.5-pro",
		"gemini-pro",
	}
	bare = raw.split("/", 1)[-1] if raw.startswith("models/") else raw
	return "gemini-3.6-flash" if bare in deprecated else bare


def extract_search_terms(prompt: str, limit: int = 8) -> list[str]:
	"""Extrai termos úteis do prompt para buscar no catálogo."""
	normalized = (prompt or "").lower()
	normalized = re.sub(r"[^\w\sáàâãéêíóôõúç\-]", " ", normalized, flags=re.UNICODE)
	tokens = [t for t in re.split(r"\s+", normalized) if len(t) >= 3 and t not in STOPWORDS]

	terms: list[str] = []
	seen: set[str] = set()

	def add(term: str) -> None:
		term = term.strip()
		if not term or term in seen:
			return
		seen.add(term)
		terms.append(term)

	# Bigramas primeiro (ex.: "switch 24", "cabo rede")
	for i in range(len(tokens) - 1):
		add(f"{tokens[i]} {tokens[i + 1]}")
		if len(terms) >= limit:
			return terms

	for token in tokens:
		add(token)
		if len(terms) >= limit:
			break

	if not terms and prompt.strip():
		add(prompt.strip()[:40])

	return terms


def _fetch_product_candidates(prompt: str) -> list[dict[str, Any]]:
	terms = extract_search_terms(prompt)
	by_id: dict[int, dict[str, Any]] = {}

	queries = terms or [prompt.strip()[:40]]
	for q in queries:
		if len(by_id) >= MAX_PRODUCT_CANDIDATES:
			break
		try:
			results = search_products(q)
		except Exception:
			continue
		for row in results:
			pid = row.get("id")
			if pid is None or pid in by_id:
				continue
			by_id[pid] = {
				"id": pid,
				"codigo": row.get("codigo") or "",
				"nome": row.get("nome") or "",
				"unidademedida": row.get("unidademedida") or "",
				"preco": float(row.get("preco") or 0),
			}
			if len(by_id) >= MAX_PRODUCT_CANDIDATES:
				break

	return list(by_id.values())


def _fetch_service_candidates(prompt: str) -> list[dict[str, Any]]:
	terms = extract_search_terms(prompt)
	services = Service.query.order_by(Service.name.asc()).limit(200).all()
	if not services:
		return []

	scored: list[tuple[int, dict[str, Any]]] = []
	prompt_lower = (prompt or "").lower()

	for svc in services:
		name = (svc.name or "").strip()
		desc = (svc.description or "").strip()
		hay = f"{name} {desc}".lower()
		score = 0
		if name and name.lower() in prompt_lower:
			score += 5
		for term in terms:
			if term in hay:
				score += 2
		if score == 0 and not terms:
			score = 1
		if score > 0:
			scored.append((
				score,
				{
					"id": svc.id,
					"nome": name,
					"descricao": desc[:200],
					"preco": float(svc.hourly_rate or 0),
				},
			))

	scored.sort(key=lambda x: (-x[0], x[1]["nome"].lower()))
	# Se nenhum termo bateu, envia os primeiros serviços como contexto genérico
	if not scored:
		return [
			{
				"id": s.id,
				"nome": (s.name or "").strip(),
				"descricao": ((s.description or "").strip())[:200],
				"preco": float(s.hourly_rate or 0),
			}
			for s in services[:MAX_SERVICE_CANDIDATES]
		]

	return [item for _, item in scored[:MAX_SERVICE_CANDIDATES]]


def _build_user_contents(
	prompt: str,
	client_name: str | None,
	products: list[dict[str, Any]],
	services: list[dict[str, Any]],
) -> str:
	parts = [
		"Descrição do orçamento pelo vendedor:",
		prompt.strip(),
		"",
	]
	if client_name:
		parts.extend([f"Cliente: {client_name.strip()}", ""])

	parts.append("Candidatos de produtos do ERP (use apenas estes IDs/códigos se houver match):")
	if products:
		parts.append(json.dumps(products, ensure_ascii=False))
	else:
		parts.append("[]")

	parts.append("")
	parts.append("Candidatos de serviços locais (use apenas estes IDs se houver match):")
	if services:
		parts.append(json.dumps(services, ensure_ascii=False))
	else:
		parts.append("[]")

	parts.append("")
	parts.append(
		"Gere o orçamento completo. Prefira candidatos quando fizer sentido; "
		"caso contrário use itens manuais."
	)
	return "\n".join(parts)


def _safe_float(value: Any, default: float = 0.0) -> float:
	try:
		return max(float(value), 0.0)
	except (TypeError, ValueError):
		return default


def _post_process(
	raw: dict[str, Any],
	products: list[dict[str, Any]],
	services: list[dict[str, Any]],
) -> dict[str, Any]:
	products_by_id = {int(p["id"]): p for p in products if p.get("id") is not None}
	services_by_id = {int(s["id"]): s for s in services if s.get("id") is not None}

	items_out: list[dict[str, Any]] = []
	for item in raw.get("items") or []:
		if not isinstance(item, dict):
			continue

		description = sanitize_rich_html(item.get("description") or "")
		if not description.strip():
			continue

		item_type = (item.get("item_type") or "manual").strip()
		if item_type not in ("product", "service", "manual"):
			item_type = "manual"

		product_id = item.get("product_id")
		service_id = item.get("service_id")
		try:
			product_id = int(product_id) if product_id is not None else None
		except (TypeError, ValueError):
			product_id = None
		try:
			service_id = int(service_id) if service_id is not None else None
		except (TypeError, ValueError):
			service_id = None

		codigo = (item.get("codigo") or "").strip() or None
		unit_of_measure = (item.get("unit_of_measure") or "").strip() or None
		quantity = _safe_float(item.get("quantity"), 1.0) or 1.0
		unit_price = _safe_float(item.get("unit_price"), 0.0)
		observations = sanitize_rich_html(item.get("observations") or "") or ""

		if item_type == "product" and product_id in products_by_id:
			prod = products_by_id[product_id]
			codigo = (prod.get("codigo") or codigo or "")[:50] or None
			unit_of_measure = (prod.get("unidademedida") or unit_of_measure or "")[:20] or None
			if unit_price <= 0 and prod.get("preco"):
				unit_price = float(prod["preco"])
			# Se a descrição veio vazia de conteúdo útil, usa o nome do produto
			plain = re.sub(r"<[^>]+>", "", description).strip()
			if not plain:
				description = sanitize_rich_html(f"<p>{prod.get('nome') or 'Produto'}</p>")
			service_id = None
		elif item_type == "service" and service_id in services_by_id:
			svc = services_by_id[service_id]
			if unit_price <= 0 and svc.get("preco"):
				unit_price = float(svc["preco"])
			plain = re.sub(r"<[^>]+>", "", description).strip()
			if not plain:
				description = sanitize_rich_html(f"<p>{svc.get('nome') or 'Serviço'}</p>")
			product_id = None
			codigo = None
		else:
			# ID inválido ou sem match → item manual
			item_type = "manual"
			product_id = None
			service_id = None
			codigo = None
			unit_of_measure = unit_of_measure[:20] if unit_of_measure else None

		items_out.append({
			"item_type": item_type,
			"product_id": product_id,
			"service_id": service_id,
			"codigo": codigo,
			"unit_of_measure": unit_of_measure,
			"description": description,
			"quantity": quantity,
			"unit_price": unit_price,
			"observations": observations,
		})

	title = (raw.get("title") or "").strip() or "Orçamento"
	if len(title) > 200:
		title = title[:200]

	return {
		"title": title,
		"description": sanitize_rich_html(raw.get("description") or "") or "",
		"payment_terms": sanitize_rich_html(raw.get("payment_terms") or "") or "",
		"internal_notes": sanitize_rich_html(raw.get("internal_notes") or "") or "",
		"items": items_out,
	}


def test_gemini_connection() -> dict[str, Any]:
	"""Verifica chave, pacote e uma chamada mínima ao Gemini."""
	model = get_gemini_model()
	api_key = get_gemini_api_key()
	if not api_key:
		return {
			"ok": False,
			"has_key": False,
			"package_ok": False,
			"model": model,
			"error": "GEMINI_API_KEY não configurada no arquivo .env.",
		}

	try:
		from google import genai
	except ImportError:
		return {
			"ok": False,
			"has_key": True,
			"package_ok": False,
			"model": model,
			"error": "Pacote google-genai não instalado. No servidor: .venv\\Scripts\\pip install google-genai",
		}

	try:
		client = genai.Client(api_key=api_key)
		response = client.models.generate_content(
			model=model,
			contents='Responda apenas com a palavra OK.',
		)
		reply = (getattr(response, "text", None) or "").strip()
		return {
			"ok": True,
			"has_key": True,
			"package_ok": True,
			"model": model,
			"reply": reply[:120],
			"message": "Conexão com o Gemini OK.",
		}
	except Exception as exc:
		return {
			"ok": False,
			"has_key": True,
			"package_ok": True,
			"model": model,
			"error": f"Falha ao chamar o Gemini: {exc}",
		}


def generate_budget_draft(prompt: str, client_name: str | None = None) -> dict[str, Any]:
	"""Gera rascunho de orçamento via Gemini com match de catálogo."""
	prompt = (prompt or "").strip()
	if len(prompt) < MIN_PROMPT_LEN:
		raise BudgetAIGenerationError(
			f"Descreva o orçamento com pelo menos {MIN_PROMPT_LEN} caracteres."
		)

	api_key = get_gemini_api_key()
	if not api_key:
		raise BudgetAIConfigError(
			"GEMINI_API_KEY não configurada. Defina a variável no arquivo .env do servidor."
		)

	products = _fetch_product_candidates(prompt)
	services = _fetch_service_candidates(prompt)
	contents = _build_user_contents(prompt, client_name, products, services)

	try:
		from google import genai
	except ImportError as exc:
		raise BudgetAIConfigError(
			"Pacote google-genai não instalado. Execute: pip install google-genai"
		) from exc

	try:
		client = genai.Client(api_key=api_key)
		response = client.models.generate_content(
			model=get_gemini_model(),
			contents=contents,
			config={
				"system_instruction": SYSTEM_INSTRUCTION,
				"response_mime_type": "application/json",
				"response_json_schema": BUDGET_JSON_SCHEMA,
				"temperature": 0.4,
			},
		)
	except BudgetAIConfigError:
		raise
	except Exception as exc:
		raise BudgetAIGenerationError(
			f"Falha ao consultar o Gemini: {exc}"
		) from exc

	text = (getattr(response, "text", None) or "").strip()
	if not text:
		raise BudgetAIGenerationError("A IA retornou uma resposta vazia.")

	try:
		raw = json.loads(text)
	except json.JSONDecodeError as exc:
		raise BudgetAIGenerationError("A IA retornou JSON inválido.") from exc

	if not isinstance(raw, dict):
		raise BudgetAIGenerationError("Formato de resposta da IA inesperado.")

	processed = _post_process(raw, products, services)
	if not processed["items"]:
		raise BudgetAIGenerationError(
			"A IA não gerou itens utilizáveis. Tente detalhar melhor produtos, quantidades e serviços."
		)
	return processed
