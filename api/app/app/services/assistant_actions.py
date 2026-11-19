"""Ações do assistente do dashboard: agenda, conhecimento e aviso no grupo dos agentes."""

from __future__ import annotations

import contextvars
import os
import re
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

from flask import current_app
from flask_login import current_user
from werkzeug.utils import secure_filename

from ..blueprints.agenda import (
	_resolve_agenda_technician,
	_resolve_staff_client,
	enviar_email_confirmacao,
	notify_appointment_whatsapp,
)
from ..models import Appointment, KnowledgeArticle, KnowledgeAttachment, KnowledgeCategory, db
from .rag import index_source, sanitize_for_rag

_SUPPORT_CATEGORY = "Suporte"
_BRASILIA = timezone(timedelta(hours=-3))
_IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
_chat_image: contextvars.ContextVar[tuple[bytes, str] | None] = contextvars.ContextVar(
	"assistant_chat_image", default=None
)
_chat_pdf: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
	"assistant_chat_pdf", default=None
)
_saved_article: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
	"assistant_saved_article", default=None
)
_sent_group_keys: contextvars.ContextVar[set[str] | None] = contextvars.ContextVar(
	"assistant_sent_group_keys", default=None
)
_GROUP_STOPWORDS = {
	"grupo",
	"grupos",
	"whatsapp",
	"zap",
	"do",
	"da",
	"de",
	"dos",
	"das",
	"no",
	"na",
	"nos",
	"nas",
	"o",
	"a",
	"os",
	"as",
	"um",
	"uma",
	"para",
	"pro",
	"pra",
}
_SEND_ALL = {"todos", "todos os grupos", "em todos", "em todos os grupos", "all"}
_MESSAGE_LIMIT = 6000
_SECRET_LINE = re.compile(
	r"(?i)\b(api[_-]?key|token|secret|senha|password|passwd|authorization)\b\s*[:=]\s*\S+"
)
_BEARER_LINE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")


def remember_chat_image(image: tuple[bytes, str] | None) -> None:
	"""Print da mensagem atual. A gravação do conhecimento anexa este arquivo."""
	_chat_image.set(image)


def remember_chat_pdf(pdf_data: dict | None) -> None:
	"""PDF transcrito na mensagem atual para criação de artigo."""
	_chat_pdf.set(pdf_data)


def begin_saved_article() -> None:
	_saved_article.set(None)


def begin_group_send() -> None:
	"""Zera o controle de envio desta conversa, para não disparar a mesma mensagem duas vezes."""
	_sent_group_keys.set(set())


def last_saved_article() -> dict | None:
	return _saved_article.get()


def _user_id(explicit: int | None) -> int | None:
	if explicit:
		return int(explicit)
	user_id = getattr(current_user, "id", None)
	return int(user_id) if user_id else None


