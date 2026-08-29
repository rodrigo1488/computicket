"""
Presença e awareness em tempo real (Co-op) no builder de orçamentos.

Duas fontes (mescladas):
1) HTTP heartbeat — funciona sem WebSocket (popup / badges / cursor por poll)
2) Socket.IO — atualização instantânea quando o socket estiver ok

Estado em memória do processo Flask.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict, List, Optional

from flask import request
from flask_login import current_user
from flask_socketio import emit, join_room, leave_room

from .. import socketio
from ..timezone_utils import get_brasilia_now

# Socket: budget_id -> { sid: editor_info }
_budget_editors: Dict[int, Dict[str, Dict[str, Any]]] = {}

# HTTP: budget_id -> { user_id: {user_name, last_seen, tab_id, awareness} }
_http_presence: Dict[int, Dict[int, Dict[str, Any]]] = {}

LIST_ROOM = 'budget_list'
HTTP_PRESENCE_TTL_SECONDS = 40


def _editor_public(info: Dict[str, Any]) -> Dict[str, Any]:
	payload = {
		'id': info.get('user_id'),
		'name': info.get('user_name') or 'Usuário',
	}
	awareness = info.get('awareness') or {}
	if awareness:
		payload['awareness'] = {
			'field': awareness.get('field'),
			'block_id': awareness.get('block_id'),
			'caret': awareness.get('caret'),
			'typing': bool(awareness.get('typing')),
			'label': awareness.get('label') or '',
		}
	return payload


def _purge_http_presence(budget_id: Optional[int] = None) -> None:
	now = get_brasilia_now()
	cutoff = now - timedelta(seconds=HTTP_PRESENCE_TTL_SECONDS)
	targets = [int(budget_id)] if budget_id is not None else list(_http_presence.keys())
	for bid in targets:
		room = _http_presence.get(bid)
		if not room:
			continue
		for uid, info in list(room.items()):
			last_seen = info.get('last_seen')
			if not last_seen or last_seen < cutoff:
				del room[uid]
		if not room:
			_http_presence.pop(bid, None)


def _normalize_awareness(raw: Any) -> Dict[str, Any]:
	if not isinstance(raw, dict):
		return {}
	field = (raw.get('field') or '').strip() or None
	if not field:
		return {}
	caret = raw.get('caret')
	try:
		caret = int(caret) if caret is not None else None
	except (TypeError, ValueError):
		caret = None
	if caret is not None and caret < 0:
		caret = 0
	return {
		'field': field,
		'block_id': ((raw.get('block_id') or '').strip() or None),
		'caret': caret,
		'typing': bool(raw.get('typing')),
		'label': ((raw.get('label') or '').strip()[:80]),
	}


def http_touch_presence(
	budget_id: int,
	user_id: int,
	user_name: str,
	*,
	tab_id: Optional[str] = None,
	awareness: Any = None,
	clear_awareness: bool = False,
) -> List[Dict[str, Any]]:
	"""Registra/atualiza presença HTTP e retorna editores ativos."""
	budget_id = int(budget_id)
	user_id = int(user_id)
	room = _http_presence.setdefault(budget_id, {})
	prev = room.get(user_id) or {}
	entry = {
		'user_id': user_id,
		'user_name': user_name or f'Usuário {user_id}',
		'last_seen': get_brasilia_now(),
		'tab_id': (tab_id or prev.get('tab_id') or ''),
		'awareness': {},
	}
	if clear_awareness:
		entry['awareness'] = {}
	elif awareness is not None:
		entry['awareness'] = _normalize_awareness(awareness)
	else:
		entry['awareness'] = prev.get('awareness') or {}
	room[user_id] = entry
	_purge_http_presence(budget_id)
	return get_budget_editors(budget_id)


def http_leave_presence(budget_id: int, user_id: int) -> List[Dict[str, Any]]:
	budget_id = int(budget_id)
	user_id = int(user_id)
	room = _http_presence.get(budget_id)
	if room and user_id in room:
		del room[user_id]
		if not room:
			_http_presence.pop(budget_id, None)
	_purge_http_presence(budget_id)
	return get_budget_editors(budget_id)


def _socket_editors_for_budget(budget_id: int) -> Dict[int, Dict[str, Any]]:
	room = _budget_editors.get(int(budget_id)) or {}
	by_user: Dict[int, Dict[str, Any]] = {}
	for info in room.values():
		uid = info.get('user_id')
		if uid is None:
			continue
		by_user[int(uid)] = _editor_public(info)
	return by_user


def _http_editors_for_budget(budget_id: int) -> Dict[int, Dict[str, Any]]:
	_purge_http_presence(budget_id)
	room = _http_presence.get(int(budget_id)) or {}
	by_user: Dict[int, Dict[str, Any]] = {}
	for uid, info in room.items():
		by_user[int(uid)] = _editor_public(info)
	return by_user


def get_budget_editors(budget_id: int) -> List[Dict[str, Any]]:
	"""Editores ativos (HTTP + Socket), um registro por user_id."""
	merged = _socket_editors_for_budget(budget_id)
	# HTTP sobrescreve/complementa (tem awareness atualizado por poll)
	merged.update(_http_editors_for_budget(budget_id))
	return list(merged.values())


def get_presence_snapshot() -> Dict[str, List[Dict[str, Any]]]:
	"""Snapshot {budget_id_str: [editors]} para a lista."""
	_purge_http_presence()
	ids = set(_budget_editors.keys()) | set(_http_presence.keys())
	return {
		str(budget_id): get_budget_editors(budget_id)
		for budget_id in ids
		if get_budget_editors(budget_id)
	}


def _broadcast_list_update(budget_id: int) -> None:
	socketio.emit(
		'budget_presence_update',
		{
			'budget_id': int(budget_id),
			'editors': get_budget_editors(budget_id),
		},
		room=LIST_ROOM,
		namespace='/',
	)


def _emit_editors_changed(budget_id: int) -> None:
	socketio.emit(
		'budget_editors_changed',
		{
			'budget_id': int(budget_id),
			'editors': get_budget_editors(budget_id),
		},
		room=f'budget_edit_{int(budget_id)}',
		namespace='/',
	)


def _awareness_payload(budget_id: int, info: Dict[str, Any], *, cleared: bool = False) -> Dict[str, Any]:
	awareness = {} if cleared else (info.get('awareness') or {})
	return {
		'budget_id': int(budget_id),
		'user_id': info.get('user_id'),
		'user_name': info.get('user_name') or 'Usuário',
		'cleared': cleared,
		'field': awareness.get('field'),
		'block_id': awareness.get('block_id'),
		'caret': awareness.get('caret'),
		'typing': bool(awareness.get('typing')) if not cleared else False,
		'label': awareness.get('label') or '',
	}


def _emit_awareness(
	budget_id: int,
	info: Dict[str, Any],
	*,
	cleared: bool = False,
	include_self: bool = True,
) -> None:
	payload = _awareness_payload(budget_id, info, cleared=cleared)
	room = f'budget_edit_{int(budget_id)}'
	if not include_self:
		emit('budget_awareness', payload, room=room, include_self=False)
		return
	socketio.emit('budget_awareness', payload, room=room, namespace='/')


def _remove_sid_from_budget(budget_id: int, sid: str, *, notify: bool = True) -> bool:
	room = _budget_editors.get(int(budget_id))
	if not room or sid not in room:
		return False
	info = room.get(sid) or {}
	del room[sid]
	if not room:
		_budget_editors.pop(int(budget_id), None)
	if notify:
		if info.get('user_id') is not None:
			_emit_awareness(budget_id, info, cleared=True)
		_broadcast_list_update(budget_id)
		_emit_editors_changed(budget_id)
	return True


def cleanup_presence_for_sid(sid: Optional[str] = None) -> None:
	"""Remove o sid de todos os orçamentos (disconnect / leave)."""
	if not sid:
		return
	affected = []
	cleared_infos = []
	for budget_id, room in list(_budget_editors.items()):
		if sid in room:
			info = room.get(sid) or {}
			del room[sid]
			affected.append(budget_id)
			cleared_infos.append((budget_id, info))
			if not room:
				_budget_editors.pop(budget_id, None)
	for budget_id, info in cleared_infos:
		if info.get('user_id') is not None:
			_emit_awareness(budget_id, info, cleared=True)
	for budget_id in affected:
		_broadcast_list_update(budget_id)
		_emit_editors_changed(budget_id)


@socketio.on('budget_subscribe_list')
def on_budget_subscribe_list(_data=None):
	if not current_user.is_authenticated:
		emit('error', {'message': 'Usuário não autenticado'})
		return
	join_room(LIST_ROOM)
	emit('budget_presence_snapshot', {'presence': get_presence_snapshot()})


@socketio.on('budget_unsubscribe_list')
def on_budget_unsubscribe_list(_data=None):
	leave_room(LIST_ROOM)


@socketio.on('budget_join_edit')
def on_budget_join_edit(data):
	if not current_user.is_authenticated:
		emit('error', {'message': 'Usuário não autenticado'})
		return

	budget_id = (data or {}).get('budget_id')
	try:
		budget_id = int(budget_id)
	except (TypeError, ValueError):
		emit('error', {'message': 'budget_id inválido'})
		return

	if budget_id <= 0:
		emit('error', {'message': 'budget_id inválido'})
		return

	sid = request.sid
	for other_id, room in list(_budget_editors.items()):
		if other_id != budget_id and sid in room:
			_remove_sid_from_budget(other_id, sid, notify=True)

	room_name = f'budget_edit_{budget_id}'
	join_room(room_name)

	editors = _budget_editors.setdefault(budget_id, {})
	editors[sid] = {
		'user_id': current_user.id,
		'user_name': current_user.name or f'Usuário {current_user.id}',
		'joined_at': get_brasilia_now().isoformat(),
		'awareness': {},
	}

	# Também registra via HTTP para o GET /editores funcionar mesmo se o socket cair depois
	http_touch_presence(
		budget_id,
		current_user.id,
		current_user.name or f'Usuário {current_user.id}',
	)

	others_awareness = []
	for editor in get_budget_editors(budget_id):
		if int(editor.get('id') or 0) == int(current_user.id):
			continue
		aw = editor.get('awareness') or {}
		if aw.get('field'):
			others_awareness.append({
				'budget_id': budget_id,
				'user_id': editor.get('id'),
				'user_name': editor.get('name'),
				'cleared': False,
				'field': aw.get('field'),
				'block_id': aw.get('block_id'),
				'caret': aw.get('caret'),
				'typing': bool(aw.get('typing')),
				'label': aw.get('label') or '',
			})

	emit('budget_joined_edit', {
		'budget_id': budget_id,
		'editors': get_budget_editors(budget_id),
		'awareness': others_awareness,
	})
	_broadcast_list_update(budget_id)
	_emit_editors_changed(budget_id)


@socketio.on('budget_leave_edit')
def on_budget_leave_edit(data):
	budget_id = (data or {}).get('budget_id')
	try:
		budget_id = int(budget_id)
	except (TypeError, ValueError):
		budget_id = None

	sid = request.sid
	if budget_id:
		leave_room(f'budget_edit_{budget_id}')
		_remove_sid_from_budget(budget_id, sid, notify=True)
		if current_user.is_authenticated:
			http_leave_presence(budget_id, current_user.id)
	else:
		cleanup_presence_for_sid(sid)


@socketio.on('budget_awareness')
def on_budget_awareness(data):
	"""Recebe foco/digitação/cursor e retransmite para a sala do orçamento."""
	if not current_user.is_authenticated:
		return

	data = data or {}
	try:
		budget_id = int(data.get('budget_id'))
	except (TypeError, ValueError):
		return

	sid = request.sid
	room = _budget_editors.get(budget_id)
	info = None
	if room and sid in room:
		info = room[sid]

	cleared = bool(data.get('cleared'))
	if cleared:
		if info is not None:
			info['awareness'] = {}
			_emit_awareness(budget_id, info, cleared=True, include_self=False)
		http_touch_presence(
			budget_id,
			current_user.id,
			current_user.name or f'Usuário {current_user.id}',
			clear_awareness=True,
		)
		return

	awareness = _normalize_awareness(data)
	if info is not None:
		info['awareness'] = dict(awareness)
		info['awareness']['updated_at'] = get_brasilia_now().isoformat()
		_emit_awareness(budget_id, info, cleared=False, include_self=False)

	http_touch_presence(
		budget_id,
		current_user.id,
		current_user.name or f'Usuário {current_user.id}',
		awareness=awareness,
	)
