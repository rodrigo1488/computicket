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
