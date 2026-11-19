"""Serviço de geração assistida com contexto RAG."""
from __future__ import annotations

import base64
import contextvars
import importlib
import json
import sys
from pathlib import Path
from typing import Any

from .gemini_client import GeminiConfigError, generation_model, get_client
from .rag import SOURCE_ARTICLE, hybrid_search, sanitize_for_rag

MAX_INPUT_CHARS = 12000
MAX_HISTORY_CHARS = 16000


class CopilotError(RuntimeError):
	def __init__(self, message: str, code: str = "gemini_error", status_code: int = 503):
		super().__init__(message)
		self.code = code
		self.status_code = status_code


def _trim(value: str | None, limit: int) -> str:
	return sanitize_for_rag(value or "")[:limit]


def _source_context(sources: list[dict]) -> str:
	return "\n\n".join(
		f"[{index}] {item['source_type']} #{item['source_id']} — {item['title']}\n{item['snippet']}"
		for index, item in enumerate(sources, 1)
	)


def _filter_cited_sources(sources: list[dict], cited: Any) -> list[dict]:
	"""Mantém só as fontes que o modelo citou; se não citar, devolve todas."""
	indexes: list[int] = []
	if isinstance(cited, list):
		for value in cited:
			try:
				idx = int(value)
			except (TypeError, ValueError):
				continue
			if 1 <= idx <= len(sources):
				indexes.append(idx)
	if not indexes:
		return sources
	seen: set[int] = set()
	picked: list[dict] = []
	for idx in indexes:
		if idx in seen:
			continue
		seen.add(idx)
		picked.append(sources[idx - 1])
	return picked or sources


def _generate(
	contents: str,
	system: str,
	schema: dict[str, Any],
	temperature: float = 0.25,
) -> dict[str, Any]:
	try:
		response = get_client().models.generate_content(
			model=generation_model(),
			contents=contents,
			config={
				"system_instruction": system,
				"response_mime_type": "application/json",
				"response_json_schema": schema,
				"temperature": temperature,
			},
		)
	except GeminiConfigError as exc:
		raise CopilotError(str(exc), "gemini_config", 503) from exc
	except Exception as exc:
		raise CopilotError(f"Falha ao consultar o Gemini: {exc}") from exc
	text = (getattr(response, "text", None) or "").strip()
	try:
		data = json.loads(text)
	except (json.JSONDecodeError, TypeError) as exc:
		raise CopilotError("O Gemini retornou uma resposta inválida.", "invalid_response") from exc
	if not isinstance(data, dict):
		raise CopilotError("O Gemini retornou um formato inesperado.", "invalid_response")
	return data


def _prepare(query: str, history: str = "", source_types: set[str] | None = None) -> tuple[str, str, list[dict]]:
	query = _trim(query, MAX_INPUT_CHARS)
	history = _trim(history, MAX_HISTORY_CHARS)
	if not query:
		raise CopilotError("Informe um texto para o Copiloto.", "validation", 400)
	search_query = f"{query} {history[-3000:]}".strip()
	return query, history, hybrid_search(search_query, source_types=source_types)


_CUSTOMER_ANSWER_RULES = (
	"Você responde um cliente final da Computicket. Use só o procedimento geral do artigo. "
	"Não cite outros clientes, empresas, chamados, atendimentos abertos, agenda ou dado interno. "
	"Se a pergunta pede lista de clientes ou de atendimentos, diga que essa informação não pode ser passada."
)