def create_appointment(args: dict, user_id: int | None = None) -> dict:
	"""Cria uma visita. Sem cliente, data ou horário, devolve o que falta e não grava."""
	actor_id = _user_id(user_id)
	if not actor_id:
		return {"ok": False, "message": "É preciso estar logado para agendar."}
	title = str(args.get("title") or "").strip()
	raw_date = str(args.get("appointment_date") or args.get("data") or "").strip()
	has_clock = "T" in raw_date or " " in raw_date
	cliente = str(args.get("cliente") or args.get("client_name") or "").strip()
	tecnico = str(args.get("tecnico") or "").strip()
	description = str(args.get("description") or "").strip()
	if len(title) < 3:
		return {"ok": False, "message": "Falta o título da visita. Pergunte antes de agendar."}
	if len(raw_date) <= 10 or not has_clock:
		return {"ok": False, "message": "Falta a data com horário. Pergunte antes de agendar."}
	link, client_error = _resolve_staff_client({"cliente": cliente})
	if not link:
		return {"ok": False, "message": client_error or "Não encontrei o cliente."}
	technician = _resolve_agenda_technician(None, tecnico) if tecnico else _resolve_agenda_technician(actor_id, None)
	if not technician:
		return {"ok": False, "message": "Não encontrei esse técnico. Informe o nome de um técnico ativo."}
	try:
		appointment_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00").replace(" ", "T"))
	except ValueError:
		return {"ok": False, "message": "Data inválida. Use ano, mês, dia e horário."}
	if appointment_date.tzinfo is not None:
		appointment_date = appointment_date.astimezone(_BRASILIA).replace(tzinfo=None)
	appointment = Appointment(
		title=title[:200],
		description=description[:2000],
		appointment_date=appointment_date,
		client_id=link.external_client_id,
		user_id=technician.id,
		created_by=actor_id,
	)
	db.session.add(appointment)
	db.session.commit()
	when = appointment.get_formatted_date()
	try:
		from ..notification_service import create_notifications

		create_notifications(
			[appointment.user_id],
			notification_type="appointment",
			title="Novo agendamento",
			message=f"{appointment.title} · {when}",
			url="/agenda",
			entity_type="appointment",
			entity_id=appointment.id,
		)
	except Exception:
		db.session.rollback()
	try:
		enviar_email_confirmacao(appointment)
	except Exception:
		pass
	try:
		notify_appointment_whatsapp(appointment)
	except Exception:
		pass
	return {
		"ok": True,
		"appointment_id": appointment.id,
		"message": (
			f"Agendamento confirmado: {appointment.title} em {when} "
			f"com {technician.name}, cliente {link.external_client_name}."
		),
	}


def _resolve_category(user_id: int, category_name: str | None = None) -> KnowledgeCategory:
	target_name = (category_name or "").strip() or _SUPPORT_CATEGORY
	category = KnowledgeCategory.query.filter(
		db.func.lower(KnowledgeCategory.name) == target_name.lower()
	).first()
	if category:
		return category
	if target_name.lower() != _SUPPORT_CATEGORY.lower():
		# Fallback para categoria Suporte caso a solicitada não exista
		fallback = KnowledgeCategory.query.filter(
			db.func.lower(KnowledgeCategory.name) == _SUPPORT_CATEGORY.lower()
		).first()
		if fallback:
			return fallback
	category = KnowledgeCategory(
		name=_SUPPORT_CATEGORY,
		description="Problemas e soluções registrados pelo assistente.",
		created_by_id=user_id,
	)
	db.session.add(category)
	db.session.flush()
	return category


def _support_category(user_id: int) -> KnowledgeCategory:
	return _resolve_category(user_id, _SUPPORT_CATEGORY)


