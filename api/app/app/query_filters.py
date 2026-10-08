"""Filtros de coluna enviados pelo DataTable (col_filters JSON)."""
from __future__ import annotations

import json
import unicodedata
from datetime import date, datetime
from typing import Any, Iterable

from flask import request
from sqlalchemy import Float, String, cast, func


def _norm(key: str) -> str:
	raw = unicodedata.normalize("NFKD", key or "")
	raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
	return raw.strip().lower().replace(" ", "_")


ALIASES = {
	"nome": "name",
	"titulo": "title",
	"cliente": "client_name",
	"documento": "document",
	"telefone": "phone",
	"e-mail": "email",
	"email": "email",
	"contrato": "contract_type",
	"servico": "category",
	"situacao": "status",
	"status": "status",
	"valor": "value",
	"tecnico": "technician_name",
	"codigo": "codigo",
	"horas": "hours",
	"maquina": "machine_name",
	"descricao": "description",
	"categoria": "category",
	"atualizado": "updated_at",
	"vendedor": "seller_name",
	"sistema": "name",
	"item": "title",
	"serial": "serial_number",
	"uuid": "public_uuid",
	"anydesk": "anydesk_code",
	"conclusao": "completion_date",
	"tipo": "type",
	"planos": "plans_count",
	"perfil": "role",
	"equipe": "team",
	"visualizacoes": "views_count",
	"ultima_localizacao": "address",
	"senhas": "passwords_count",
	"origem": "origin",
	"solicitante": "solicitante",
	"criado": "created_at",
	"criado_em": "created_at",
	"ps": "ps_number",
	"origem": "source",
	"emissao": "issued_at",
	"arquivo": "path",
}


def col_filters() -> list[dict[str, str]]:
	raw = request.args.get("col_filters") or "[]"
	try:
		data = json.loads(raw)
	except Exception:
		return []
	out: list[dict[str, str]] = []
	if not isinstance(data, list):
		return out
	for item in data:
		if not isinstance(item, dict):
			continue
		field = str(item.get("field") or "").strip()
		op = str(item.get("op") or "contains").strip() or "contains"
		value = str(item.get("value") or "").strip()
		if field and value:
			out.append({"field": field, "op": op, "value": value})
	return out


def _item_get(item: dict, field: str) -> Any:
	if field in item:
		return item[field]
	want = _norm(field)
	for k, v in item.items():
		if _norm(str(k)) == want:
			return v
	alt = ALIASES.get(want)
	if alt and alt in item:
		return item[alt]
	for k, v in item.items():
		if alt and _norm(str(k)) == _norm(alt):
			return v
	return None


def parse_number(value: Any) -> float | None:
	if isinstance(value, bool) or value is None:
		return None
	if isinstance(value, (int, float)):
		number = float(value)
		if number != number or number in (float("inf"), float("-inf")):
			return None
		return number
	raw = str(value).strip().replace("R$", "").replace(" ", "")
	if not raw or raw in {"—", "-"}:
		return None
	if "," in raw and "." in raw:
		raw = raw.replace(".", "").replace(",", ".")
	elif "," in raw:
		raw = raw.replace(",", ".")
	try:
		number = float(raw)
	except ValueError:
		return None
	if number != number or number in (float("inf"), float("-inf")):
		return None
	return number


def parse_date(value: Any) -> date | None:
	if isinstance(value, datetime):
		return value.date()
	if isinstance(value, date):
		return value
	raw = str(value or "").strip()
	if not raw or raw in {"—", "-"}:
		return None
	head = raw[:10]
	for fmt, text in (("%Y-%m-%d", head), ("%d/%m/%Y", head)):
		try:
			return datetime.strptime(text, fmt).date()
		except ValueError:
			continue
	try:
		return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
	except ValueError:
		return None


def _match(hay: Any, op: str, needle: str) -> bool:
	if op in {"gt", "gte", "lt", "lte"}:
		left = parse_number(hay)
		right = parse_number(needle)
		if left is None or right is None:
			return False
		if op == "gt":
			return left > right
		if op == "gte":
			return left >= right
		if op == "lt":
			return left < right
		return left <= right
	if op in {"before", "after", "on", "between"}:
		left = parse_date(hay)
		if left is None:
			return False
		if op == "between":
			parts = (needle or "").split("|", 1)
			start = parse_date(parts[0]) if parts and parts[0].strip() else None
			end = parse_date(parts[1]) if len(parts) > 1 and parts[1].strip() else None
			if start is None and end is None:
				return True
			if start and left < start:
				return False
			if end and left > end:
				return False
			return True
		right = parse_date(needle)
		if right is None:
			return False
		if op == "on":
			return left == right
		if op == "before":
			return left <= right
		return left >= right
	h = "" if hay is None else str(hay)
	n = needle
	if op == "equals":
		left = parse_number(hay)
		right = parse_number(needle)
		if left is not None and right is not None:
			return left == right
		return h.strip().lower() == n.strip().lower()
	return n.lower() in h.lower()


def filter_dicts(items: Iterable[Any]) -> list:
	rows = list(items)
	filters = col_filters()
	if not filters:
		return rows
	out = []
	for item in rows:
		if not isinstance(item, dict):
			out.append(item)
			continue
		ok = True
		for f in filters:
			if not _match(_item_get(item, f["field"]), f["op"], f["value"]):
				ok = False
				break
		if ok:
			out.append(item)
	return out


def filter_query(query, columns: dict):
	"""Aplica col_filters em colunas SQLAlchemy {field: column}."""
	norm_cols = {_norm(k): v for k, v in (columns or {}).items()}
	for f in col_filters():
		key = _norm(f["field"])
		col = norm_cols.get(key)
		if col is None:
			alias = ALIASES.get(key)
			if alias:
				col = norm_cols.get(_norm(alias))
		if col is None:
			continue
		val = f["value"]
		op = f["op"]
		if op in {"gt", "gte", "lt", "lte"}:
			number = parse_number(val)
			if number is None:
				continue
			numeric = cast(col, Float)
			if op == "gt":
				query = query.filter(numeric > number)
			elif op == "gte":
				query = query.filter(numeric >= number)
			elif op == "lt":
				query = query.filter(numeric < number)
			else:
				query = query.filter(numeric <= number)
			continue
		if op in {"before", "after", "on", "between"}:
			day = func.date(col)
			if op == "between":
				parts = val.split("|", 1)
				start = parse_date(parts[0]) if parts and parts[0].strip() else None
				end = parse_date(parts[1]) if len(parts) > 1 and parts[1].strip() else None
				if start:
					query = query.filter(day >= start)
				if end:
					query = query.filter(day <= end)
				continue
			parsed = parse_date(val)
			if parsed is None:
				continue
			if op == "on":
				query = query.filter(day == parsed)
			elif op == "before":
				query = query.filter(day <= parsed)
			else:
				query = query.filter(day >= parsed)
			continue
		if op == "equals":
			query = query.filter(func.lower(cast(col, String)) == val.lower())
		else:
			query = query.filter(cast(col, String).ilike(f"%{val}%"))
	return query
