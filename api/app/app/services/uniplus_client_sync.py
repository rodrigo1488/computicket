"""Espelho local dos clientes (entidade) do Uniplus, gravado em lotes."""
from __future__ import annotations

import threading
import uuid
from typing import Any

from sqlalchemy import or_

from .. import db
from ..external_pg import ExternalPgError, _pg_connect
from ..models import SystemConfig, UniplusClient
from ..timezone_utils import get_brasilia_now

DEFAULT_BATCH_SIZE = 500
MIN_BATCH_SIZE = 50
MAX_BATCH_SIZE = 2000

CFG_STATUS = "uniplus_clients_sync_status"
CFG_SYNCED_AT = "uniplus_clients_synced_at"
CFG_ERROR = "uniplus_clients_sync_error"
CFG_LAST_COUNT = "uniplus_clients_sync_count"

_SQL_BATCH = """
SELECT id, nome, cnpjcpf, celular, email, endereco, numeroendereco,
       extra9, extra10, observacao, inativo
FROM entidade
WHERE id > %s
ORDER BY id ASC
LIMIT %s
"""

_sync_lock = threading.Lock()


def _naive(value):
	"""DateTime da coluna é comparado no SQL; grava sem fuso para o filtro de lote bater."""
	if value is not None and getattr(value, "tzinfo", None) is not None:
		return value.replace(tzinfo=None)
	return value


def _clip(value: Any, size: int) -> str:
	text = "" if value is None else str(value).strip()
	return text[:size]


def _flag(value: Any) -> bool:
	if value is None or value is False:
		return False
	if isinstance(value, str):
		return value.strip().lower() in {"1", "true", "t", "s", "sim", "y", "yes"}
	try:
		return int(value) != 0
	except (TypeError, ValueError):
		return bool(value)


def _cfg_set(key: str, value: str, description: str) -> None:
	SystemConfig.set(key, value, description=description, category="uniplus")


def mirror_ready() -> bool:
	"""Há pelo menos um cliente ativo no espelho."""
	return UniplusClient.query.filter_by(inactive=False).limit(1).first() is not None


def sync_status() -> dict[str, Any]:
	active = UniplusClient.query.filter_by(inactive=False).count()
	total = UniplusClient.query.count()
	raw_count = SystemConfig.get(CFG_LAST_COUNT) or "0"
	try:
		last_synced = int(raw_count)
	except (TypeError, ValueError):
		last_synced = 0
	return {
		"status": SystemConfig.get(CFG_STATUS) or "idle",
		"synced_at": SystemConfig.get(CFG_SYNCED_AT) or None,
		"error": SystemConfig.get(CFG_ERROR) or None,
		"last_synced": last_synced,
		"active": active,
		"count": total,
		"running": _sync_lock.locked(),
	}


def fetch_entidade_batch(after_id: int, limit: int) -> list[dict[str, Any]]:
	"""Lê um lote de `entidade` no Postgres Unico, em ordem de id."""
	conn = _pg_connect(connect_timeout=15)
	try:
		with conn.cursor() as cur:
			cur.execute(_SQL_BATCH, (int(after_id), int(limit)))
			cols = [desc[0] for desc in cur.description]
			return [dict(zip(cols, row)) for row in cur.fetchall()]
	except ExternalPgError:
		raise
	except Exception as e:
		raise ExternalPgError(f"Erro ao ler entidades do Unico: {e}") from e
	finally:
		conn.close()


def _apply_source(row: UniplusClient, source: dict[str, Any], token: str, now) -> None:
	uniplus_id = int(source["id"])
	row.name = _clip(source.get("nome"), 200) or f"Cliente {uniplus_id}"
	row.document = _clip(source.get("cnpjcpf"), 40) or None
	row.phone = _clip(source.get("celular"), 40) or None
	row.email = _clip(source.get("email"), 200) or None
	row.address = _clip(source.get("endereco"), 255) or None
	row.address_number = _clip(source.get("numeroendereco"), 30) or None
	row.contract_type = _clip(source.get("extra9"), 120) or None
	row.no_charge = _flag(source.get("extra10"))
	notes = source.get("observacao")
	row.notes = None if notes is None or str(notes).strip() == "" else str(notes)
	row.inactive = _flag(source.get("inativo"))
	row.sync_token = token
	row.synced_at = now


def _upsert_batch(rows: list[dict[str, Any]], token: str, now) -> int:
	ids = []
	for source in rows:
		try:
			ids.append(int(source["id"]))
		except (TypeError, ValueError, KeyError):
			continue
	if not ids:
		return 0
	existing = {
		item.idclienteuniplus: item
		for item in UniplusClient.query.filter(UniplusClient.idclienteuniplus.in_(ids)).all()
	}
	written = 0
	for source in rows:
		try:
			uniplus_id = int(source["id"])
		except (TypeError, ValueError, KeyError):
			continue
		row = existing.get(uniplus_id)
		if row is None:
			row = UniplusClient(idclienteuniplus=uniplus_id)
			db.session.add(row)
			existing[uniplus_id] = row
		_apply_source(row, source, token, now)
		written += 1
	db.session.commit()
	return written