def create_article_from_pdf(args: dict, user_id: int | None = None) -> dict:
	"""Cria um artigo na base de conhecimento a partir do PDF transcrito enviado no chat."""
	actor_id = _user_id(user_id)
	if not actor_id:
		return {"ok": False, "message": "É preciso estar logado para criar um artigo."}
	pdf_data = _chat_pdf.get()
	if not pdf_data or not (pdf_data.get("markdown") or "").strip():
		return {
			"ok": False,
			"message": "Nenhum arquivo PDF foi enviado nesta mensagem para criar o artigo.",
		}

	raw_filename = str(pdf_data.get("filename") or "artigo.pdf").strip()
	file_stem = Path(raw_filename).stem.strip() or "Artigo importado de PDF"
	title = file_stem[:200]
	markdown = str(pdf_data["markdown"]).strip()
	summary = str(pdf_data.get("suggested_summary") or "").strip()[:100]
	tags = str(args.get("tags") or "").strip() or "pdf, documentacao"
	category_name = str(args.get("category_name") or "").strip() or None

	category = _resolve_category(actor_id, category_name)
	category_id = int(category.id)
	article = KnowledgeArticle(
		title=title,
		content=markdown,
		summary=summary or None,
		tags=tags[:500],
		category_id=category_id,
		status="published",
		created_by_id=actor_id,
	)
	db.session.add(article)
	db.session.commit()
	article_id = int(article.id)

	attached = False
	raw_bytes = pdf_data.get("raw_bytes")
	if isinstance(raw_bytes, (bytes, bytearray)) and raw_bytes:
		try:
			folder = os.path.join(current_app.instance_path, "knowledge_uploads")
			os.makedirs(folder, exist_ok=True)
			safe_name = secure_filename(raw_filename) or "documento.pdf"
			unique = f"{uuid.uuid4()}_{safe_name}"
			dest = os.path.join(folder, unique)
			with open(dest, "wb") as handle:
				handle.write(raw_bytes)
			db.session.add(
				KnowledgeAttachment(
					article_id=article_id,
					filename=unique,
					original_filename=safe_name,
					file_path=unique,
					file_size=len(raw_bytes),
					file_type="application/pdf",
					description="PDF original enviado no assistente",
					created_by_id=actor_id,
				)
			)
			db.session.commit()
			attached = True
		except Exception:
			db.session.rollback()

	try:
		index_source("knowledge_article", article_id)
	except Exception:
		db.session.rollback()

	_saved_article.set(
		{"article_id": article_id, "title": title, "category_id": category_id}
	)
	return {
		"ok": True,
		"article_id": article_id,
		"title": title,
		"category_id": category_id,
		"category": category.name,
		"images_count": int(pdf_data.get("images_count") or 0),
		"pages_count": int(pdf_data.get("pages_count") or 1),
		"attachment": attached,
		"message": (
			f"Artigo '{title}' criado com sucesso na categoria {category.name} "
			f"({pdf_data.get('pages_count') or 1} página(s) e {pdf_data.get('images_count') or 0} imagem(ns) transcritas)."
		),
	}


def save_support_solution(args: dict, user_id: int | None = None) -> dict:
	"""Grava problema e solução no conhecimento. Os dois lados são obrigatórios."""
	actor_id = _user_id(user_id)
	if not actor_id:
		return {"ok": False, "message": "É preciso estar logado para salvar no conhecimento."}
	problem = sanitize_for_rag(str(args.get("problem") or args.get("problema") or ""))
	solution = sanitize_for_rag(str(args.get("solution") or args.get("solucao") or ""))
	title = sanitize_for_rag(str(args.get("title") or ""))
	if len(problem) < 12:
		return {"ok": False, "message": "Descreva o problema ou o erro do print. Ainda não salvei."}
	if len(solution) < 12:
		return {
			"ok": False,
			"message": "Falta a solução. Pergunte como foi resolvido e só salve quando a pessoa responder.",
		}
	category = _support_category(actor_id)
	category_id = int(category.id)
	heading = (title or problem.splitlines()[0])[:180]
	content = f"Problema\n{problem}\n\nSolução\n{solution}"
	article = KnowledgeArticle(
		title=heading,
		content=content,
		summary=problem[:300],
		tags="suporte, solução",
		category_id=category_id,
		status="published",
		created_by_id=actor_id,
	)
	db.session.add(article)
	db.session.commit()
	article_id = int(article.id)
	try:
		attached = _attach_chat_image(article_id, actor_id)
	except Exception:
		db.session.rollback()
		attached = False
	if attached:
		content = f"{content}\n\nO print do erro está anexado neste artigo."
		article.content = content
		db.session.commit()
	try:
		index_source("knowledge_article", article_id)
	except Exception:
		db.session.rollback()
	payload = {
		"ok": True,
		"article_id": article_id,
		"title": heading,
		"category_id": category_id,
		"attachment": attached,
		"message": (
			f"Salvei no conhecimento, com o print anexado: {heading}."
			if attached
			else f"Salvei no conhecimento, categoria Suporte: {heading}."
		),
	}
	_saved_article.set(
		{"article_id": article_id, "title": heading, "category_id": category_id}
	)
	return payload


