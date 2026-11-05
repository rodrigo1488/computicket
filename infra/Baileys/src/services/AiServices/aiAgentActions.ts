export type AgendaCommand = {
  title: string;
  appointment_date: string;
  tecnico?: string;
  user_id?: number;
  description?: string;
};

const FACTUAL_QUESTION =
  /(?:\?|(?:^|\s)(?:qual|quais|como|onde|quando|quanto|por\s?que|porque|o que|quem|cad[eê]|existe|funciona|valor|pre[cç]o|hor[aá]rio)\b)/i;

export function looksLikeFactualQuestion(text: string): boolean {
  return FACTUAL_QUESTION.test((text || "").trim());
}

export function foldName(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const jidParts = (value: string): { user: string; domain: string; digits: string } => {
  const raw = (value || "").trim().toLowerCase();
  const [left, domain = ""] = raw.split("@");
  const user = (left || "").split(":")[0];
  return { user, domain, digits: user.replace(/\D/g, "") };
};

const sameWhatsAppIdentity = (left: string, right: string): boolean => {
  const a = jidParts(left);
  const b = jidParts(right);
  if (!a.user || !b.user) return false;
  if (a.user === b.user && (!a.domain || !b.domain || a.domain === b.domain)) return true;
  return a.digits.length >= 8 && a.digits === b.digits;
};

const textHasLinkedPhone = (body: string, phoneJids: string[]): boolean => {
  const bodyDigits = (body || "").replace(/\D/g, "");
  if (bodyDigits.length < 10) return false;
  return phoneJids.some(jid => {
    const phone = jidParts(jid).digits;
    if (phone.length < 10) return false;
    const national = phone.startsWith("55") && phone.length > 11 ? phone.slice(2) : phone;
    return bodyDigits.includes(phone) || (national.length >= 10 && bodyDigits.includes(national));
  });
};

const textHasLinkedName = (body: string, names: string[]): boolean => {
  const foldedBody = ` ${foldName(body)} `;
  return names.some(name => {
    const folded = foldName(name || "");
    return folded.length >= 3 && foldedBody.includes(` ${folded} `);
  });
};

/** A mensagem cita o nome ou o número do WhatsApp vinculado ao agente. */
export function groupMessageAddressesAgent(input: {
  body?: string | null;
  mentionedJids?: Array<string | null | undefined> | null;
  names?: Array<string | null | undefined> | null;
  phoneJids?: Array<string | null | undefined> | null;
}): boolean {
  const phoneJids = (input.phoneJids || []).map(item => (item || "").trim()).filter(Boolean);
  const mentioned = (input.mentionedJids || []).map(item => (item || "").trim()).filter(Boolean);
  if (mentioned.some(jid => phoneJids.some(identity => sameWhatsAppIdentity(jid, identity)))) {
    return true;
  }
  const body = input.body || "";
  if (textHasLinkedPhone(body, phoneJids)) return true;
  return textHasLinkedName(body, (input.names || []).map(item => item || ""));
}

const NOTICE_STOPWORDS = new Set([
  "hoje", "amanha", "semana", "aviso", "avisos", "fora", "esta", "estao",
  "voltou", "voltar", "pode", "podem", "esquecer", "encerra", "encerrar",
  "anota", "anote", "cliente", "clientes", "sistema"
]);

/** Fim do dia pedido, no horário de Brasília. 0 = hoje, 1 = amanhã, outro = fim da semana. */
export function temporaryNoticeExpiry(days: number, now = new Date()): Date {
  const extra = days <= 0 ? 0 : days === 1 ? 1 : 6;
  const wall = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const endUtc = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + extra,
    23,
    59,
    59
  );
  return new Date(endUtc + 3 * 60 * 60 * 1000);
}