def answer_question(question: str, history: str = "", public_only: bool = False) -> dict:
	question, history, sources = _prepare(
		question,
		history,
		{SOURCE_ARTICLE} if public_only else None,
	)
	if not sources:
		return {
			"draft": (
				"Não encontrei evidências suficientes na base de conhecimento, "
				"tickets, cofre de senhas ou orçamentos para responder com segurança."
			),
			"sources": [],
		}
	staff_rules = (
		"Você é o Copiloto de suporte do Computicket. Responda em português do Brasil, "
		"objetivamente. Use as fontes como base factual e não invente credenciais, procedimentos "
		"ou fatos ausentes. Priorize artigos da base de conhecimento quando existirem. "
		"Cite no texto os artigos usados pelo título (ex.: segundo o artigo X). "
		"Retorne JSON com draft e cited: lista dos números [1], [2] das FONTES realmente usadas. "
		"Fontes podem ser artigos, tickets, metadados do cofre de senhas "
		"(máquina/AnyDesk/cliente) e orçamentos. "
		"Nunca peça nem reproduza senhas, tokens ou dados pessoais. "
		"Se a fonte for do cofre, indique a máquina/cliente e oriente abrir o Cofre — "
		"nunca invente nem cite a senha."
	)
	data = _generate(
		f"PERGUNTA:\n{question}\n\nHISTÓRICO MÍNIMO:\n{history}\n\nFONTES:\n{_source_context(sources)}",
		_CUSTOMER_ANSWER_RULES if public_only else staff_rules,
		{
			"type": "object",
			"properties": {
				"draft": {"type": "string"},
				"cited": {"type": "array", "items": {"type": "integer"}},
			},
			"required": ["draft"],
		},
	)
	return {
		"draft": str(data.get("draft") or "").strip(),
		"sources": _filter_cited_sources(sources, data.get("cited")),
	}


_ASSISTANT_SCHEMA = {
	"type": "object",
	"properties": {
		"draft": {"type": "string"},
		"cited": {"type": "array", "items": {"type": "integer"}},
	},
	"required": ["draft", "cited"],
}


def _cited_sources(sources: list[dict], cited: Any) -> list[dict]:
	"""Fontes que o assistente declarou ter usado. Lista vazia não puxa o restante."""
	if not isinstance(cited, list) or not cited:
		return []
	return _filter_cited_sources(sources, cited)


_DB_TOOL_ROUNDS = 6
_DB_RESULT_CHARS = 12000

