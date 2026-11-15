export type AgendaCommand = {
  title: string;
  appointment_date: string;
  tecnico?: string;
  user_id?: number;
  description?: string;
  cliente?: string;
  contact_number?: string;
};

export type OpenChatNotice = {
  target: string;
  text: string;
};

const FACTUAL_QUESTION =
  /(?:\?|(?:^|\s)(?:qual|quais|como|onde|quando|quanto|por\s?que|porque|o que|quem|cad[eê]|existe|funciona|valor|pre[cç]o|hor[aá]rio)\b)/i;

export function looksLikeFactualQuestion(text: string): boolean {
  return FACTUAL_QUESTION.test((text || "").trim());
}

const GREETING_WORDS = new Set([
  "oi", "ola", "hey", "opa", "e", "ai", "bom", "dia", "boa", "tarde", "noite",
  "tudo", "bem", "td"
]);

/** Cumprimento ou confirmação curta, ainda sem um pedido. */
export function messageIsOnlyGreeting(text: string): boolean {
  const value = foldName(text);
  if (!value) return true;
  const words = value.split(" ").filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every(word => GREETING_WORDS.has(word));
}

export function customerAskedForPerson(text: string): boolean {
  return /\b(?:falar com (?:um |uma )?(?:atendente|humano|pessoa|gente)|quero (?:falar com )?(?:um |uma )?(?:atendente|humano)|me (?:transfere|passa para|chama))\b/i.test(
    text || ""
  );
}

const PROBLEM_SIGNAL =
  /\b(?:erro|erros|falha|falhou|travou|travando|parou|caiu|lento|bug|problema|problemas|sistema|nota|notas|impressora|impressao|quebrou|acesso|senha|boleto|emissao|emite|emitir)\b|\bn[aã]o\b/i;

/** Mensagem curta que ainda não descreve um problema. */
export function messageLacksProblem(text: string): boolean {
  const value = (text || "").trim();
  if (!value) return true;
  if (PROBLEM_SIGNAL.test(value)) return false;
  return foldName(value).split(" ").filter(Boolean).length <= 8;
}

/** A resposta ainda espera a próxima mensagem do cliente. */
export function replyAsksTheCustomer(text: string): boolean {
  const body = (text || "").trim();
  if (!body) return false;
  if (body.includes("?")) return true;
  return /\b(?:me (?:conta|conte|diz|diga|fala|fale|informa|informe)|pode (?:me )?dizer|o que aconteceu)\b/i.test(body);
}

const CONFIRMATION = /^(?:sim|ok|certo|entendi|pode|isso|isso mesmo|foi isso|so isso|beleza|blz|valeu|obrigado|obrigada)$/;

/** Resposta curta à pergunta anterior. Essa fala já é a próxima interação. */
export function messageIsConfirmation(text: string): boolean {
  return CONFIRMATION.test(foldName(text));
}

/**
 * Não transfere neste turno quando o cliente ainda não pediu atendimento
 * ou a resposta faz uma pergunta e precisa esperar a próxima fala.
 */
export function shouldDeferCustomerTransfer(input: {
  userText: string;
  customerReply: string;
}): boolean {
  const userText = input.userText || "";
  const customerReply = input.customerReply || "";
  if (customerAskedForPerson(userText)) return false;
  if (replyAsksTheCustomer(customerReply)) return true;
  if (looksLikeFactualQuestion(userText)) return false;
  if (messageIsConfirmation(userText)) return false;
  return messageIsOnlyGreeting(userText) || messageLacksProblem(userText);
}

export function withoutTransferPromise(text: string): string {
  return (text || "")
    .replace(/[^.?\n]*\b(?:vou|iremos|vamos)\s+(?:te\s+|lhe\s+|você\s+)?(?:encaminhar|transferir|direcionar)\b[^.?\n]*[.!]?\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
      const cliente = String(data?.cliente || data?.client || data?.client_name || data?.empresa || "").trim();
      const contactNumber = String(data?.contact_number || data?.numero || data?.telefone || "").replace(/\D/g, "");
      const userId = Number(data?.user_id || data?.userId || 0);
      commands.push({
        title,
        appointment_date: appointmentDate,
        tecnico: tecnico || undefined,
        description: description || undefined,
        cliente: cliente || undefined,
        contact_number: contactNumber.length >= 10 ? contactNumber : undefined,
        user_id: Number.isFinite(userId) && userId > 0 ? userId : undefined
      });
    } catch {
      continue;
    }
  }
  return commands;
}