export function parseTemporaryNotice(raw: string): { action: "guardar" | "encerrar" | "responder"; text: string; days: number } | null {
  const match = (raw || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    const action = String(data?.acao || data?.action || "").trim().toLowerCase();
    if (action !== "guardar" && action !== "encerrar" && action !== "responder") return null;
    const text = String(data?.texto || data?.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const validade = String(data?.validade || "hoje").trim().toLowerCase();
    const days = validade.startsWith("semana") ? 6 : validade.startsWith("amanh") ? 1 : 0;
    if (action !== "responder" && text.length < 5) return null;
    return { action, text, days };
  } catch {
    return null;
  }
}

export function noticeSubjectMatches(body: string, subject: string): boolean {
  const foldedBody = foldName(body);
  const words = foldName(subject).split(" ").filter(word => word.length >= 4 && !NOTICE_STOPWORDS.has(word));
  return words.some(word => foldedBody.includes(word));
}

export function noticeTextFromMention(body: string, names: Array<string | null | undefined> = []): string {
  let text = body || "";
  for (const name of names) {
    const folded = (name || "").trim();
    if (folded.length < 3) continue;
    const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`@?${escaped}`, "ig"), " ");
  }
  return text.replace(/@\S+/g, " ").replace(/^[\s,.:;-]+/, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function formatTemporaryNotices(notes: { body?: string | null }[]): string {
  const lines = (notes || []).map(note => (note.body || "").trim()).filter(Boolean);
  if (!lines.length) return "";
  return `\n\nAVISOS TEMPORÁRIOS DA EQUIPE:\n${lines.map(line => `- ${line}`).join("\n")}\nUse um aviso somente se o assunto do cliente tiver relação com ele. Repita só o que está escrito, sem ampliar. Se não tiver relação, não mencione. O aviso não substitui o encaminhamento quando o caso for técnico.`;
}

export function matchPersonByName<T extends { name?: string | null }>(
  people: T[],
  requested: string
): T | undefined {
  const wanted = foldName(requested);
  if (!wanted) return undefined;
  const exact = people.find(person => foldName(person.name || "") === wanted);
  if (exact) return exact;
  const first = wanted.split(" ")[0];
  if (first.length < 3) return undefined;
  const byFirst = people.filter(person => foldName(person.name || "").split(" ")[0] === first);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

export function parseUserTransferName(response: string): string | null {
  if (!/Ação:\s*Transferir para o atendente/i.test(response || "")) return null;
  const match = (response || "").match(/\[Usuário:\s*([^\]]+)\]/i);
  return match ? match[1].trim() : "";
}

export function parseAgendaCommands(response: string): AgendaCommand[] {
  const commands: AgendaCommand[] = [];
  const regex = /\[AGENDA\]([\s\S]*?)\[\/AGENDA\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(response || "")) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      const title = String(data?.title || "").trim();
      const appointmentDate = String(data?.appointment_date || data?.data || "").trim();
      if (!title || !appointmentDate) continue;
      const tecnico = String(data?.tecnico || data?.profissional || "").trim();
      const description = String(data?.description || data?.descricao || "").trim();
      const userId = Number(data?.user_id || data?.userId || 0);
      commands.push({
        title,
        appointment_date: appointmentDate,
        tecnico: tecnico || undefined,
        description: description || undefined,
        user_id: Number.isFinite(userId) && userId > 0 ? userId : undefined
      });
    } catch {
      continue;
    }
  }
  return commands;
}

export function shouldForceKnowledgeHandoff(input: {
  answerFromKnowledge: boolean;
  hasEvidence: boolean;
  userText: string;
  alreadyTransferring: boolean;
  alreadyScheduling: boolean;
}): boolean {
  if (!input.answerFromKnowledge || input.hasEvidence) return false;
  if (input.alreadyTransferring || input.alreadyScheduling) return false;
  return looksLikeFactualQuestion(input.userText);
}

export function formatAgentContext(ctx: {
  has_evidence?: boolean;
  draft?: string;
  sources?: { title?: string; snippet?: string }[];
  technicians?: { name?: string }[];
}): string {
  const people = (ctx.technicians || [])
    .map(item => (item.name || "").trim())
    .filter(Boolean)
    .map(name => `- ${name}`)
    .join("\n");
  const sources = (ctx.sources || [])
    .map((source, index) => {
      const title = source.title || "Fonte";
      return source.snippet ? `[${index + 1}] ${title}: ${source.snippet}` : `[${index + 1}] ${title}`;
    })
    .join("\n");
  let block = `\n\nPESSOAS COM QUEM O CLIENTE PODE FALAR:\n${people || "(nenhuma)"}\nEstas pessoas existem. Se o cliente pedir uma delas, transfira para o nome completo da lista. Compare pelo primeiro nome, sem acento. Não diga que a pessoa não existe.`;
  block += `\n\nFONTES DA BASE DE CONHECIMENTO:\n${sources || "(nenhuma)"}`;
  if (ctx.has_evidence && ctx.draft) {
    block += `\n\nRESPOSTA PERMITIDA PARA PERGUNTA FACTUAL:\n${ctx.draft}`;
  }
  if (!ctx.has_evidence) {
    block += "\n\nSem fontes, não invente resposta factual. Transfira o atendimento.";
  } else {
    block += "\n\nResponda perguntas factuais somente com as fontes acima. Não cite número de ticket, ID nem o título interno da fonte.";
  }
  return block;
}