_DB_TOOLS = [
	{
		"function_declarations": [
			{
				"name": "list_tables",
				"description": "Lista tabelas do Postgres. database: computicket (aplicação) ou whatsapp.",
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"database": {"type": "STRING", "description": "computicket ou whatsapp"},
						"schema": {"type": "STRING", "description": "Padrão public"},
					},
				},
			},
			{
				"name": "describe_table",
				"description": "Mostra colunas, chave primária e chaves estrangeiras de uma tabela.",
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"table": {"type": "STRING"},
						"database": {"type": "STRING", "description": "computicket ou whatsapp"},
						"schema": {"type": "STRING"},
					},
					"required": ["table"],
				},
			},
			{
				"name": "find_columns",
				"description": "Procura colunas pelo nome para saber em qual tabela um campo está.",
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"term": {"type": "STRING"},
						"database": {"type": "STRING", "description": "computicket ou whatsapp"},
					},
					"required": ["term"],
				},
			},
			{
				"name": "query",
				"description": (
					"Executa uma consulta somente leitura (SELECT, WITH, EXPLAIN, SHOW ou TABLE). "
					"Senha, token, hash e embedding voltam redigidos."
				),
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"sql": {"type": "STRING"},
						"database": {"type": "STRING", "description": "computicket ou whatsapp"},
						"limit": {"type": "INTEGER", "description": "Máximo de linhas, até 200"},
					},
					"required": ["sql"],
				},
			},
			{
				"name": "create_appointment",
				"description": (
					"Cria uma visita na agenda. Só chame quando cliente, data e horário já estiverem claros. "
					"Sem esses dados a ferramenta não grava e devolve o que falta."
				),
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"title": {"type": "STRING", "description": "Título curto da visita"},
						"appointment_date": {
							"type": "STRING",
							"description": "Data e hora no formato ISO, por exemplo 2026-11-16T14:00:00",
						},
						"cliente": {"type": "STRING", "description": "Nome da empresa já vinculada a um WhatsApp"},
						"tecnico": {"type": "STRING", "description": "Nome do técnico. Vazio usa a pessoa logada"},
						"description": {"type": "STRING", "description": "Detalhe opcional"},
					},
					"required": ["title", "appointment_date", "cliente"],
				},
			},
			{
				"name": "save_support_solution",
				"description": (
					"Grava no conhecimento um problema de suporte e a solução que a equipe informou. "
					"Exige os dois. Print ou erro sem a resolução não deve ser salvo."
				),
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"title": {"type": "STRING", "description": "Título curto. Opcional"},
						"problem": {"type": "STRING", "description": "Erro, print ou relato do problema"},
						"solution": {"type": "STRING", "description": "Como o problema foi resolvido"},
					},
					"required": ["problem", "solution"],
				},
			},
			{
				"name": "operation_report",
				"description": (
					"Busca números reais dos chamados do Computicket. "
					"kind hoje: criados hoje, fechados hoje e quantos seguem abertos. "
					"kind criados_hoje: só os chamados abertos hoje. "
					"kind top_mes: ranking de quem fechou mais chamados no mês. "
					"Use estes números no relatório. Não troque por uma conta feita de cabeça."
				),
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"kind": {
							"type": "STRING",
							"description": "hoje, criados_hoje ou top_mes",
						},
					},
					"required": ["kind"],
				},
			},
			{
				"name": "send_agent_group_message",
				"description": (
					"Envia um texto pronto no grupo de WhatsApp dos agentes de IA. "
					"Use quando pedirem para avisar, comunicar ou mandar um relatório nesse grupo. "
					"message é o texto final, em português, pronto para o celular. "
					"group fica vazio quando existe um grupo só; se houver vários, use o nome do grupo ou do agente. "
					"Use 'todos' para mandar em todos os grupos dos agentes."
				),
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"message": {
							"type": "STRING",
							"description": "Texto que o grupo vai receber. Sem HTML e sem tabela.",
						},
						"group": {
							"type": "STRING",
							"description": "Nome do grupo ou do agente. Vazio envia no único grupo configurado.",
						},
					},
					"required": ["message"],
				},
			},
			{
				"name": "create_article_from_pdf",
				"description": (
					"Cria um artigo na base de conhecimento usando o arquivo .pdf transcrito enviado na mensagem. "
					"O título do artigo segue automaticamente o nome do arquivo PDF e o conteúdo preserva o texto e imagens transcritas. "
					"Chame esta ferramenta quando o usuário enviar um PDF pedindo para criar, salvar ou gerar um artigo, ou quando confirmar que deseja criar."
				),
				"parameters": {
					"type": "OBJECT",
					"properties": {
						"category_name": {
							"type": "STRING",
							"description": "Nome da categoria desejada, se o usuário citou alguma. Opcional (padrão Suporte).",
						},
						"tags": {
							"type": "STRING",
							"description": "Tags separadas por vírgula relacionadas ao conteúdo do PDF. Opcional.",
						},
					},
				},
			},
		]
	}
]

_STAFF_ACTIONS = {
	"create_appointment",
	"save_support_solution",
	"create_article_from_pdf",
	"operation_report",
	"send_agent_group_message",
}
_assistant_actor: contextvars.ContextVar[int | None] = contextvars.ContextVar("assistant_actor_id", default=None)
_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_IMAGE_BYTES = 4_000_000

