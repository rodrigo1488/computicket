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
  const sources = (ctx.sources || [])
    .map((source, index) => {
      const title = source.title || "Fonte";
      return source.snippet ? `[${index + 1}] ${title}: ${source.snippet}` : `[${index + 1}] ${title}`;
    })
    .join("\n");
  const technicians = (ctx.technicians || [])
    .map(item => (item.name || "").trim())
    .filter(Boolean)
    .map(name => `- ${name}`)
    .join("\n");
  let block = `\n\nFONTES DA BASE DE CONHECIMENTO:\n${sources || "(nenhuma)"}`;
  if (ctx.has_evidence && ctx.draft) {
    block += `\n\nRESPOSTA PERMITIDA PARA PERGUNTA FACTUAL:\n${ctx.draft}`;
  }
  if (technicians) {
    block += `\n\nTÉCNICOS DA AGENDA:\n${technicians}`;
  }
  if (!ctx.has_evidence) {
    block += "\n\nSem fontes, não invente resposta factual. Transfira o atendimento.";
  } else {
    block += "\n\nResponda perguntas factuais somente com as fontes acima.";
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

/** Tira JSON, ação e chave solta que o modelo deixa na mensagem do cliente. */
export function sanitizeCustomerReply(text: string): string {
  let value = text || "";
  value = value.replace(/\[(?:AGENDA|AGENDAR|INTERNA)\][\s\S]*$/gi, "");
  value = value.replace(/Ação:\s*Transferir[\s\S]*$/gi, "");
  value = value.replace(/\{\s*"(?:title|action|appointment_date|tecnico|profissional)"[\s\S]*$/gi, "");
  const lines = value.split("\n").filter(line => !/^\s*[{}\[\],]+\s*$/.test(line));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function decideIdleAlert(input: {
  enabled: boolean;
  groupJid: string | null | undefined;
  idleMinutes: number;
  lastFromMe: boolean;
  lastMessageAt: Date | null;
  now: Date;
  alreadyAlerted: boolean;
  status: string;
}): boolean {
  if (!input.enabled || !input.groupJid) return false;
  if (input.status !== "pending") return false;
  if (input.lastFromMe || !input.lastMessageAt || input.alreadyAlerted) return false;
  const minutes = Number(input.idleMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  const ageMs = input.now.getTime() - input.lastMessageAt.getTime();
  return ageMs >= minutes * 60 * 1000;
}
