import { Op, QueryTypes } from "sequelize";
import sequelize from "../../database";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Prompt from "../../models/Prompt";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { getWbot } from "../../libs/wbot";
import { toWhatsAppGroupJid } from "../../helpers/chatJid";
import { logger } from "../../utils/logger";
import { AIProviderSelector } from "./AIProviderSelector";
import {
  decideIdleScan,
  completeGroupFallback,
  formatGroupAlertSummary,
  formatIdleAlertContext,
  formatIdleTranscript,
  parseIdleAlertDecision,
  signAgentMessage,
  summaryLooksComplete
} from "./aiAgentActions";

type LastRow = {
  ticketId: number;
  id: string;
  fromMe: boolean;
  createdAt: Date;
  body: string | null;
};

let running = false;

const lastMessagesByTicket = async (ticketIds: number[]): Promise<Map<number, LastRow>> => {
  const found = new Map<number, LastRow>();
  if (!ticketIds.length) return found;
  const rows = await sequelize.query<LastRow>(
    `SELECT DISTINCT ON ("ticketId") "ticketId" AS "ticketId", id, "fromMe", "createdAt", body
     FROM "Messages"
     WHERE "ticketId" IN (:ticketIds)
       AND "isDeleted" = false
       AND ("isInternal" = false OR "isInternal" IS NULL)
     ORDER BY "ticketId", "createdAt" DESC`,
    { replacements: { ticketIds }, type: QueryTypes.SELECT }
  );
  for (const row of rows) found.set(Number(row.ticketId), row);
  return found;
};

const loadHistory = async (ticketId: number) => {
  const messages = await Message.findAll({
    where: {
      ticketId,
      isDeleted: false,
      [Op.or]: [{ isInternal: false }, { isInternal: null }]
    },
    attributes: ["id", "fromMe", "body", "createdAt"],
    order: [["createdAt", "DESC"]],
    limit: 40
  });
  return messages.reverse();
};

const minutesBetween = (from: Date | string | null | undefined, now: Date): number | null => {
  if (!from) return null;
  const at = new Date(from).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((now.getTime() - at) / 60000));
};

const buildContext = async (ticket: Ticket, now: Date): Promise<string> => {
  const history = await loadHistory(ticket.id);
  const lastCustomer = [...history].reverse().find(message => !message.fromMe);
  const lastAny = history[history.length - 1];
  return formatIdleAlertContext({
    contactName: ticket.contact?.name || "Cliente",
    ticketStatus: ticket.status,
    hasAssignee: !!ticket.userId,
    minutesSinceAny: minutesBetween(lastAny?.createdAt, now) ?? 0,
    minutesSinceCustomer: minutesBetween(lastCustomer?.createdAt, now),
    transcript: formatIdleTranscript(history)
  });
};

const askSilence = async (prompt: Prompt, ticket: Ticket, now: Date): Promise<boolean | null> => {
  try {
    const provider = await AIProviderSelector.getProvider(prompt.companyId, "summaries", prompt.provider);
    const context = await buildContext(ticket, now);
    const text = await provider.chat(
      [
        {
          role: "system",
          content:
            "Decida se um grupo interno deve ser avisado sobre uma conversa aberta e parada. " +
            "Avise só se alguém ficou sem retorno ou se um pedido ficou no meio. " +
            "Não avise se a conversa já encerrou, foi só um agradecimento ou não há pedido pendente. " +
            "Não invente. Retorne apenas JSON: {\"alertar\":true|false,\"resumo\":\"motivo em uma linha\"}."
        },
        { role: "user", content: context }
      ],
      { maxTokens: 1024, temperature: 0.2, thinking: false }
    );
    const decision = parseIdleAlertDecision(String(text || ""));
    if (!decision) return null;
    return decision.alert;
  } catch (err: any) {
    logger.warn(`AlertStaleConversations: interpretação indisponível no ticket ${ticket.id} (${err.message})`);
    return null;
  }
};