_ASSISTANT_SYSTEM = (
	"Você é o assistente da equipe Computicket no dashboard. "
	"Converse como um colega técnico, em português do Brasil, e responda à última fala. "
	"Quando a resposta depender de um fato da operação — chamado, cliente, agenda, conversa, "
	"orçamento, estoque, cofre — consulte o banco com as ferramentas antes de afirmar. "
	"Não invente número de chamado, valor, nome de cliente, senha ou procedimento interno. "
	"Se a consulta não achar a linha ou falhar, diga isso e continue ajudando. "
	"Senha, token e hash já vêm redigidos; não tente revelá-los. "
	"Se a fonte for do cofre, indique a máquina ou o cliente e oriente abrir o Cofre. "
	"O material interno é apoio, não um roteiro: não copie trechos nem comece com 'segundo o artigo'. "
	"Se a pergunta não precisa do banco, responda direto. Seja direto, em parágrafos curtos. "
	"Para agendar, use create_appointment só com cliente, data e horário claros. Se faltar um deles, pergunte. "
	"Não diga que a visita foi marcada se a ferramenta não devolver ok. Sem técnico citado, vale a pessoa logada. "
	"Quando a equipe trouxer um problema de suporte — texto, erro ou print — e também a solução, "
	"use save_support_solution. Problema e solução são obrigatórios e vão em texto corrido, sem HTML. "
	"O print desta conversa é anexado sozinho: no problem, descreva o erro que aparece na imagem. "
	"Se chegar só o print ou só o erro, descreva o que você leu e peça a resolução. Não salve ainda. "
	"Quando a solução vier depois, use o problema já descrito na conversa e a solução nova. "
	"Não invente a solução e não grave senha, token ou dado de cofre. "
	"Se o usuário enviar um arquivo .pdf: se ele pedir para criar/salvar/transformar em artigo (ou confirmar), "
	"chame create_article_from_pdf imediatamente. O título do artigo sempre seguirá o nome do arquivo PDF e manterá texto e imagens transcritas. "
	"Se o usuário enviar o PDF apenas para consulta ou sem instrução clara, responda/resuma o conteúdo e pergunte se deseja criar um artigo com ele. "
	"Quando pedirem para enviar, avisar ou comunicar no grupo de WhatsApp dos agentes, "
	"escreva o texto final e chame send_agent_group_message uma vez. "
	"Se pedirem só a análise no chat, responda aqui e pergunte se deve mandar ao grupo. "
	"Para relatório de chamados de hoje, criados hoje ou top atendentes do mês, "
	"chame operation_report e use só os números que ela devolver. "
	"Para outro recorte, consulte o banco. No message vai só o texto pronto para o celular: "
	"português, parágrafos curtos, sem tabela e sem HTML. "
	"Chamados do Computicket estão na tabela ticket. status: aberto, em_andamento, fechado, cancelado. "
	"Ignore status cancelado e linhas com cancelled_at. "
	"created_at e closed_at estão em UTC. O dia em Brasília é "
	"(coluna AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date "
	"comparado com (now() AT TIME ZONE 'America/Sao_Paulo')::date. "
	"O atendente é \"user\".name, ligado por assigned_to_id. "
	"Top do mês: chamados com closed_at nesse mês, agrupados pelo atendente. "
	"Se a pergunta for sobre conversas do WhatsApp, e não sobre chamados, use o banco whatsapp e a tabela \"Tickets\". "
	"A ferramenta assina com quem está logado. Não repita a assinatura no texto. "
	"Não diga que enviou se a ferramenta não devolver ok. "
	"Se ela listar vários grupos, pergunte qual. Com um grupo só, envie direto. "
	"Para todos os grupos, use group todos. "
	"Não mande senha, token, dado de cofre nem documento de cliente."
)


def _database_module():
	here = Path(__file__).resolve()
	folders = [
		here.parents[4] / "mcp" / "computicket_db",
		here.parents[2] / "computicket_db",
	]
	for folder in folders:
		if not (folder / "dbtools.py").exists():
			continue
		folder_text = str(folder)
		if folder_text not in sys.path:
			sys.path.insert(0, folder_text)
		return importlib.import_module("dbtools")
	raise CopilotError("Consulta ao banco não está disponível neste ambiente.", "db_tools", 503)


def _dispatch_staff_action(name: str, args: dict) -> str:
	from .assistant_actions import (
		create_appointment,
		create_article_from_pdf,
		operation_report,
		save_support_solution,
		send_agent_group_message,
	)

	actor = _assistant_actor.get()
	if name == "create_appointment":
		payload = create_appointment(args, actor)
	elif name == "create_article_from_pdf":
		payload = create_article_from_pdf(args, actor)
	elif name == "operation_report":
		payload = operation_report(args, actor)
	elif name == "send_agent_group_message":
		payload = send_agent_group_message(args, actor)
	else:
		payload = save_support_solution(args, actor)
	return json.dumps(payload, ensure_ascii=False)


