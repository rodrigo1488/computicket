import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import { cacheLayer } from "../../libs/cache";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { verifyMessage } from "../WbotServices/wbotMessageListener";
import UpdateTicketService from "./UpdateTicketService";

const DEFAULT_WARNING =
  "Este chat será encerrado em {{minutos}} minutos por falta de interação.";

type WarnCache = {
  anchor: string;
  warned: boolean;
  warningBody?: string;
};

const cacheKey = (ticketId: number) => `autoCloseWarned:${ticketId}`;

const parseMinutes = (raw?: string | null): number => {
  const n = Number.parseInt(String(raw || "0"), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 10080);
};

const replaceMinutes = (template: string, minutes: number): string =>
  template.replace(/\{\{\s*minutos\s*\}\}/gi, String(minutes));

const sameText = (a?: string | null, b?: string | null): boolean =>
  String(a || "")
    .replace(/\u200e/g, "")
    .trim() ===
  String(b || "")
    .replace(/\u200e/g, "")
    .trim();

const readCache = async (ticketId: number): Promise<WarnCache | null> => {
  try {
    const raw = await cacheLayer.get(cacheKey(ticketId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WarnCache;
    if (!parsed?.anchor) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = async (
  ticketId: number,
  value: WarnCache,
  ttlSec: number
): Promise<void> => {
  await cacheLayer.set(
    cacheKey(ticketId),
    JSON.stringify(value),
    "EX",
    Math.max(ttlSec, 120)
  );
};

const clearCache = async (ticketId: number): Promise<void> => {
  try {
    await cacheLayer.del(cacheKey(ticketId));
  } catch {
    // ignore
  }
};

const isActiveFlow = (ticket: Ticket): boolean => {
  if (ticket.flowWebhook) return true;
  if (ticket.chatbot) return true;
  if (ticket.useIntegration) return true;
  return false;
};

const resolveAnchor = (ticket: Ticket, cached: WarnCache | null): Date => {
  const updatedAt = new Date(ticket.updatedAt);
  if (!cached?.warned) return updatedAt;
  const warningBody = (cached.warningBody || "").trim();
  const last = String(ticket.lastMessage || "").trim();
  if (warningBody && last && sameText(last, warningBody)) {
    return new Date(cached.anchor);
  }
  return updatedAt;
};

const processCompany = async (companyId: number): Promise<void> => {
  const settings = await Setting.findAll({
    where: {
      companyId,
      key: { [Op.in]: ["autoCloseMinutes", "autoCloseWarningMessage"] }
    }
  });
  const byKey = new Map(settings.map(s => [s.key, String(s.value || "")]));
  const minutes = parseMinutes(byKey.get("autoCloseMinutes"));
  if (minutes <= 0) return;

  const closeAfterMs = minutes * 60 * 1000;
  const warnAfterMs = Math.max(30_000, Math.floor(closeAfterMs / 2));
  const template = (byKey.get("autoCloseWarningMessage") || "").trim() || DEFAULT_WARNING;

  const tickets = await Ticket.findAll({
    where: {
      companyId,
      isGroup: false,
      status: { [Op.in]: ["open", "pending"] }
    },
    include: [{ model: Contact, as: "contact" }],
    order: [["updatedAt", "ASC"]],
    limit: 200
  });

  const now = Date.now();

  for (const ticket of tickets) {
    try {
      if (!ticket.whatsappId) continue;
      if (isActiveFlow(ticket)) continue;

      const cached = await readCache(ticket.id);
      const warned =
        !!cached?.warned &&
        !!cached.warningBody &&
        sameText(ticket.lastMessage, cached.warningBody);
      // Só conta inatividade quando a última fala é do contato (sem retorno).
      // Depois do aviso o lastMessage passa a ser nosso — o cache mantém o ciclo.
      if (ticket.fromMe && !warned) {
        await clearCache(ticket.id);
        continue;
      }

      const anchor = resolveAnchor(ticket, cached);
      const idleMs = now - anchor.getTime();
      if (idleMs < warnAfterMs) {
        if (cached && cached.anchor !== anchor.toISOString()) {
          await clearCache(ticket.id);
        }
        continue;
      }

      if (idleMs >= closeAfterMs) {
        await UpdateTicketService({
          ticketData: { status: "closed" },
          ticketId: ticket.id,
          companyId
        });
        await clearCache(ticket.id);
        logger.info({
          msg: "Ticket fechado por inatividade (auto-close da empresa)",
          ticketId: ticket.id,
          companyId,
          minutes
        });
        continue;
      }

      const alreadyWarned =
        cached?.warned &&
        cached.anchor === anchor.toISOString() &&
        !!cached.warningBody &&
        sameText(ticket.lastMessage, cached.warningBody);
      if (alreadyWarned) continue;

      const remaining = Math.max(
        1,
        Math.ceil((closeAfterMs - idleMs) / 60_000)
      );
      if (!ticket.contact) continue;
      const rendered = replaceMinutes(template, remaining);
      const body = formatBody(`\u200e${rendered}`, ticket.contact);
      const sent = await SendWhatsAppMessage({ body, ticket });
      if (!sent) continue;
      await verifyMessage(sent, ticket, ticket.contact);
      await ticket.reload();
      await writeCache(
        ticket.id,
        {
          anchor: anchor.toISOString(),
          warned: true,
          warningBody: String(ticket.lastMessage || rendered).trim()
        },
        minutes * 60 * 2
      );
    } catch (err: any) {
      logger.warn({
        msg: "Auto-close: falha ao processar ticket",
        ticketId: ticket.id,
        companyId,
        error: err?.message || err
      });
    }
  }
};

const AutoCloseUnansweredTicketsService = async (): Promise<void> => {
  const companies = await Company.findAll({ attributes: ["id"] });
  for (const company of companies) {
    try {
      await processCompany(company.id);
    } catch (err: any) {
      logger.error({
        msg: "Auto-close: falha na empresa",
        companyId: company.id,
        error: err?.message || err
      });
    }
  }
};

export default AutoCloseUnansweredTicketsService;
