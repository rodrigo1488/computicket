"""Eventos WebSocket compartilhados (orçamentos / monitoramento).

A inbox WhatsApp usa o Socket.IO do engine Baileys, não estes eventos.
"""
from flask import request
from flask_socketio import emit, join_room
from flask_login import current_user
from .. import socketio


@socketio.on("connect")
def on_connect():
    emit("connected", {"message": "Conectado ao servidor"})
    if current_user.is_authenticated:
        join_room(f"agent_{current_user.id}")


@socketio.on("disconnect")
def on_disconnect():
    try:
        from .budget_socketio import cleanup_presence_for_sid
        cleanup_presence_for_sid(request.sid)
    except Exception as exc:
        print(f"Falha ao limpar presença de orçamento: {exc}")