const APPOINTMENT_REQUEST =
  /\b(?:agende|agendar|agendamento|agendamentos|agenda|marcar\s+(?:uma\s+)?(?:visita|hor[aá]rio|compromisso)|colocar\s+na\s+agenda|coloca\s+na\s+agenda)\b/i;

const OPEN_CHAT_NOTICE =
  /\b(?:avisa|avise|avisar|avisem|comunica|comunique|comunicar|manda|mande|mandar|envia|envie|enviar|fala|fale|falar)\b[\s\S]{0,80}\b(?:chat|chats|atendimento|atendimentos|cliente|clientes|conversa|conversas)\b|\b(?:chats?|atendimentos?|conversas?)\s+abert[oa]s?\b/i;

/** Pedido de visita, para o grupo ou para o WhatsApp de um técnico. */
export function looksLikeAppointmentRequest(text: string): boolean {
  return APPOINTMENT_REQUEST.test(text || "");
}

/** Pedido do grupo para escrever em chats que já estão em atendimento. */
export function looksLikeOpenChatNotice(text: string): boolean {
  return OPEN_CHAT_NOTICE.test(text || "");
}

export function looksLikeStaffOperation(text: string): boolean {
  return looksLikeAppointmentRequest(text) || looksLikeOpenChatNotice(text);
}

const ATTENDANCE_CLOSURE =
  /\b(?:conclu[ií]d[oa]|conclu[ií]mos|concluir|encerre|encerrou|encerrado|encerrar|encerramos|finaliz\w*|resolvid[oa]|pode fechar|fechar o atendimento|j[aá]\s+(?:foi\s+)?atendid[oa]|foi atendid[oa])\b/i;

const NAME_SKIP = new Set(["da", "do", "de", "das", "dos", "a", "o", "os", "as", "um", "uma", "e"]);
const NAME_BREAK = new Set([
  "foi", "esta", "estao", "ja", "pode", "podem", "ser", "ter", "que", "com", "para", "por",
  "pelo", "pela", "esse", "essa", "este", "atendimento", "atendimentos", "cliente", "clientes",
  "conversa", "chamado", "concluido", "concluida", "obrigado", "obrigada", "parado", "parada"
]);

/** A equipe avisou que o atendimento de um cliente acabou, não que um aviso temporário expirou. */
export function looksLikeAttendanceClosure(text: string): boolean {
  const body = text || "";
  if (!ATTENDANCE_CLOSURE.test(body)) return false;
  if (/\bavisos?\b/i.test(body) && !/\batendimentos?\b/i.test(body)) return false;
  return /\b(?:atendimento|atendimentos|conversa|conversas|chamado|chamados|cliente|clientes)\b/i.test(body);
}

/** O texto citado é um alerta de atendimento parado enviado pelo agente. */
export function quotedLooksLikeIdleAlert(text: string): boolean {
  return /resumo do contexto|atendimento parado|est[aá] parado/i.test(text || "");
}

/** A pessoa respondeu uma mensagem do próprio agente, citando-a no WhatsApp. */
export function replyTargetsAgent(input: {
  quotedBody?: string | null;
  quotedParticipant?: string | null;
  phoneJids?: Array<string | null | undefined> | null;
  names?: Array<string | null | undefined> | null;
}): boolean {
  const participant = (input.quotedParticipant || "").trim();
  const phoneJids = (input.phoneJids || []).map(item => (item || "").trim()).filter(Boolean);
  if (participant && phoneJids.some(jid => sameWhatsAppIdentity(participant, jid))) return true;
  const body = (input.quotedBody || "").trim();
  if (!body) return false;
  if (quotedLooksLikeIdleAlert(body)) return true;
  return (input.names || []).some(name => {
    const token = (name || "").trim();
    return token.length >= 3 && body.includes(`*${token.toUpperCase()}*`);
  });
}