def _attach_chat_image(article_id: int, user_id: int) -> bool:
	image = _chat_image.get()
	if not image:
		return False
	data, mime = image
	if not data:
		return False
	ext = _IMAGE_EXT.get(mime, "png")
	folder = os.path.join(current_app.instance_path, "knowledge_uploads")
	os.makedirs(folder, exist_ok=True)
	unique = f"{uuid.uuid4()}_print-do-erro.{ext}"
	path = os.path.join(folder, unique)
	with open(path, "wb") as handle:
		handle.write(data)
	db.session.add(
		KnowledgeAttachment(
			article_id=article_id,
			filename=unique,
			original_filename=f"print-do-erro.{ext}",
			file_path=unique,
			file_size=len(data),
			file_type=mime,
			description="Print enviado no assistente",
			created_by_id=user_id,
		)
	)
	db.session.commit()
	return True


def group_jid(raw: str | None) -> str:
	"""Normaliza um JID de grupo. Vazio quando o valor não parece um grupo."""
	base = re.sub(r"@g\.us$", "", str(raw or "").strip(), flags=re.I)
	digits = re.sub(r"\D", "", base)
	if len(digits) < 8:
		return ""
	return f"{digits}@g.us"


def _as_int(value) -> int | None:
	try:
		number = int(value)
	except (TypeError, ValueError):
		return None
	return number if number > 0 else None


def _clean_group_message(raw: str) -> str:
	text = str(raw or "").replace("\x00", "")
	text = _BEARER_LINE.sub("Bearer [removido]", text)
	text = _SECRET_LINE.sub(lambda match: f"{match.group(1)}=[removido]", text)
	text = re.sub(r"\n{3,}", "\n\n", text).strip()
	return text


def _fold(value: str) -> str:
	return re.sub(r"\s+", " ", (value or "").casefold()).strip()


def _query_tokens(query: str) -> list[str]:
	folded = _fold(query)
	if not folded or folded in _SEND_ALL:
		return []
	return [token for token in folded.split(" ") if token and token not in _GROUP_STOPWORDS]


def collect_agent_groups(prompts, connections, contacts) -> list[dict]:
	"""Agrupa os grupos de alerta dos agentes, um item por JID."""
	by_prompt: dict[int, list[dict]] = {}
	for item in connections or []:
		if not isinstance(item, dict):
			continue
		prompt_id = _as_int(item.get("promptId"))
		whatsapp_id = _as_int(item.get("id"))
		if not prompt_id or not whatsapp_id:
			continue
		by_prompt.setdefault(prompt_id, []).append(
			{
				"id": whatsapp_id,
				"name": str(item.get("name") or "").strip(),
				"connected": str(item.get("status") or "").upper() == "CONNECTED",
			}
		)
	names: dict[str, str] = {}
	for item in contacts or []:
		if not isinstance(item, dict):
			continue
		jid = group_jid(item.get("number") or item.get("id"))
		name = str(item.get("name") or "").strip()
		if jid and name:
			names[jid] = name

	grouped: dict[str, dict] = {}
	for row in prompts or []:
		if not isinstance(row, dict):
			continue
		jid = group_jid(row.get("idleAlertGroupJid"))
		agent = str(row.get("name") or "").strip()
		prompt_id = _as_int(row.get("id"))
		if not jid or not agent:
			continue
		bucket = grouped.setdefault(
			jid,
			{
				"jid": jid,
				"group_name": names.get(jid) or "",
				"agents": [],
				"whatsapp_id": None,
				"whatsapp_name": "",
				"connected": False,
			},
		)
		if agent not in bucket["agents"]:
			bucket["agents"].append(agent)
		if not bucket["group_name"]:
			bucket["group_name"] = names.get(jid) or f"Grupo de {agent}"
		for connection in by_prompt.get(prompt_id or -1, []):
			if bucket["connected"] and not connection["connected"]:
				continue
			if connection["connected"] or not bucket["whatsapp_id"]:
				bucket["whatsapp_id"] = connection["id"]
				bucket["whatsapp_name"] = connection["name"]
				bucket["connected"] = connection["connected"]
	return list(grouped.values())


def _group_haystack(group: dict) -> str:
	agents = " ".join(group.get("agents") or [])
	return _fold(f"{group.get('group_name') or ''} {agents} {group.get('whatsapp_name') or ''}")