const GEMINI_CONTEXT_TOKENS = 1_048_576;
const GEMINI_COMPLETION_FLOOR = 8192;

/** Orçamento de saída. O Gemini não usa a janela curta do LM Studio. */
export function completionTokenBudget(
  provider: string | undefined,
  requested: number,
  payload: unknown
): number {
  const isGemini = (provider || "").toLowerCase() === "gemini";
  const estimated = Math.ceil(JSON.stringify(payload ?? "").length / 3.2);
  if (!isGemini) {
    const ctxWindow = 4096;
    const safeMax = Math.max(64, ctxWindow - estimated - 128);
    return Math.min(Math.max(requested || 0, 512), safeMax);
  }
  const safeMax = Math.max(1024, GEMINI_CONTEXT_TOKENS - estimated - 2048);
  return Math.min(Math.max(requested || 0, GEMINI_COMPLETION_FLOOR), safeMax);
}

export function splitWhatsAppText(text: string, limit = 3500): string[] {
  const value = (text || "").trim();
  if (!value) return [];
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let rest = value;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit);
    if (cut < 1) cut = limit;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const TEXT_MESSAGE_TYPES = new Set([
  "conversation",
  "extendedTextMessage",
  "chat",
  "ephemeralMessage"
]);

export function conversationTurns(
  messages: { fromMe?: boolean; body?: string | null; mediaType?: string | null; isInternal?: boolean }[],
  currentUserText: string
): { role: "user" | "assistant"; content: string }[] {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of messages) {
    if (message.isInternal) continue;
    const body = (message.body || "").replace(/\u200e/g, "").trim();
    if (!body) continue;
    const type = message.mediaType || "conversation";
    if (!TEXT_MESSAGE_TYPES.has(type)) continue;
    turns.push({ role: message.fromMe ? "assistant" as const : "user" as const, content: body });
  }
  const current = (currentUserText || "").replace(/\u200e/g, "").trim();
  const last = turns[turns.length - 1];
  if (current && !(last?.role === "user" && last.content === current)) {
    turns.push({ role: "user", content: current });
  }
  return turns;
}

/** Assinatura no mesmo formato do atendente: *NOME* e o texto em seguida. */
export function signAgentMessage(text: string, name?: string | null): string {
  const agent = (name || "").trim();
  let body = (text || "").replace(/\u200e/g, "").trim();
  if (!body) return "";
  if (!agent) return body;
  const escaped = agent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  body = body.replace(new RegExp(`^(?:\\*${escaped}\\*|${escaped})\\s*[:\\-–]?\\s*`, "i"), "").trim();
  if (!body) return "";
  const signature = `*${agent.toUpperCase()}*`;
  return `${signature}\n${body}`;
}

const INTERNAL_TRANSFER_HEADING =
  /(?:^|\n)\s*(?:-{3,}\s*\n\s*)?\*{0,2}\s*Mensagem Interna[^\n]*\*{0,2}\s*(?:\n|$)/i;

/** Separa a orientação do cliente da nota de transferência que o modelo escreveu. */
export function splitCustomerAndInternalNote(text: string): { customer: string; internalNote: string } {
  const source = text || "";
  const match = INTERNAL_TRANSFER_HEADING.exec(source);
  if (!match || match.index == null) {
    return { customer: source.trim(), internalNote: "" };
  }
  return {
    customer: source.slice(0, match.index).trim(),
    internalNote: source.slice(match.index).replace(/^\s*-{3,}\s*/, "").trim()
  };
}

export function parseRecommendedQueueName(note: string): string | null {
  const match = (note || "").match(/Setor Recomendado:\*?\s*(.+)/i);
  if (!match) return null;
  const first = match[1].split(/\s+ou\s+/i)[0] || "";
  const name = first.replace(/\(ID:\s*\d+\)/gi, "").replace(/\*/g, "").trim();
  return name || null;
}

