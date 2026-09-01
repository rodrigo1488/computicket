"""Envio de texto via API Compuchat (WhatsApp)."""
from __future__ import annotations

import json
import re

import requests

COMPUCHAT_SEND_URL = "https://api.compuchat.cloud/api/messages/send"
COMPUCHAT_TOKEN = "Bearer c3lzdGVtY2FsbGdlbmVyYXRlYnVyc3RlbGVtZW50"


def normalize_whatsapp_number(raw) -> str | None:
	digits = re.sub(r"\D", "", str(raw or ""))
	if len(digits) < 10:
		return None
	if digits.startswith("55") and len(digits) >= 12:
		return digits
	if len(digits) in (10, 11):
		return "55" + digits
	return digits


def send_whatsapp_text(number, body: str) -> str:
	clean = normalize_whatsapp_number(number)
	if not clean:
		return "Número de WhatsApp inválido ou incompleto."
	text = (body or "").strip()
	if not text:
		return "Mensagem vazia."
	try:
		response = requests.post(
			COMPUCHAT_SEND_URL,
			data=json.dumps({"number": clean, "body": text}),
			headers={
				"Content-Type": "application/json",
				"Authorization": COMPUCHAT_TOKEN,
			},
			timeout=10,
		)
		if response.status_code in (200, 201):
			return "WhatsApp enviado com sucesso."
		return f"Erro ao enviar WhatsApp: {response.text}"
	except Exception as e:
		return f"Erro na conexão com API WhatsApp: {e}"
