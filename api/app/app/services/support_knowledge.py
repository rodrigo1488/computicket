"""Extrai a solução de uma conversa de suporte e grava no banco de conhecimento."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func

from .. import db
from ..models import KnowledgeArticle, KnowledgeCategory
from .copilot import MAX_HISTORY_CHARS, CopilotError, _generate, _trim


def extract_support_solution(history: str, system_name: str = "") -> dict:
	history = _trim(history, MAX_HISTORY_CHARS)
	if not history:
		raise CopilotError(
			"A conversa ainda não tem mensagens para interpretar.",
			"validation",
			400,
		)
	system = (system_name or "").strip() or "sistema"
	data = _generate(
		f"SISTEMA:\n{system}\n\nCONVERSA:\n{history}",
		(
			"Você analisa uma conversa direta com o suporte de um sistema externo. "
			"Mensagens marcadas como Equipe foram enviadas pela nossa equipe. "
			"Mensagens marcadas como Suporte são a resposta do suporte daquele sistema. "
			"Extraia o problema tratado e a solução que o suporte forneceu. "
			"Não invente passos, causas ou correções que não estejam na conversa. "
			"Se ainda não houver uma solução clara dada pelo suporte, deixe solution vazio "
			"e hasSolution false. "
			"Retorne JSON com title, problem, solution e hasSolution."
		),
		{
			"type": "object",
			"properties": {
				"title": {"type": "string"},
				"problem": {"type": "string"},
				"solution": {"type": "string"},
				"hasSolution": {"type": "boolean"},
			},
			"required": ["title", "problem", "solution", "hasSolution"],
		},
	)
	title = str(data.get("title") or "").strip()[:200]
	problem = str(data.get("problem") or "").strip()
	solution = str(data.get("solution") or "").strip()
	has_solution = bool(data.get("hasSolution")) and bool(solution)
	if not title:
		title = f"Solução de suporte — {system}"[:200]
	return {
		"title": title,
		"problem": problem,
		"solution": solution,
		"has_solution": has_solution,
		"system_name": system if system != "sistema" else "",
	}


def save_support_article(
	*,
	title: str,
	problem: str,
	solution: str,
	system_name: str,
	user_id: int,
) -> KnowledgeArticle:
	title = (title or "").strip()[:200]
	problem = (problem or "").strip()
	solution = (solution or "").strip()
	system_name = (system_name or "").strip() or "Suporte"
	if not title or not solution:
		raise ValueError("Título e solução são obrigatórios para gravar no conhecimento.")

	category = KnowledgeCategory.query.filter(
		func.lower(KnowledgeCategory.name) == system_name.lower()
	).first()
	now = datetime.utcnow()
	if not category:
		category = KnowledgeCategory(
			name=system_name[:100],
			description=f"Soluções recebidas do suporte de {system_name}"[:500],
			icon="fas fa-headset",
			color="#0EA5E9",
			created_by_id=user_id,
			created_at=now,
			updated_at=now,
		)

	content = (
		f"Problema\n{problem or '—'}\n\n"
		f"Solução\n{solution}\n\n"
		f"Origem: conversa de suporte ({system_name})"
	)
	# Instancia o artigo antes de pendurar a categoria na sessão. O default de data
	# consulta o fuso e, ao sair do app context, faria rollback de um flush anterior.
	article = KnowledgeArticle(
		title=title,
		content=content,
		summary=(problem or solution)[:500] or None,
		tags="suporte, conversa-suporte",
		status="published",
		created_by_id=user_id,
		created_at=now,
		updated_at=now,
	)
	article.category = category
	db.session.add(article)
	db.session.commit()
	return article
