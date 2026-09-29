"""Contato de suporte fica fora do pipeline do Help Desk."""

SUPPORT_TICKET_STATUS = "support"


def is_support_ticket(status: str | None, is_support: bool | None = None) -> bool:
	if is_support is True or is_support == 1:
		return True
	if isinstance(is_support, str) and is_support.strip().lower() in {"1", "true", "yes"}:
		return True
	return str(status or "").strip().lower() == SUPPORT_TICKET_STATUS
