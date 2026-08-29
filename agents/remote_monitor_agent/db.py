"""Persistência local thread-safe: configuração, logs e fila de telemetria."""
from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Any

from security import protect_secret, unprotect_secret

_LOCK = threading.RLock()
MAX_BUFFER_ROWS = 5760
BUFFER_RETENTION_SECONDS = 7 * 24 * 3600
MAX_LOG_ROWS = 2000


def _base_dir() -> str:
    return os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))


DB_FILE = os.path.join(_base_dir(), "agent.db")


@contextmanager
def _connect():
    conn = sqlite3.connect(DB_FILE, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=15000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with _LOCK, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS telemetry_buffer (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """
        )
        defaults = {
            "server_url": "",
            "device_id": str(uuid.uuid4()),
            "token_ciphertext": "",
            "enabled": "true",
            "ui_secret": secrets.token_urlsafe(48),
        }
        for key, value in defaults.items():
            conn.execute("INSERT OR IGNORE INTO config(key,value) VALUES (?,?)", (key, value))


def get_config(key: str, default: str = "") -> str:
    with _LOCK, _connect() as conn:
        row = conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else default


def get_public_config() -> dict[str, str]:
    return {
        "server_url": get_config("server_url"),
        "device_id": get_config("device_id"),
        "enabled": get_config("enabled", "true"),
        "has_token": "true" if get_config("token_ciphertext") else "false",
    }


def set_many(values: dict[str, str]) -> None:
    allowed = {"server_url", "device_id", "enabled", "ui_secret"}
    with _LOCK, _connect() as conn:
        for key, value in values.items():
            if key not in allowed:
                raise ValueError(f"Configuração não permitida: {key}")
            conn.execute(
                "INSERT INTO config(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value)),
            )


def set_token(token: str) -> None:
    ciphertext = protect_secret(token)
    with _LOCK, _connect() as conn:
        conn.execute(
            "INSERT INTO config(key,value) VALUES ('token_ciphertext',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (ciphertext,),
        )


def get_token() -> str:
    value = get_config("token_ciphertext")
    return unprotect_secret(value) if value else ""


def enqueue(payload: dict[str, Any]) -> int:
    now = time.time()
    with _LOCK, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO telemetry_buffer(payload,created_at) VALUES (?,?)",
            (json.dumps(payload, separators=(",", ":"), ensure_ascii=False), now),
        )
        _prune_buffer(conn, now)
        return int(cur.lastrowid)


def _prune_buffer(conn: sqlite3.Connection, now: float) -> None:
    conn.execute("DELETE FROM telemetry_buffer WHERE created_at < ?", (now - BUFFER_RETENTION_SECONDS,))
    conn.execute(
        "DELETE FROM telemetry_buffer WHERE id NOT IN "
        "(SELECT id FROM telemetry_buffer ORDER BY id DESC LIMIT ?)",
        (MAX_BUFFER_ROWS,),
    )


def pending(limit: int = 100) -> list[dict[str, Any]]:
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            "SELECT id,payload,created_at FROM telemetry_buffer ORDER BY id LIMIT ?", (max(1, min(limit, 500)),)
        ).fetchall()
    return [{"id": r["id"], "payload": json.loads(r["payload"]), "created_at": r["created_at"]} for r in rows]


def acknowledge(row_id: int) -> None:
    with _LOCK, _connect() as conn:
        conn.execute("DELETE FROM telemetry_buffer WHERE id=?", (int(row_id),))


def buffer_count() -> int:
    with _LOCK, _connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM telemetry_buffer").fetchone()[0])


def add_log(level: str, message: str) -> None:
    clean = re.sub(
        r"(?i)\b(token|authorization|activation_code)\b\s*[:=]\s*[^\s,;]+",
        r"\1=***",
        str(message),
    )
    with _LOCK, _connect() as conn:
        conn.execute("INSERT INTO logs(level,message,created_at) VALUES (?,?,?)", (level.upper(), clean, time.time()))
        conn.execute(
            "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)", (MAX_LOG_ROWS,)
        )


def recent_logs(limit: int = 200) -> list[dict[str, Any]]:
    with _LOCK, _connect() as conn:
        return [
            dict(row)
            for row in conn.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (min(limit, 500),)).fetchall()
        ]