export function stripInternalCitations(text: string): string {
  return (text || "")
    .replace(/\s*\(segundo (?:o |a )?(?:ticket|artigo)[^)]*\)/gi, "")
    .replace(/\s+segundo (?:o |a )?(?:ticket|artigo)\s+#?\d+[^\n.]*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

/** Tira JSON, ação e chave solta que o modelo deixa na mensagem do cliente. */
export function sanitizeCustomerReply(text: string): string {
  let value = splitCustomerAndInternalNote(text).customer;
  value = stripInternalCitations(value);
  value = value.replace(/\[(?:AGENDA|AGENDAR|INTERNA)\][\s\S]*$/gi, "");
  value = value.replace(/Ação:\s*Transferir[\s\S]*$/gi, "");
  value = value.replace(/\{\s*"(?:title|action|appointment_date|tecnico|profissional)"[\s\S]*$/gi, "");
  const lines = value.split("\n").filter(line => !/^\s*[{}\[\],]+\s*$/.test(line));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const TRANSFER_RULES = `ENCAMINHAMENTO:
- Nunca tente solucionar problema técnico. Reconheça o relato e transfira.
- Nunca invente informações.
- Não faça perguntas desnecessárias e não peça o que o cliente já disse.
- Não prometa prazo de atendimento.
- Se não identificar o setor, transfira para atendimento humano.
- Não conte ao cliente a triagem, o setor interno nem o conteúdo da nota.
- Ao cliente, diga apenas que vai encaminhar para um atendente.
- Para transferir, use somente: Ação: Transferir para o setor de atendimento [Fila: Nome da Fila]
A nota interna é gravada pela plataforma. Não escreva mensagem interna na resposta.`;

export type TransferBrief = {
  cliente: string;
  sistema: string;
  problema: string;
  erros: string;
  resumo: string;
  motivo: string;
  setor: string;
  solucao?: string;
  diagnostico?: string;
  procedimentos?: string;
  pendencias?: string;
  proximaAcao?: string;
};

const briefValue = (value: string | undefined): string => {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text || "Não informado";
};

/** Solução só entra na nota quando já existe. Vazio, "não informado" e texto inventado de ausência ficam de fora. */
export function statedSolution(value: string | undefined): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text || /^(não informado|nenhuma|sem solução|n\/a)$/i.test(text)) return "";
  return text;
}

/** Nota interna do encaminhamento, sem o histórico. A solução só aparece quando houver. */
export function formatTransferNote(brief: TransferBrief): string {
  const lines = [
    "*Mensagem Interna de Transferência*",
    `- *Cliente:* ${briefValue(brief.cliente)}`,
    `- *Sistema/Serviço:* ${briefValue(brief.sistema)}`,
    `- *Problema relatado:* ${briefValue(brief.problema)}`,
    `- *Mensagens de erro:* ${briefValue(brief.erros)}`,
    `- *Resumo:* ${briefValue(brief.resumo)}`,
    `- *Motivo do encaminhamento:* ${briefValue(brief.motivo)}`,
    `- *Setor recomendado:* ${briefValue(brief.setor)}`
  ];
  const solution = statedSolution(brief.solucao);
  if (solution) lines.push(`- *Solução:* ${solution}`);
  const extra: Array<[string, string | undefined]> = [
    ["Diagnóstico", brief.diagnostico],
    ["Procedimentos", brief.procedimentos],
    ["Pendências", brief.pendencias],
    ["Próxima ação", brief.proximaAcao]
  ];
  for (const [label, value] of extra) {
    const text = statedSolution(value);
    if (text) lines.push(`- *${label}:* ${text}`);
  }
  return lines.join("\n").trim();
}

const OPEN_TICKET_STATUSES = new Set(["pending", "open"]);

export type IdleScanAction =
  | { action: "none" }
  | { action: "clear" }
  | { action: "queue"; messageId: string }
  | { action: "ask"; messageId: string };

/** Marca 0, pede interpretação ou limpa o status. Não chama a IA. */
export function decideIdleScan(input: {
  ticketStatus: string;
  groupAlertStatus: number | null;
  groupAlertMessageId: string | null;
  lastMessageId: string | null;
  lastFromMe: boolean;
  lastMessageAt: Date | null;
  idleMinutes: number;
  now: Date;
}): IdleScanAction {
  const status = input.groupAlertStatus ?? null;
  const flagged = status !== null;
  if (!OPEN_TICKET_STATUSES.has(input.ticketStatus)) {
    return flagged ? { action: "clear" } : { action: "none" };
  }
  const minutes = Number(input.idleMinutes);
  if (!input.lastMessageId || !input.lastMessageAt || !Number.isFinite(minutes) || minutes <= 0) {
    return flagged ? { action: "clear" } : { action: "none" };
  }
  const sameMessage = input.groupAlertMessageId === input.lastMessageId;
  const idle = input.now.getTime() - input.lastMessageAt.getTime() >= minutes * 60 * 1000;
  if (status === 3) return { action: "none" };

  if (input.lastFromMe) {
    if (sameMessage && (status === 0 || status === 1 || status === 2)) return { action: "none" };
    if (!idle) return flagged ? { action: "clear" } : { action: "none" };
    return { action: "ask", messageId: input.lastMessageId };
  }

  if (!idle) {
    return !sameMessage && flagged ? { action: "clear" } : { action: "none" };
  }
  if (status === null || !sameMessage) return { action: "queue", messageId: input.lastMessageId };
  return { action: "none" };
}

export function parseIdleAlertDecision(text: string): { alert: boolean; summary: string } | null {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    if (typeof data?.alertar !== "boolean") return null;
    return { alert: data.alertar, summary: String(data.resumo || "").trim() };
  } catch {
    return null;
  }
}

