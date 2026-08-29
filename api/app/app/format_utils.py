"""Utilitários de formatação para exibição."""


def format_brl(value, *, prefix: bool = True) -> str:
	"""Formata valor numérico no padrão brasileiro (ex: R$ 1.234,56)."""
	try:
		num = float(value or 0)
	except (TypeError, ValueError):
		num = 0.0
	formatted = f"{num:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
	return f"R$ {formatted}" if prefix else formatted
