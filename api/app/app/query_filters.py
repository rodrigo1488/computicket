"""Filtros de coluna enviados pelo DataTable (col_filters JSON)."""
from __future__ import annotations

import json
import unicodedata
from typing import Any, Iterable

from flask import request
from sqlalchemy import String, cast, func


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


def _match(hay: Any, op: str, needle: str) -> bool:
	h = "" if hay is None else str(hay)
	n = needle
	if op == "equals":
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
		if f["op"] == "equals":
			query = query.filter(func.lower(cast(col, String)) == val.lower())
		else:
			query = query.filter(cast(col, String).ilike(f"%{val}%"))
	return query