const QUOTED_ALERT_CLOSE =
  /\b(?:conclu[ií]d[oa]|conclu[ií]|resolvid[oa]|resolvi|encerre|encerrado|encerrar|pode encerrar|pode fechar|j[aá] (?:falei|atendi|resolvi|fechei)|foi atendid[oa]|pode deixar)\b/i;

/** Resposta curta a um alerta do agente, dizendo que o atendimento acabou. */
export function replyClosesQuotedAlert(quoted: string, reply: string): boolean {
  if (!quotedLooksLikeIdleAlert(quoted)) return false;
  return looksLikeAttendanceClosure(reply) || QUOTED_ALERT_CLOSE.test(reply || "");
}

function readPersonName(fragment: string, ignored: Set<string>): string {
  const words = (fragment || "").replace(/[.…,;:!?]+/g, " ").split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const folded = foldName(word);
    if (!folded || NAME_SKIP.has(folded)) continue;
    if (folded.length < 2 || NAME_BREAK.has(folded) || ignored.has(folded)) {
      if (kept.length) break;
      continue;
    }
    kept.push(word.replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, ""));
    if (kept.length === 3) break;
  }
  return kept.filter(Boolean).join(" ");
}

/** Nome do cliente na fala ou no resumo de contexto mais recente do grupo. */
export function attendanceCustomerName(
  message: string,
  agentLines: string[] = [],
  ignoredNames: Array<string | null | undefined> = []
): string {
  const ignored = new Set(
    ignoredNames.map(name => foldName(name || "")).filter(name => name.length >= 3)
  );
  const sources = [message, ...[...agentLines].reverse()];
  for (const source of sources) {
    const named =
      (source || "").match(/(?:atendimento|conversa|chamado)\s+d[aeo]s?\s+(.+)/i) ||
      (source || "").match(/\bcliente\s+(.+)/i);
    if (!named) continue;
    const name = readPersonName(named[1], ignored);
    if (name) return name;
  }
  for (const source of [...agentLines].reverse()) {
    const stripped = (source || "").replace(/^\*?resumo do contexto\*?\s*/i, "");
    const name = readPersonName(stripped, ignored);
    if (name) return name;
  }
  return "";
}

const ALL_OPEN_CHATS = new Set([
  "abertos",
  "aberto",
  "todos",
  "todas",
  "todos os chats",
  "todos os chats abertos",
  "chats abertos",
  "chat aberto",
  "atendimentos abertos",
  "conversas abertas"
]);

export function openChatNoticeReachesAll(target: string): boolean {
  return ALL_OPEN_CHATS.has(foldName(target));
}

export function parseOpenChatNotices(response: string): OpenChatNotice[] {
  const notices: OpenChatNotice[] = [];
  const regex = /\[AVISAR\]([\s\S]*?)\[\/AVISAR\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(response || "")) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      const text = String(data?.texto || data?.text || data?.mensagem || "").replace(/\s+/g, " ").trim().slice(0, 1000);
      const target = String(data?.destino || data?.target || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (text.length < 2 || !target) continue;
      notices.push({ target, text });
    } catch {
      continue;
    }
  }
  return notices;
}

export function selectOpenChats<T extends { name?: string | null; number?: string | null }>(
  chats: T[],
  target: string
): { matches: T[]; ambiguous: boolean } {
  if (openChatNoticeReachesAll(target)) return { matches: chats, ambiguous: false };
  const wanted = foldName(target);
  if (!wanted) return { matches: [], ambiguous: false };
  const exact = chats.filter(chat => foldName(chat.name || "") === wanted);
  if (exact.length === 1) return { matches: exact, ambiguous: false };
  if (exact.length > 1) return { matches: [], ambiguous: true };
  const first = wanted.split(" ")[0];
  if (first.length >= 3) {
    const byFirst = chats.filter(chat => foldName(chat.name || "").split(" ")[0] === first);
    if (byFirst.length === 1) return { matches: byFirst, ambiguous: false };
    if (byFirst.length > 1) return { matches: [], ambiguous: true };
    const contained = chats.filter(chat => foldName(chat.name || "").includes(wanted));
    if (contained.length === 1) return { matches: contained, ambiguous: false };
    if (contained.length > 1) return { matches: [], ambiguous: true };
  }
  const digits = (target || "").replace(/\D/g, "");
  const key = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (key.length >= 10) {
    const tail = key.slice(-11);
    const byPhone = chats.filter(chat => {
      const phone = (chat.number || "").replace(/\D/g, "");
      const phoneKey = phone.startsWith("55") && phone.length > 11 ? phone.slice(2) : phone;
      return phoneKey.length >= 10 && phoneKey.slice(-11) === tail;
    });
    if (byPhone.length === 1) return { matches: byPhone, ambiguous: false };
    if (byPhone.length > 1) return { matches: [], ambiguous: true };
  }
  return { matches: [], ambiguous: false };
}