def _dispatch_database_tool(name: str, args: dict) -> str:
	try:
		if name in _STAFF_ACTIONS:
			result = _dispatch_staff_action(name, args)
		else:
			result = _database_module().dispatch(name, args)
	except CopilotError as exc:
		result = json.dumps({"error": str(exc)}, ensure_ascii=False)
	except Exception as exc:  # noqa: BLE001
		result = json.dumps({"error": str(exc)[:500]}, ensure_ascii=False)
	if len(result) > _DB_RESULT_CHARS:
		return result[:_DB_RESULT_CHARS] + "… [truncado]"
	return result


def _tool_args(call) -> dict:
	raw = call.get("args") if isinstance(call, dict) else getattr(call, "args", None)
	raw = raw or {}
	if isinstance(raw, dict):
		return raw
	try:
		return dict(raw)
	except (TypeError, ValueError):
		return {}


def _call_name(call) -> str:
	if isinstance(call, dict):
		return str(call.get("name") or "")
	return str(getattr(call, "name", "") or "")


def _function_calls(response) -> list:
	calls = getattr(response, "function_calls", None)
	if calls:
		named = [call for call in list(calls) if _call_name(call)]
		if named:
			return named
	found = []
	for candidate in getattr(response, "candidates", None) or []:
		content = getattr(candidate, "content", None)
		parts = content.get("parts") if isinstance(content, dict) else getattr(content, "parts", None)
		for part in parts or []:
			if isinstance(part, dict):
				call = part.get("function_call") or part.get("functionCall")
			else:
				call = getattr(part, "function_call", None)
			if call is not None and _call_name(call):
				found.append(call)
	return found


def _assistant_text(response) -> str:
	try:
		text = getattr(response, "text", None)
		if text:
			return str(text).strip()
	except Exception:
		pass
	chunks: list[str] = []
	for candidate in getattr(response, "candidates", None) or []:
		content = getattr(candidate, "content", None)
		for part in getattr(content, "parts", None) or []:
			part_text = getattr(part, "text", None)
			if part_text:
				chunks.append(str(part_text))
	return "".join(chunks).strip()


def _draft_from_text(text: str) -> str:
	stripped = (text or "").strip()
	if stripped.startswith("{"):
		try:
			data = json.loads(stripped)
		except json.JSONDecodeError:
			return stripped
		if isinstance(data, dict) and str(data.get("draft") or "").strip():
			return str(data["draft"]).strip()
	return stripped


def _model_content(response, text: str):
	candidates = getattr(response, "candidates", None) or []
	if candidates:
		content = getattr(candidates[0], "content", None)
		if content is not None:
			return content
	return {"role": "model", "parts": [{"text": text}]}


def _function_payload(raw: str) -> dict:
	try:
		data = json.loads(raw)
	except json.JSONDecodeError:
		return {"result": raw}
	if isinstance(data, dict):
		return data
	return {"result": data}


def _decode_chat_image(image: str | None) -> tuple[bytes, str] | None:
	raw = (image or "").strip()
	if not raw:
		return None
	mime = "image/png"
	if raw.startswith("data:"):
		header, _, payload = raw.partition(",")
		mime = header[5:].split(";", 1)[0].strip().lower() or mime
		raw = payload
	if mime == "image/jpg":
		mime = "image/jpeg"
	if mime not in _IMAGE_MIMES or len(raw) > 6_000_000:
		return None
	try:
		data = base64.b64decode(raw, validate=False)
	except Exception:
		return None
	if not data or len(data) > _IMAGE_BYTES:
		return None
	return data, mime


def _image_part(image: str | None):
	decoded = _decode_chat_image(image)
	if not decoded:
		return None
	data, mime = decoded
	try:
		from google.genai import types

		return types.Part.from_bytes(data=data, mime_type=mime)
	except Exception:
		return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode("ascii")}}