def _matches_group(group: dict, query: str, tokens: list[str]) -> bool:
	folded = _fold(query)
	names = [_fold(group.get("group_name") or "")]
	names.extend(_fold(agent) for agent in group.get("agents") or [])
	names.append(_fold(group.get("whatsapp_name") or ""))
	if folded and folded in names:
		return True
	if group_jid(query) and group_jid(query) == group.get("jid"):
		return True
	haystack = _group_haystack(group)
	if folded and folded in haystack:
		return True
	return bool(tokens) and all(token in haystack for token in tokens)


def resolve_agent_groups(groups: list[dict], query: str) -> dict:
	"""Escolhe um grupo, todos, ou devolve a lista para a pessoa decidir."""
	available = [group for group in groups if group.get("jid")]
	if not available:
		return {
			"action": "none",
			"groups": [],
			"message": (
				"Nenhum agente tem grupo de WhatsApp configurado. "
				"Em Configurações, abra o agente e escolha o grupo que recebe os alertas."
			),
		}
	folded = _fold(query)
	if folded in _SEND_ALL:
		return {"action": "send", "groups": available, "message": ""}
	tokens = _query_tokens(query)
	if not folded or not tokens:
		if len(available) == 1:
			return {"action": "send", "groups": available, "message": ""}
		return {
			"action": "choose",
			"groups": available,
			"message": "Há mais de um grupo de agentes. Pergunte em qual deve enviar.",
		}
	matched = [group for group in available if _matches_group(group, query, tokens)]
	if len(matched) == 1:
		return {"action": "send", "groups": matched, "message": ""}
	if not matched:
		return {
			"action": "choose",
			"groups": available,
			"message": "Não encontrei esse grupo. Pergunte qual dos grupos abaixo deve receber a mensagem.",
		}
	return {
		"action": "choose",
		"groups": matched,
		"message": "Esse nome combina com mais de um grupo. Pergunte qual deve receber a mensagem.",
	}


def _public_groups(groups: list[dict]) -> list[dict]:
	public = []
	for group in groups:
		public.append(
			{
				"group": group.get("group_name") or "Grupo",
				"agents": group.get("agents") or [],
				"whatsapp": group.get("whatsapp_name") or "",
				"connected": bool(group.get("connected")),
			}
		)
	return public


def _sign_group_message(body: str, author: str) -> str:
	text = body.strip()
	name = re.sub(r"\s+", " ", (author or "").strip())
	if not name:
		return text
	signature = f"*{name.upper()}*"
	if text.upper().startswith(signature):
		return text
	return f"{signature}\n{text}"


def _utc_naive(moment: datetime) -> datetime:
	return moment.astimezone(timezone.utc).replace(tzinfo=None)


def brasilia_period(now: datetime | None = None) -> dict:
	"""Início e fim do dia e do mês em Brasília, convertidos para o UTC gravado no banco."""
	clock = now or datetime.now(_BRASILIA)
	if clock.tzinfo is None:
		clock = clock.replace(tzinfo=_BRASILIA)
	else:
		clock = clock.astimezone(_BRASILIA)
	start = clock.replace(hour=0, minute=0, second=0, microsecond=0)
	month = start.replace(day=1)
	if month.month == 12:
		next_month = month.replace(year=month.year + 1, month=1)
	else:
		next_month = month.replace(month=month.month + 1)
	return {
		"label": start.strftime("%d/%m/%Y"),
		"month_label": start.strftime("%m/%Y"),
		"day_start": _utc_naive(start),
		"day_end": _utc_naive(start + timedelta(days=1)),
		"month_start": _utc_naive(month),
		"month_end": _utc_naive(next_month),
	}


def _active_tickets():
	from ..models import Ticket

	return Ticket.query.filter(Ticket.status != "cancelado", Ticket.cancelled_at.is_(None))