export function staffGroupActionInstructions(input: {
  canSchedule: boolean;
  technicians: string[];
}): string {
  const people = input.technicians.map(name => name.trim()).filter(Boolean).join(", ") || "(nenhum)";
  let text = `\n\nAÇÕES DA EQUIPE NESTE GRUPO:
- Use um bloco só quando a mensagem pedir a ação.
- Para avisar chats abertos: [AVISAR]{"destino":"abertos","texto":"texto pedido pela equipe"}[/AVISAR]
- Para avisar um cliente que já está em atendimento, coloque o nome dele em destino.
- Não invente o texto do aviso e não use o bloco numa pergunta comum.`;
  if (input.canSchedule) {
    text += `
- Técnicos da agenda: ${people}.
- Para criar uma visita: [AGENDA]{"title":"Título","appointment_date":"YYYY-MM-DDTHH:mm:ss","tecnico":"Nome completo","cliente":"Nome da empresa","description":"Detalhe"}[/AGENDA]
- Sem cliente, data, horário e técnico, pergunte e não inclua o bloco. Não diga que a visita foi marcada sem o bloco.`;
  }
  return text;
}

export function staffAppointmentInstructions(technicians: string[], requesterName: string): string {
  const people = technicians.map(name => name.trim()).filter(Boolean).join(", ") || requesterName;
  return `Quem pediu é o técnico ${requesterName}, pelo WhatsApp vinculado a ele.
Técnicos da agenda: ${people}.
Se o técnico não for dito, use ${requesterName}.
Inclua [AGENDA]{"title":"Título","appointment_date":"YYYY-MM-DDTHH:mm:ss","tecnico":"Nome","cliente":"Nome da empresa","description":"Detalhe"}[/AGENDA] só quando cliente, data e horário estiverem claros.
Se faltar algo, pergunte só o que falta. Não diga que marcou sem o bloco. Não avise outros chats.`;
}

/** Relatório diário: da 18:30 até antes das 19:30, uma vez por dia. */
export function shouldSendDailyReport(input: {
  date: string;
  minuteOfDay: number;
  sentOn?: string | null;
}): boolean {
  if (!input.date || input.sentOn === input.date) return false;
  const minute = Number(input.minuteOfDay);
  if (!Number.isFinite(minute)) return false;
  return minute >= 18 * 60 + 30 && minute < 19 * 60 + 30;
}

export type DailyReportFacts = {
  dateLabel: string;
  pending: { name: string; status: string; assignee: string; wait: string }[];
  hiddenPending: number;
  dayCount: number;
  closedCount: number;
  samples: string[];
};

export function formatDailyReportFacts(facts: DailyReportFacts): string {
  const listed = facts.pending.length
    ? facts.pending
        .map(item => {
          const assignee = item.assignee || "sem responsável";
          return `- ${item.name} (${item.status}, ${assignee}). ${item.wait}`;
        })
        .join("\n")
    : "- Nenhuma.";
  const extra = facts.hiddenPending > 0 ? `\n- E mais ${facts.hiddenPending} atendimento(s).` : "";
  const samples = facts.samples.length
    ? facts.samples.map(line => `- ${line}`).join("\n")
    : "- Sem fala de cliente hoje.";
  return [
    `Data: ${facts.dateLabel}`,
    `Conversas com mensagem hoje: ${facts.dayCount}`,
    `Encerradas entre elas: ${facts.closedCount}`,
    `Pendências agora: ${facts.pending.length + facts.hiddenPending}`,
    "",
    "Pendências:",
    `${listed}${extra}`,
    "",
    "Últimas falas de clientes hoje:",
    samples
  ].join("\n");
}