def answer_assistant(
	question: str,
	history: str = "",
	image: str | None = None,
	actor_id: int | None = None,
	pdf_data: dict | None = None,
) -> dict:
	"""Conversa do dashboard. Consulta o Postgres, agenda, grava conhecimento e avisa o grupo dos agentes."""
	question = _trim(question, MAX_INPUT_CHARS)
	history = _trim(history, MAX_HISTORY_CHARS)
	if image and _decode_chat_image(image) is None:
		raise CopilotError(
			"Não consegui ler essa imagem. Envie PNG, JPEG ou WebP de até 4 MB.",
			"validation",
			400,
		)
	if not question and image:
		question = "Analise o print de suporte enviado."
	if not question and pdf_data:
		question = f"Analise o PDF enviado ({pdf_data.get('filename') or 'documento.pdf'})."
	if not question:
		raise CopilotError("Informe um texto para o assistente.", "validation", 400)
	sources = hybrid_search(f"{question} {history[-3000:]}".strip())
	material = _source_context(sources) if sources else "(nada relevante na base interna)"
	prompt = f"PEDIDO:\n{question}\n\nCONVERSA:\n{history or '(início)'}\n\nMATERIAL INTERNO:\n{material}"
	if image:
		prompt += "\n\nO usuário anexou um print nesta mensagem. Leia o erro na imagem."
	if pdf_data:
		pdf_preview = str(pdf_data.get("markdown") or "")[:9000]
		prompt += (
			f"\n\nARQUIVO PDF ANEXADO: {pdf_data.get('filename')}\n"
			f"Páginas: {pdf_data.get('pages_count') or 1} | Imagens extraídas: {pdf_data.get('images_count') or 0}\n"
			f"CONTEÚDO TRANSCRITO DO PDF:\n{pdf_preview}"
		)
	notes: list[str] = []
	from .assistant_actions import (
		begin_group_send,
		begin_saved_article,
		last_saved_article,
		remember_chat_image,
		remember_chat_pdf,
	)

	remember_chat_image(_decode_chat_image(image) if image else None)
	remember_chat_pdf(pdf_data)
	begin_saved_article()
	begin_group_send()
	token = _assistant_actor.set(int(actor_id) if actor_id else None)
	try:
		try:
			draft = _converse_with_database(prompt, notes, image=image)
		except CopilotError as exc:
			if exc.code != "gemini_error":
				raise
			draft = ""
		if not draft:
			draft = _plain_assistant_draft(prompt, notes)
		if not draft:
			raise CopilotError("O assistente não devolveu uma resposta.", "invalid_response")
		result = {"draft": draft, "sources": []}
		saved = last_saved_article()
		if saved:
			result["saved_article"] = saved
		return result
	finally:
		remember_chat_image(None)
		remember_chat_pdf(None)
		_assistant_actor.reset(token)


def _plain_assistant_draft(prompt: str, notes: list[str]) -> str:
	extra = ""
	if notes:
		extra = "\n\nCONSULTAS JÁ FEITAS:\n" + "\n\n".join(notes)[:_DB_RESULT_CHARS]
	data = _generate(
		prompt + extra,
		_ASSISTANT_SYSTEM + " Responda no campo draft, em português, com a orientação para a equipe.",
		_ASSISTANT_SCHEMA,
		temperature=0.6,
	)
	return str(data.get("draft") or "").strip()