const summarizeForGroup = async (prompt: Prompt, ticket: Ticket, now: Date): Promise<string> => {
  const history = await loadHistory(ticket.id);
  const lastCustomer = [...history].reverse().find(message => !message.fromMe);
  const lastAny = history[history.length - 1];
  const context = formatIdleAlertContext({
    contactName: ticket.contact?.name || "Cliente",
    ticketStatus: ticket.status,
    hasAssignee: !!ticket.userId,
    minutesSinceAny: minutesBetween(lastAny?.createdAt, now) ?? 0,
    minutesSinceCustomer: minutesBetween(lastCustomer?.createdAt, now),
    transcript: formatIdleTranscript(history)
  });
  const fallback = completeGroupFallback({
    contactName: ticket.contact?.name || "Cliente",
    minutes: minutesBetween(lastCustomer?.createdAt, now),
    lastCustomerText: lastCustomer?.body || ""
  });
  try {
    const provider = await AIProviderSelector.getProvider(prompt.companyId, "summaries", prompt.provider);
    const text = await provider.chat(
      [
        {
          role: "system",
          content:
            "Escreva o alerta do grupo em português, em 2 a 4 frases completas, em tom grosso, rígido e ríspido, de cobrança. " +
            "Cobre quem está no grupo para assumir este atendimento agora. " +
            "Diga quem é o cliente, o que ele pediu e há quanto tempo está parado. " +
            "Use apenas o histórico. Não invente, não cumprimente, não peça desculpa, não escreva título e termine com ponto final."
        },
        { role: "user", content: context }
      ],
      { maxTokens: 1024, temperature: 0.2, thinking: false }
    );
    const summary = formatGroupAlertSummary(String(text || ""));
    return summaryLooksComplete(summary) ? summary : fallback;
  } catch (err: any) {
    logger.warn(`AlertStaleConversations: resumo indisponível no ticket ${ticket.id} (${err.message})`);
    return fallback;
  }
};

const remember = async (
  ticket: Ticket,
  groupAlertStatus: number | null,
  groupAlertMessageId: string | null
): Promise<boolean> => {
  const currentStatus = ticket.groupAlertStatus ?? null;
  const [affected] = await Ticket.update(
    { groupAlertStatus, groupAlertMessageId },
    {
      where: {
        id: ticket.id,
        groupAlertStatus: currentStatus === null ? { [Op.is]: null } : currentStatus,
        groupAlertMessageId: ticket.groupAlertMessageId
          ? ticket.groupAlertMessageId
          : { [Op.is]: null }
      },
      silent: true
    }
  );
  if (!affected) return false;
  ticket.groupAlertStatus = groupAlertStatus;
  ticket.groupAlertMessageId = groupAlertMessageId;
  return true;
};

const scanPrompt = async (prompt: Prompt, now: Date): Promise<void> => {
  const queues = await Queue.findAll({
    where: { promptId: prompt.id, companyId: prompt.companyId },
    attributes: ["id"]
  });
  const queueIds = queues.map(queue => queue.id);
  if (prompt.queueId && !queueIds.includes(prompt.queueId)) queueIds.push(prompt.queueId);
  const connections = await Whatsapp.findAll({
    where: { promptId: prompt.id, companyId: prompt.companyId },
    attributes: ["id"]
  });
  const whatsappIds = connections.map(item => item.id);
  const scopes: any[] = [];
  if (queueIds.length) scopes.push({ queueId: { [Op.in]: queueIds } });
  if (whatsappIds.length) scopes.push({ whatsappId: { [Op.in]: whatsappIds } });
  if (!scopes.length) return;

  await Ticket.update(
    { groupAlertStatus: null, groupAlertMessageId: null },
    {
      where: {
        companyId: prompt.companyId,
        [Op.or]: scopes,
        groupAlertStatus: { [Op.not]: null },
        status: { [Op.notIn]: ["pending", "open"] }
      },
      silent: true
    }
  );

  const tickets = await Ticket.findAll({
    where: {
      companyId: prompt.companyId,
      [Op.or]: scopes,
      status: { [Op.in]: ["pending", "open"] },
      isGroup: false
    },
    include: [{ model: Contact, as: "contact", attributes: ["id", "name", "number", "isSupport"] }]
  });
  const lasts = await lastMessagesByTicket(tickets.map(ticket => ticket.id));

  for (const ticket of tickets) {
    if (ticket.contact?.isSupport) {
      if (ticket.groupAlertStatus != null) await remember(ticket, null, null);
      continue;
    }
    const last = lasts.get(ticket.id);
    const decision = decideIdleScan({
      ticketStatus: ticket.status,
      groupAlertStatus: ticket.groupAlertStatus ?? null,
      groupAlertMessageId: ticket.groupAlertMessageId || null,
      lastMessageId: last?.id || null,
      lastFromMe: !!last?.fromMe,
      lastMessageAt: last?.createdAt ? new Date(last.createdAt) : null,
      idleMinutes: prompt.idleAlertMinutes || 30,
      now
    });
    if (decision.action === "clear") {
      await remember(ticket, null, null);
      continue;
    }
    if (decision.action === "queue" || decision.action === "ask") {
      if (ticket.groupAlertStatus != null && ticket.groupAlertMessageId !== decision.messageId) {
        const cleared = await remember(ticket, null, null);
        if (!cleared) continue;
      }
      await remember(ticket, 0, decision.messageId);
    }
  }
};

