import { Op, QueryTypes } from "sequelize";
import sequelize from "../../database";
import { getBrazilClock, getBrazilDayBounds } from "../../helpers/BrazilTimezone";
import { toWhatsAppGroupJid } from "../../helpers/chatJid";
import { getWbot } from "../../libs/wbot";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Prompt from "../../models/Prompt";
import Ticket from "../../models/Ticket";
import User from "../../models/User";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { AIProviderSelector } from "./AIProviderSelector";
import {
  dailyReportInstruction,
  dailyReportLooksUsable,
  formatDailyReportFacts,
  formatDailyReportFallback,
  sanitizeCustomerReply,
  shouldSendDailyReport,
  signAgentMessage,
  splitWhatsAppText,
  withDailyReportHeading,
  type DailyReportFacts
} from "./aiAgentActions";

const PENDING_STATUSES = ["open", "pending", "rating"];
const LIST_LIMIT = 25;
const SAMPLE_LIMIT = 12;

type DayCounts = { dayCount: number; closedCount: number };
type LastRow = { ticketId: number; createdAt: Date };

let running = false;

const clip = (text: string, max = 140): string => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.lastIndexOf(" ", max);
  return `${clean.slice(0, cut > 40 ? cut : max).trim()}…`;
};

const dateLabelOf = (isoDate: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!match) return isoDate || "";
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const statusLabel = (status: string): string => {
  if (status === "open") return "em atendimento";
  if (status === "rating") return "em avaliação";
  return "na fila";
};

const waitLabel = (lastAt: Date | null, now: Date): string => {
  if (!lastAt) return "Sem mensagem recente.";
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(lastAt).getTime()) / 60000));
  if (minutes < 60) return `Última mensagem há ${minutes} min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Última mensagem há ${hours} h.`;
  return `Última mensagem há ${Math.round(hours / 24)} dia(s).`;
};

const pendingWhere = (companyId: number, whatsappIds: number[]) => ({
  companyId,
  whatsappId: { [Op.in]: whatsappIds },
  isGroup: false,
  status: { [Op.in]: PENDING_STATUSES },
  [Op.or]: [{ isSupport: false }, { isSupport: null }]
});

const dayCounts = async (
  companyId: number,
  whatsappIds: number[],
  start: Date,
  end: Date
): Promise<DayCounts> => {
  const rows = await sequelize.query<DayCounts>(
    `SELECT
       COUNT(DISTINCT m."ticketId")::int AS "dayCount",
       COUNT(DISTINCT CASE WHEN t.status = 'closed' THEN m."ticketId" END)::int AS "closedCount"
     FROM "Messages" m
     INNER JOIN "Tickets" t ON t.id = m."ticketId"
     WHERE t."companyId" = :companyId
       AND t."whatsappId" IN (:whatsappIds)
       AND t."isGroup" = false
       AND (t."isSupport" = false OR t."isSupport" IS NULL)
       AND m."createdAt" BETWEEN :start AND :end
       AND m."isDeleted" = false
       AND (m."isInternal" = false OR m."isInternal" IS NULL)`,
    {
      replacements: { companyId, whatsappIds, start, end },
      type: QueryTypes.SELECT
    }
  );
  return {
    dayCount: Number(rows[0]?.dayCount || 0),
    closedCount: Number(rows[0]?.closedCount || 0)
  };
};

const lastMessageAt = async (ticketIds: number[]): Promise<Map<number, Date>> => {
  const found = new Map<number, Date>();
  if (!ticketIds.length) return found;
  const rows = await sequelize.query<LastRow>(
    `SELECT DISTINCT ON ("ticketId") "ticketId" AS "ticketId", "createdAt"
     FROM "Messages"
     WHERE "ticketId" IN (:ticketIds)
       AND "isDeleted" = false
       AND ("isInternal" = false OR "isInternal" IS NULL)
     ORDER BY "ticketId", "createdAt" DESC`,
    { replacements: { ticketIds }, type: QueryTypes.SELECT }
  );
  for (const row of rows) found.set(Number(row.ticketId), new Date(row.createdAt));
  return found;
};

const customerSamples = async (
  companyId: number,
  whatsappIds: number[],
  start: Date,
  end: Date
): Promise<string[]> => {
  const messages = await Message.findAll({
    where: {
      companyId,
      fromMe: false,
      isDeleted: false,
      [Op.and]: [
        { createdAt: { [Op.gte]: start, [Op.lte]: end } },
        { [Op.or]: [{ isInternal: false }, { isInternal: null }] }
      ]
    },
    attributes: ["ticketId", "body", "createdAt"],
    include: [
      {
        model: Ticket,
        as: "ticket",
        required: true,
        attributes: ["id", "contactId"],
        where: {
          whatsappId: { [Op.in]: whatsappIds },
          isGroup: false,
          [Op.or]: [{ isSupport: false }, { isSupport: null }]
        },
        include: [{ model: Contact, as: "contact", attributes: ["name"], required: false }]
      }
    ],
    order: [["createdAt", "DESC"]],
    limit: 80
  });
  const samples: string[] = [];
  const seen = new Set<number>();
  for (const message of messages) {
    if (seen.has(message.ticketId)) continue;
    const said = clip(message.body || "");
    if (said.length < 3) continue;
    seen.add(message.ticketId);
    const name = message.ticket?.contact?.name || "Cliente";
    samples.push(`${name}: ${said}`);
    if (samples.length >= SAMPLE_LIMIT) break;
  }
  return samples;
};

