"""Criptografia de segredos persistidos em SystemConfig."""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app

PREFIX = "enc:v1:"


def _fernet() -> Fernet:
	material = (
		os.environ.get("AI_CONFIG_ENCRYPTION_KEY")
		or current_app.config.get("SECRET_KEY")
		or os.environ.get("SECRET_KEY")
		or ""
	)
	if not material:
		raise RuntimeError("SECRET_KEY ou AI_CONFIG_ENCRYPTION_KEY não configurada.")
	key = base64.urlsafe_b64encode(hashlib.sha256(str(material).encode("utf-8")).digest())
	return Fernet(key)


def encrypt_secret(value: str) -> str:
	value = (value or "").strip()
	if not value:
		return ""
	return PREFIX + _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str | None) -> str:
	raw = value or ""
	if not raw:
		return ""
	if not raw.startswith(PREFIX):
		# Compatibilidade para uma eventual configuração antiga em texto puro.
		return raw
	try:
		return _fernet().decrypt(raw[len(PREFIX):].encode("ascii")).decode("utf-8")
	except (InvalidToken, ValueError) as exc:
		raise RuntimeError("Não foi possível descriptografar a chave da IA.") from exc