const settleClaim = async (ticketId: number, groupAlertStatus: number): Promise<void> => {
  await Ticket.update(
    { groupAlertStatus },
    { where: { id: ticketId, groupAlertStatus: 3 }, silent: true }
  );
};

const dispatchQueued = async (now: Date): Promise<void> => {
  await Ticket.update(
    { groupAlertStatus: 0 },
    { where: { groupAlertStatus: 3 }, silent: true }
  );
  const prompts = await Prompt.findAll({ where: { idleAlertEnabled: true } });
  const promptById = new Map(prompts.map(prompt => [prompt.id, prompt]));
  const ticket = await Ticket.findOne({
    where: {
      groupAlertStatus: 0,
      isGroup: false,
      status: { [Op.in]: ["pending", "open"] }
    },
    order: [["updatedAt", "ASC"], ["id", "ASC"]],
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name", "isSupport"] },
      { model: Whatsapp, as: "whatsapp", attributes: ["id", "promptId"], required: false },
      { model: Queue, as: "queue", attributes: ["id", "promptId"], required: false }
    ]
  });
  if (!ticket) return;

  const prompt = promptById.get(ticket.queue?.promptId) || promptById.get(ticket.whatsapp?.promptId);
  if (!prompt?.idleAlertGroupJid || !ticket.whatsappId || ticket.contact?.isSupport) {
    await remember(ticket, null, null);
    return;
  }
  const claimed = await Ticket.update(
    { groupAlertStatus: 3 },
    { where: { id: ticket.id, groupAlertStatus: 0 }, silent: true }
  );
  if (!claimed[0]) return;
  ticket.groupAlertStatus = 3;

  const last = await Message.findOne({
    where: {
      ticketId: ticket.id,
      isDeleted: false,
      [Op.or]: [{ isInternal: false }, { isInternal: null }]
    },
    attributes: ["id", "fromMe"],
    order: [["createdAt", "DESC"]]
  });
  if (!last || last.id !== ticket.groupAlertMessageId) {
    await Ticket.update(
      { groupAlertStatus: null, groupAlertMessageId: null },
      { where: { id: ticket.id, groupAlertStatus: 3 }, silent: true }
    );
    return;
  }

  if (last.fromMe) {
    const alert = await askSilence(prompt, ticket, now);
    if (alert === null) {
      await settleClaim(ticket.id, 0);
      return;
    }
    if (!alert) {
      await settleClaim(ticket.id, 2);
      return;
    }
  }

  let sent = false;
  try {
    const summary = await summarizeForGroup(prompt, ticket, now);
    const body = signAgentMessage(summary, prompt.name);
    if (!body) throw new Error("resumo vazio");
    const wbot = getWbot(ticket.whatsappId);
    await wbot.sendMessage(toWhatsAppGroupJid(prompt.idleAlertGroupJid), { text: body });
    sent = true;
    await settleClaim(ticket.id, 1);
    logger.info(`Alerta de silêncio enviado para o ticket ${ticket.id}`);
  } catch (err: any) {
    if (sent) {
      await settleClaim(ticket.id, 1);
    } else {
      await settleClaim(ticket.id, 0);
    }
    logger.error(`AlertStaleConversations: falha no ticket ${ticket.id}: ${err.message}`);
  }
};

const AlertStaleConversationsService = async (): Promise<void> => {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const prompts = await Prompt.findAll({ where: { idleAlertEnabled: true } });
    for (const prompt of prompts) {
      if (!prompt.idleAlertGroupJid) continue;
      await scanPrompt(prompt, now);
    }
    await dispatchQueued(now);
  } finally {
    running = false;
  }
};

export default AlertStaleConversationsService;