def _ticket_line(ticket) -> dict:
	attendant = ""
	if ticket.assigned_to_id and ticket.assigned_to_user:
		attendant = ticket.assigned_to_user.name or ""
	return {
		"id": ticket.id,
		"title": ticket.title or "",
		"client": ticket.external_client_name or "",
		"status": ticket.status or "",
		"attendant": attendant or "sem atendente",
	}


def operation_report(args: dict, user_id: int | None = None) -> dict:
	"""Números reais dos chamados para o assistente montar o texto do grupo."""
	if not _user_id(user_id):
		return {"ok": False, "message": "É preciso estar logado para consultar os chamados."}
	kind = str(args.get("kind") or args.get("tipo") or "hoje").strip().lower()
	aliases = {
		"hoje": "hoje",
		"dia": "hoje",
		"tickets_do_dia": "hoje",
		"chamados_do_dia": "hoje",
		"criados_hoje": "criados_hoje",
		"criados": "criados_hoje",
		"tickets_criados": "criados_hoje",
		"top_mes": "top_mes",
		"top": "top_mes",
		"top_atendentes": "top_mes",
		"atendentes": "top_mes",
	}
	kind = aliases.get(kind, "")
	if not kind:
		return {
			"ok": False,
			"message": "Tipo de relatório inválido. Use hoje, criados_hoje ou top_mes.",
		}
	from ..models import Ticket, User

	period = brasilia_period()
	if kind == "top_mes":
		rows = (
			db.session.query(User.name, db.func.count(Ticket.id))
			.join(Ticket, Ticket.assigned_to_id == User.id)
			.filter(
				Ticket.status != "cancelado",
				Ticket.cancelled_at.is_(None),
				Ticket.closed_at.isnot(None),
				Ticket.closed_at >= period["month_start"],
				Ticket.closed_at < period["month_end"],
			)
			.group_by(User.id, User.name)
			.order_by(db.func.count(Ticket.id).desc(), User.name.asc())
			.limit(10)
			.all()
		)
		ranking = [{"name": name or "Sem nome", "closed": int(count)} for name, count in rows]
		return {
			"ok": True,
			"kind": kind,
			"month": period["month_label"],
			"ranking": ranking,
			"message": "Use só este ranking no texto. Não invente outro nome ou quantidade.",
		}

	created = (
		_active_tickets()
		.filter(Ticket.created_at >= period["day_start"], Ticket.created_at < period["day_end"])
		.order_by(Ticket.id.desc())
		.all()
	)
	closed_count = (
		_active_tickets()
		.filter(Ticket.closed_at >= period["day_start"], Ticket.closed_at < period["day_end"])
		.count()
	)
	open_count = _active_tickets().filter(Ticket.status.in_(("aberto", "em_andamento"))).count()
	if kind == "criados_hoje":
		listed = created[:12]
		return {
			"ok": True,
			"kind": kind,
			"date": period["label"],
			"created": len(created),
			"tickets": [_ticket_line(ticket) for ticket in listed],
			"hidden": max(0, len(created) - len(listed)),
			"message": "Use só estes chamados criados hoje. Não invente outro.",
		}
	return {
		"ok": True,
		"kind": "hoje",
		"date": period["label"],
		"created": len(created),
		"closed": int(closed_count),
		"open": int(open_count),
		"tickets": [_ticket_line(ticket) for ticket in created[:12]],
		"hidden": max(0, len(created) - min(len(created), 12)),
		"message": "Use só estes números no relatório do dia. Não invente outro.",
	}


def _author_name(user_id: int | None) -> str:
	from ..models import User

	actor_id = _user_id(user_id)
	if not actor_id:
		return ""
	user = db.session.get(User, actor_id)
	return (user.name or "").strip() if user else ""