export function summaryLooksComplete(text: string): boolean {
  const body = text.replace(/^\*Resumo do contexto\*\s*/i, "").trim();
  return body.length >= 40 && /[.!?…]$/.test(body);
}

/** Resumo inteiro, cortando só em espaço quando a última fala é longa. */
export function completeGroupFallback(input: {
  contactName: string;
  assigneeName?: string | null;
  minutes: number | null;
  lastCustomerText: string;
}): string {
  const name = (input.contactName || "Cliente").trim() || "Cliente";
  const assignee = (input.assigneeName || "").trim();
  const wait = input.minutes == null ? "" : ` Há ${input.minutes} min sem resposta.`;
  let said = (input.lastCustomerText || "").replace(/\s+/g, " ").trim();
  if (said.length > 400) {
    const cut = said.lastIndexOf(" ", 400);
    said = said.slice(0, cut > 120 ? cut : 400).trim();
  }
  if (said && !/[.!?…]$/.test(said)) said = `${said}.`;
  const quote = said ? ` Última fala do cliente: ${said}` : "";
  const charge = assignee
    ? ` Responsável: ${assignee}. ${assignee}, pode retomar este atendimento.`
    : " Responsável: ninguém. Alguém do grupo pode assumir.";
  return `*Resumo do contexto*\n${name} está parado.${wait}${charge}${quote}`;
}

/** Garante o nome de quem responde o atendimento, mesmo se o modelo omitir. */
export function ensureResponsibleLine(summary: string, assigneeName?: string | null): string {
  const name = (assigneeName || "").trim();
  const body = summary.replace(/^\*Resumo do contexto\*\s*/i, "");
  if (name && body.toLowerCase().includes(name.toLowerCase())) return summary;
  if (!name && /responsável:\s*ninguém/i.test(body)) return summary;
  const line = name ? `Responsável: ${name}.` : "Responsável: ninguém.";
  return `${summary.trim()}\n${line}`;
}

/** Texto do grupo: um resumo curto do contexto, sem JSON nem título repetido. */
export function formatGroupAlertSummary(text: string): string {
  const raw = String(text || "").trim();
  let summary = raw;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(raw.slice(start, end + 1));
      if (typeof data?.resumo === "string" && data.resumo.trim()) summary = data.resumo.trim();
    } catch {
      summary = raw;
    }
  }
  summary = summary
    .replace(/^\*{0,2}\s*resumo(?:\s+do\s+contexto)?\s*\*{0,2}\s*[:\-–]?\s*/i, "")
    .trim();
  if (!summary) return "";
  return `*Resumo do contexto*\n${summary}`;
}

export function formatIdleTranscript(
  messages: { fromMe?: boolean; body?: string | null }[]
): string {
  return messages
    .map(message => {
      const who = message.fromMe ? "Atendente" : "Cliente";
      const body = (message.body || "[Mídia]").replace(/\s+/g, " ").trim().slice(0, 500) || "[Mídia]";
      return `${who}: ${body}`;
    })
    .join("\n");
}

export function formatIdleAlertContext(input: {
  contactName: string;
  ticketStatus: string;
  assigneeName?: string | null;
  minutesSinceAny: number;
  minutesSinceCustomer: number | null;
  transcript: string;
}): string {
  const sinceCustomer = input.minutesSinceCustomer == null
    ? "o cliente não falou"
    : `${input.minutesSinceCustomer} min`;
  const assignee = (input.assigneeName || "").trim() || "ninguém";
  return [
    `Cliente: ${input.contactName}`,
    `Status do atendimento: ${input.ticketStatus}`,
    `Responsável pela conversa: ${assignee}`,
    `Minutos sem nenhuma mensagem: ${input.minutesSinceAny}`,
    `Minutos desde a última fala do cliente: ${sinceCustomer}`,
    "",
    "Histórico:",
    input.transcript || "Sem mensagens."
  ].join("\n");
}