const collectFacts = async (
  prompt: Prompt,
  whatsappIds: number[],
  now: Date,
  dateLabel: string
): Promise<DailyReportFacts> => {
  const { startOfDay, endOfDay } = getBrazilDayBounds(now);
  const where = pendingWhere(prompt.companyId, whatsappIds);
  const pendingCount = await Ticket.count({ where });
  const pendingTickets = await Ticket.findAll({
    where,
    include: [
      { model: Contact, as: "contact", attributes: ["name"], required: false },
      { model: User, as: "user", attributes: ["name"], required: false }
    ],
    order: [["updatedAt", "ASC"]],
    limit: LIST_LIMIT
  });
  const lasts = await lastMessageAt(pendingTickets.map(ticket => ticket.id));
  const counts = await dayCounts(prompt.companyId, whatsappIds, startOfDay, endOfDay);
  const samples = counts.dayCount
    ? await customerSamples(prompt.companyId, whatsappIds, startOfDay, endOfDay)
    : [];
  return {
    dateLabel,
    pending: pendingTickets.map(ticket => ({
      name: ticket.contact?.name || "Cliente",
      status: statusLabel(ticket.status),
      assignee: (ticket.user?.name || "").trim(),
      wait: waitLabel(lasts.get(ticket.id) || null, now)
    })),
    hiddenPending: Math.max(0, pendingCount - pendingTickets.length),
    dayCount: counts.dayCount,
    closedCount: counts.closedCount,
    samples
  };
};

const writeReport = async (prompt: Prompt, facts: DailyReportFacts): Promise<string> => {
  const fallback = formatDailyReportFallback(facts);
  const nothing = facts.dayCount === 0 && facts.pending.length + facts.hiddenPending === 0;
  if (nothing) return fallback;
  try {
    const provider = await AIProviderSelector.getProvider(prompt.companyId, "summaries", prompt.provider);
    const material = formatDailyReportFacts(facts);
    const text = await provider.chat(
      [
        { role: "system", content: dailyReportInstruction() },
        { role: "user", content: material }
      ],
      { maxTokens: 1024, temperature: 0.2, thinking: false }
    );
    const cleaned = sanitizeCustomerReply(String(text || ""));
    if (dailyReportLooksUsable(cleaned)) return withDailyReportHeading(cleaned, facts.dateLabel);
  } catch (err: any) {
    logger.warn(`Relatório das 18:30: análise indisponível no agente ${prompt.id} (${err?.message || err})`);
  }
  return fallback;
};

const claimReport = async (promptId: number, today: string): Promise<boolean> => {
  const [claimed] = await Prompt.update(
    { dailyReportSentOn: today },
    {
      where: {
        id: promptId,
        [Op.or]: [{ dailyReportSentOn: null }, { dailyReportSentOn: { [Op.ne]: today } }]
      }
    }
  );
  return claimed > 0;
};

const releaseReport = async (promptId: number, today: string): Promise<void> => {
  await Prompt.update(
    { dailyReportSentOn: null },
    { where: { id: promptId, dailyReportSentOn: today } }
  );
};

const sendReport = async (prompt: Prompt, whatsappIds: number[], body: string): Promise<boolean> => {
  const parts = splitWhatsAppText(body);
  if (!parts.length) return false;
  let lastError = "";
  for (const whatsappId of whatsappIds) {
    try {
      const wbot = getWbot(whatsappId);
      const jid = toWhatsAppGroupJid(prompt.idleAlertGroupJid);
      for (const part of parts) {
        await wbot.sendMessage(jid, { text: part });
      }
      return true;
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }
  logger.warn(`Relatório das 18:30 não enviado pelo agente ${prompt.id}: ${lastError}`);
  return false;
};

const reportOne = async (prompt: Prompt, today: string, now: Date): Promise<void> => {
  if (!shouldSendDailyReport({ date: today, minuteOfDay: getBrazilClock(now).minuteOfDay, sentOn: prompt.dailyReportSentOn })) {
    return;
  }
  const connections = await Whatsapp.findAll({
    where: { companyId: prompt.companyId, promptId: prompt.id },
    attributes: ["id"]
  });
  const whatsappIds = connections.map(item => item.id).filter(id => Number.isFinite(id));
  if (!whatsappIds.length) return;
  const claimed = await claimReport(prompt.id, today);
  if (!claimed) return;
  try {
    const facts = await collectFacts(prompt, whatsappIds, now, dateLabelOf(today));
    const report = signAgentMessage(await writeReport(prompt, facts), prompt.name);
    const sent = report ? await sendReport(prompt, whatsappIds, report) : false;
    if (!sent) await releaseReport(prompt.id, today);
    else logger.info(`Relatório das 18:30 enviado pelo agente ${prompt.id}`);
  } catch (err: any) {
    await releaseReport(prompt.id, today);
    logger.error(`Relatório das 18:30 falhou no agente ${prompt.id}: ${err?.message || err}`);
  }
};

/** Manda ao grupo do agente, uma vez por dia, pendências e a análise das conversas. */
const DailyConversationReportService = async (now = new Date()): Promise<void> => {
  const clock = getBrazilClock(now);
  if (!shouldSendDailyReport({ date: clock.date, minuteOfDay: clock.minuteOfDay, sentOn: null })) return;
  if (running) return;
  running = true;
  try {
    const prompts = await Prompt.findAll({
      where: { idleAlertGroupJid: { [Op.ne]: null } }
    });
    for (const prompt of prompts) {
      if (!prompt.idleAlertGroupJid) continue;
      await reportOne(prompt, clock.date, now);
    }
  } finally {
    running = false;
  }
};

export default DailyConversationReportService;