def _converse_with_database(prompt: str, notes: list[str] | None = None, image: str | None = None) -> str:
	parts: list[Any] = [{"text": prompt}]
	picture = _image_part(image)
	if picture is not None:
		parts.append(picture)
	contents: list[Any] = [{"role": "user", "parts": parts}]
	client = get_client()
	trace = notes if notes is not None else []
	for round_index in range(_DB_TOOL_ROUNDS + 1):
		config: dict[str, Any] = {
			"system_instruction": _ASSISTANT_SYSTEM,
			"temperature": 0.4,
			"max_output_tokens": 2048,
			"automatic_function_calling": {"disable": True},
		}
		if round_index < _DB_TOOL_ROUNDS:
			config["tools"] = _DB_TOOLS
		try:
			response = client.models.generate_content(
				model=generation_model(),
				contents=contents,
				config=config,
			)
		except GeminiConfigError as exc:
			raise CopilotError(str(exc), "gemini_config", 503) from exc
		except Exception as exc:
			raise CopilotError(f"Falha ao consultar o Gemini: {exc}") from exc
		calls = _function_calls(response)
		text = _draft_from_text(_assistant_text(response))
		if not calls or round_index >= _DB_TOOL_ROUNDS:
			return text
		contents.append(_model_content(response, text))
		parts = []
		for call in calls:
			name = _call_name(call)
			raw = _dispatch_database_tool(name, _tool_args(call))
			trace.append(f"{name}: {raw}")
			parts.append({"function_response": {"name": name, "response": _function_payload(raw)}})
		contents.append({"role": "user", "parts": parts})
	return ""


def suggest_reply(instruction: str, history: str) -> dict:
	query = instruction.strip() or "Sugira a próxima resposta adequada para esta conversa."
	query, history, sources = _prepare(query, history)
	data = _generate(
		f"INSTRUÇÃO:\n{query}\n\nCONVERSA:\n{history}\n\nFONTES:\n{_source_context(sources)}",
		(
			"Escreva apenas uma resposta profissional pronta para envio ao cliente, em português do Brasil. "
			"Seja cordial e breve, não afirme ações não realizadas e não exponha dados sensíveis. "
			"Use as fontes quando relevantes. Retorne JSON com draft."
		),
		{"type": "object", "properties": {"draft": {"type": "string"}}, "required": ["draft"]},
	)
	return {"draft": str(data.get("draft") or "").strip(), "sources": sources}


def improve_draft(text: str, history: str) -> dict:
	text, history, sources = _prepare(text, history)
	data = _generate(
		f"RASCUNHO:\n{text}\n\nCONVERSA:\n{history}\n\nFONTES:\n{_source_context(sources)}",
		(
			"Melhore clareza, gramática e tom profissional do rascunho sem mudar seu sentido nem inventar fatos. "
			"Não inclua credenciais ou dados pessoais. Retorne JSON com draft."
		),
		{"type": "object", "properties": {"draft": {"type": "string"}}, "required": ["draft"]},
	)
	return {"draft": str(data.get("draft") or "").strip(), "sources": sources}


def suggest_ticket(history: str, requester: str = "") -> dict:
	query, history, sources = _prepare("Estruture um ticket a partir da conversa.", history)
	schema = {
		"type": "object",
		"properties": {
			"ticket": {
				"type": "object",
				"properties": {
					"title": {"type": "string"},
					"description": {"type": "string"},
					"solicitante": {"type": "string"},
					"clientQuery": {"type": "string"},
				},
				"required": ["title", "description", "solicitante", "clientQuery"],
			}
		},
		"required": ["ticket"],
	}
	data = _generate(
		f"CONVERSA:\n{history}\n\nSOLICITANTE CONHECIDO:\n{_trim(requester, 200)}"
		f"\n\nFONTES:\n{_source_context(sources)}",
		(
			"Converta a conversa em um ticket técnico estruturado. Não invente cliente, solicitante, "
			"diagnóstico ou resolução. clientQuery deve resumir o pedido original para busca de cliente. "
			"Retorne somente o JSON solicitado."
		),
		schema,
	)
	ticket = data.get("ticket") if isinstance(data.get("ticket"), dict) else {}
	return {
		"ticket": {
			"title": str(ticket.get("title") or "")[:200],
			"description": str(ticket.get("description") or ""),
			"solicitante": str(ticket.get("solicitante") or requester or "")[:200],
			"clientQuery": str(ticket.get("clientQuery") or "")[:200],
		},
		"sources": sources,
	}
