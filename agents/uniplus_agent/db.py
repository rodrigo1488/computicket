"""SQLite local do agente Uniplus (config + logs)."""
from __future__ import annotations

import os
import sys
import sqlite3
from datetime import datetime
from typing import Any


def _resolve_db_file() -> str:
	"""agent.db ao lado do .exe (frozen) ou na pasta do agente (dev)."""
	if getattr(sys, "frozen", False):
		base = os.path.dirname(os.path.abspath(sys.executable))
	else:
		base = os.path.dirname(os.path.abspath(__file__))
	return os.path.join(base, "agent.db")


DB_FILE = _resolve_db_file()

DEFAULT_CONFIG = {
	"ws_url": "http://127.0.0.1:5000",
	"device_id": "",
	"token": "",
	"pg_host": "127.0.0.1",
	"pg_port": "5432",
	"pg_db": "unico",
	"pg_user": "postgres",
	"pg_password": "postgres",
	"agent_enabled": "true",
}


def _conn():
	c = sqlite3.connect(DB_FILE, timeout=10.0)
	c.row_factory = sqlite3.Row
	c.execute("PRAGMA journal_mode=WAL")
	return c


def init_db():
	conn = _conn()
	try:
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS config (
				key TEXT PRIMARY KEY,
				value TEXT
			)
			"""
		)
		conn.execute(
			"""
			CREATE TABLE IF NOT EXISTS job_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				job_id INTEGER,
				job_type TEXT,
				status TEXT,
				message TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
			"""
		)
		for k, v in DEFAULT_CONFIG.items():
			cur = conn.execute("SELECT 1 FROM config WHERE key = ?", (k,))
			if not cur.fetchone():
				conn.execute("INSERT INTO config (key, value) VALUES (?, ?)", (k, v))
		conn.commit()
	finally:
		conn.close()


def get_config(key: str, default: str | None = None) -> str:
	conn = _conn()
	try:
		row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
		if row and row["value"] is not None:
			return row["value"]
		return DEFAULT_CONFIG.get(key, default or "")
	finally:
		conn.close()


def get_all_config() -> dict[str, str]:
	conn = _conn()
	try:
		rows = conn.execute("SELECT key, value FROM config").fetchall()
		cfg = dict(DEFAULT_CONFIG)
		for r in rows:
			cfg[r["key"]] = r["value"] if r["value"] is not None else ""
		return cfg
	finally:
		conn.close()


def set_config(key: str, value: str) -> None:
	conn = _conn()
	try:
		conn.execute(
			"INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			(key, value),
		)
		conn.commit()
	finally:
		conn.close()


def set_many(values: dict[str, str]) -> None:
	conn = _conn()
	try:
		for k, v in values.items():
			conn.execute(
				"INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				(k, str(v) if v is not None else ""),
			)
		conn.commit()
	finally:
		conn.close()


def add_log(job_id: int | None, job_type: str, status: str, message: str = "") -> None:
	conn = _conn()
	try:
		conn.execute(
			"INSERT INTO job_logs (job_id, job_type, status, message, created_at) VALUES (?, ?, ?, ?, ?)",
			(job_id, job_type, status, message, datetime.now().isoformat(sep=" ", timespec="seconds")),
		)
		conn.commit()
	finally:
		conn.close()


def recent_logs(limit: int = 100) -> list[dict[str, Any]]:
	conn = _conn()
	try:
		rows = conn.execute(
			"SELECT * FROM job_logs ORDER BY id DESC LIMIT ?",
			(limit,),
		).fetchall()
		return [dict(r) for r in rows]
	finally:
		conn.close()