def upsert_public_client(client: dict[str, Any]) -> None:
	"""Grava um cliente já conhecido (cadastro/edição) sem esperar o lote."""
	try:
		uniplus_id = int(client.get("idclienteuniplus") or client.get("id") or 0)
	except (TypeError, ValueError):
		return
	if uniplus_id <= 0:
		return
	row = UniplusClient.query.filter_by(idclienteuniplus=uniplus_id).first()
	if row is None:
		row = UniplusClient(idclienteuniplus=uniplus_id, sync_token="manual")
		db.session.add(row)
	elif not row.sync_token:
		row.sync_token = "manual"
	row.name = _clip(client.get("name"), 200) or f"Cliente {uniplus_id}"
	row.document = _clip(client.get("document"), 40) or None
	row.phone = _clip(client.get("phone"), 40) or None
	row.email = _clip(client.get("email"), 200) or None
	row.address = _clip(client.get("address"), 255) or None
	row.address_number = _clip(client.get("address_number"), 30) or None
	contract = client.get("contract_type")
	row.contract_type = _clip(contract, 120) or None
	row.no_charge = _flag(client.get("no_charge"))
	notes = client.get("notes")
	row.notes = None if notes is None or str(notes).strip() == "" else str(notes)
	row.inactive = False
	row.synced_at = _naive(get_brasilia_now())
	db.session.commit()


def list_mirrored_clients(q: str = "") -> list[dict[str, Any]]:
	query = UniplusClient.query.filter_by(inactive=False)
	text = (q or "").strip()
	if text:
		pattern = f"%{text}%"
		query = query.filter(
			or_(
				UniplusClient.name.ilike(pattern),
				UniplusClient.document.ilike(pattern),
				UniplusClient.phone.ilike(pattern),
				UniplusClient.email.ilike(pattern),
				UniplusClient.address.ilike(pattern),
				UniplusClient.address_number.ilike(pattern),
				UniplusClient.contract_type.ilike(pattern),
			)
		)
	rows = query.order_by(UniplusClient.name.asc(), UniplusClient.idclienteuniplus.asc()).all()
	return [row.to_public_dict() for row in rows]


def get_mirrored_client(client_id: int) -> dict[str, Any] | None:
	row = UniplusClient.query.filter_by(idclienteuniplus=int(client_id), inactive=False).first()
	return row.to_public_dict() if row else None


def load_clients(q: str = "") -> tuple[list[dict[str, Any]], str]:
	"""Lista pelo espelho quando ele já tem clientes ativos. Senão, lê o Unico ao vivo."""
	if mirror_ready():
		return list_mirrored_clients(q), "mirror"
	from ..external_pg import fetch_external_clients, fetch_external_clients_search

	text = (q or "").strip()
	if text:
		return fetch_external_clients_search(text), "uniplus"
	return fetch_external_clients(), "uniplus"


def load_client(client_id: int) -> dict[str, Any] | None:
	if mirror_ready():
		found = get_mirrored_client(client_id)
		if found:
			return found
	from ..external_pg import get_external_client_by_id

	found = get_external_client_by_id(int(client_id))
	if found:
		try:
			upsert_public_client(found)
		except Exception:
			db.session.rollback()
	return found


def _clamp_batch_size(batch_size: int | None) -> int:
	try:
		size = int(batch_size or DEFAULT_BATCH_SIZE)
	except (TypeError, ValueError):
		size = DEFAULT_BATCH_SIZE
	return max(MIN_BATCH_SIZE, min(MAX_BATCH_SIZE, size))


def sync_uniplus_clients(batch_size: int | None = None) -> dict[str, Any]:
	"""Copia `entidade` em lotes para `uniplus_client`. Idempotente por `idclienteuniplus`."""
	if not _sync_lock.acquire(blocking=False):
		return {"status": "running", "synced": 0, "batches": 0, "inactive_marked": 0}
	token = uuid.uuid4().hex
	started = _naive(get_brasilia_now())
	size = _clamp_batch_size(batch_size)
	synced = 0
	batches = 0
	try:
		_cfg_set(CFG_STATUS, "running", "Situação da sincronização de clientes Uniplus")
		_cfg_set(CFG_ERROR, "", "Último erro da sincronização de clientes Uniplus")
		after_id = 0
		while True:
			rows = fetch_entidade_batch(after_id, size)
			if not rows:
				break
			synced += _upsert_batch(rows, token, started)
			batches += 1
			after_id = max(int(row["id"]) for row in rows)
		inactive_marked = (
			UniplusClient.query.filter(
				UniplusClient.sync_token != token,
				UniplusClient.synced_at < started,
			).update(
				{"inactive": True, "sync_token": token, "synced_at": started},
				synchronize_session=False,
			)
			or 0
		)
		db.session.commit()
		finished = get_brasilia_now()
		_cfg_set(CFG_STATUS, "ok", "Situação da sincronização de clientes Uniplus")
		_cfg_set(CFG_SYNCED_AT, finished.isoformat(timespec="seconds"), "Última sincronização de clientes Uniplus")
		_cfg_set(CFG_LAST_COUNT, str(synced), "Clientes lidos na última sincronização Uniplus")
		_cfg_set(CFG_ERROR, "", "Último erro da sincronização de clientes Uniplus")
		return {
			"status": "ok",
			"synced": synced,
			"batches": batches,
			"inactive_marked": int(inactive_marked),
			"synced_at": finished.isoformat(timespec="seconds"),
			"active": UniplusClient.query.filter_by(inactive=False).count(),
		}
	except Exception as exc:
		db.session.rollback()
		message = str(exc)
		try:
			_cfg_set(CFG_STATUS, "error", "Situação da sincronização de clientes Uniplus")
			_cfg_set(CFG_ERROR, message[:500], "Último erro da sincronização de clientes Uniplus")
		except Exception:
			db.session.rollback()
		if isinstance(exc, ExternalPgError):
			raise
		raise ExternalPgError(message) from exc
	finally:
		_sync_lock.release()