def _load_agent_groups() -> list[dict]:
	from ..engine_client import EngineError, admin_request

	prompts: list[dict] = []
	page = 1
	while page <= 10:
		data = admin_request("GET", "/prompt", params={"pageNumber": str(page)}) or {}
		chunk = data.get("prompts") if isinstance(data, dict) else []
		prompts.extend(item for item in (chunk or []) if isinstance(item, dict))
		if not (isinstance(data, dict) and data.get("hasMore")):
			break
		page += 1
	connections = admin_request("GET", "/whatsapp") or []
	if isinstance(connections, dict):
		connections = connections.get("whatsapps") or connections.get("rows") or []
	try:
		contacts = admin_request("GET", "/contacts/groups") or []
	except EngineError:
		contacts = []
	if isinstance(contacts, dict):
		contacts = contacts.get("contacts") or contacts.get("groups") or []
	return collect_agent_groups(prompts, connections, contacts)


def _remember_sent(key: str) -> bool:
	"""True quando esta conversa já enviou a mesma mensagem para o mesmo grupo."""
	sent = _sent_group_keys.get()
	if sent is None:
		sent = set()
		_sent_group_keys.set(sent)
	if key in sent:
		return True
	return False


def _mark_sent(key: str) -> None:
	sent = _sent_group_keys.get()
	if sent is None:
		sent = set()
		_sent_group_keys.set(sent)
	sent.add(key)


def send_agent_group_message(args: dict, user_id: int | None = None) -> dict:
	"""Envia um texto pronto ao grupo de WhatsApp vinculado aos agentes de IA."""
	from ..engine_client import EngineError, admin_request

	if not _user_id(user_id):
		return {"ok": False, "message": "É preciso estar logado para enviar no grupo."}
	message = _clean_group_message(str(args.get("message") or args.get("texto") or ""))
	if len(message) < 8:
		return {
			"ok": False,
			"message": "Falta o texto da mensagem. Monte o relatório ou o comunicado e envie de novo.",
		}
	if len(message) > _MESSAGE_LIMIT:
		return {
			"ok": False,
			"message": "A mensagem passa de 6000 caracteres. Resuma e envie de novo.",
		}
	target = str(args.get("group") or args.get("grupo") or args.get("agente") or "").strip()
	try:
		groups = _load_agent_groups()
	except EngineError as exc:
		return {"ok": False, "message": f"Não consegui consultar os grupos dos agentes: {exc}"}
	except Exception as exc:  # noqa: BLE001
		return {"ok": False, "message": f"Não consegui consultar os grupos dos agentes: {exc}"}

	decision = resolve_agent_groups(groups, target)
	if decision["action"] != "send":
		return {
			"ok": False,
			"needs_choice": decision["action"] == "choose",
			"message": decision["message"],
			"groups": _public_groups(decision["groups"]),
		}

	author = _author_name(user_id)
	signed = _sign_group_message(message, author)
	sent_names: list[str] = []
	failures: list[dict] = []
	for group in decision["groups"]:
		label = group.get("group_name") or "Grupo"
		key = f"{group['jid']}:{signed}"
		if _remember_sent(key):
			sent_names.append(label)
			continue
		if not group.get("whatsapp_id"):
			failures.append({"group": label, "message": "O agente não está ligado a um WhatsApp."})
			continue
		if not group.get("connected"):
			failures.append({"group": label, "message": "O WhatsApp do agente está desconectado."})
			continue
		try:
			admin_request(
				"POST",
				"/messages/send-to-group",
				json={
					"groupJid": group["jid"],
					"body": signed,
					"whatsappId": group["whatsapp_id"],
				},
			)
		except EngineError as exc:
			failures.append({"group": label, "message": str(exc)})
			continue
		_mark_sent(key)
		sent_names.append(label)

	if sent_names and not failures:
		names = ", ".join(sent_names)
		return {
			"ok": True,
			"groups": sent_names,
			"message": f"Mensagem enviada no grupo {names}.",
		}
	if sent_names:
		return {
			"ok": False,
			"groups": sent_names,
			"failed": failures,
			"message": (
				f"Enviei em {', '.join(sent_names)}. "
				f"Não consegui enviar em {', '.join(item['group'] for item in failures)}."
			),
		}
	detail = failures[0]["message"] if len(failures) == 1 else "Não consegui enviar em nenhum grupo."
	return {"ok": False, "failed": failures, "message": detail}