export function formatDailyReportFallback(facts: DailyReportFacts): string {
  const totalPending = facts.pending.length + facts.hiddenPending;
  const lines = ["*Relatório das 18:30*", facts.dateLabel, "", "*Pendências*"];
  if (!totalPending) {
    lines.push("Não há atendimento pendente.");
  } else {
    for (const item of facts.pending) {
      const assignee = item.assignee || "ninguém";
      lines.push(`- ${item.name}: ${item.status}, responsável ${assignee}. ${item.wait}`);
    }
    if (facts.hiddenPending > 0) lines.push(`- E mais ${facts.hiddenPending}.`);
  }
  lines.push("", "*Conversas do dia*");
  if (!facts.dayCount) {
    lines.push("Não houve conversa hoje.");
  } else {
    lines.push(`${facts.dayCount} conversa(s) com mensagem hoje. ${facts.closedCount} já encerrada(s).`);
    if (facts.samples.length) {
      lines.push("Alguns assuntos ditos pelos clientes:");
      for (const sample of facts.samples.slice(0, 8)) lines.push(`- ${sample}`);
    }
  }
  return lines.join("\n");
}

export function dailyReportInstruction(): string {
  return `Escreva o relatório das 18:30 para o grupo interno.
Use somente o material. Não invente nome, número, problema ou volume.
Duas partes, nesta ordem:
*Pendências*
Quem ainda está em atendimento, o responsável e o que ficou em aberto. Se não houver, diga que não há pendência.
*Conversas do dia*
O volume, o que se repetiu nas falas e o que já foi encerrado. Agrupe. Não liste todos se forem muitos.
Frases curtas. Sem JSON e sem saudação.`;
}

export function dailyReportLooksUsable(text: string): boolean {
  const body = (text || "").trim();
  return body.length >= 40 && /pend[eê]n/i.test(body) && /convers/i.test(body);
}

export function withDailyReportHeading(text: string, dateLabel: string): string {
  const body = (text || "").trim();
  if (!body) return "";
  if (/relat[oó]rio das 18:30/i.test(body) || (dateLabel && body.includes(dateLabel))) return body;
  return `*Relatório das 18:30*\n${dateLabel}\n\n${body}`;
}

export function shouldForceKnowledgeHandoff(input: {
  answerFromKnowledge: boolean;
  hasEvidence: boolean;
  userText: string;
  alreadyTransferring: boolean;
  alreadyScheduling: boolean;
  waitingForCustomer?: boolean;
}): boolean {
  if (input.waitingForCustomer) return false;
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
  value = value.replace(/\[(?:AGENDA|AGENDAR|INTERNA|AVISAR)\][\s\S]*?\[\/(?:AGENDA|AGENDAR|INTERNA|AVISAR)\]/gi, "");
  value = value.replace(/\[(?:AGENDA|AGENDAR|INTERNA|AVISAR)\][\s\S]*$/gi, "");
  value = value.replace(/Ação:\s*Transferir[\s\S]*$/gi, "");
  value = value.replace(/\{\s*"(?:title|action|appointment_date|tecnico|profissional|cliente|destino)"[\s\S]*$/gi, "");
  const lines = value.split("\n").filter(line => !/^\s*[{}\[\],]+\s*$/.test(line));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const TRANSFER_RULES = `ENCAMINHAMENTO:
- Se o cliente só cumprimentou ou ainda não contou o problema, pergunte o que aconteceu e espere a próxima mensagem. Não transfira nesse turno.
- Se precisar de um dado que ele ainda não disse, faça uma pergunta e espere. Não transfira na mesma resposta em que houver pergunta.
- Quando o problema já estiver contado, reconheça e transfira. Não tente resolver problema técnico.
- Se ele pedir para falar com uma pessoa, transfira nesta resposta.
- Não faça mais de uma pergunta e não peça o que ele já disse.
- Não prometa prazo de atendimento.
- Ao transferir, diga apenas que vai encaminhar para um atendente.
- Para transferir, use somente: Ação: Transferir para o setor de atendimento [Fila: Nome da Fila]
- Não escreva essa ação enquanto ainda estiver esperando a resposta dele.
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
