import { subHours } from "date-fns";
import { Op, col, where as sqlWhere } from "sequelize";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
import ListSettingsServiceOne from "../services/SettingServices/ListSettingsServiceOne";

export const isFirstCustomerMessageInTicket = async (
  ticket: Pick<Ticket, "id" | "sessionStartedAt">
): Promise<boolean> => {
  const where: Record<string, unknown> = {
    ticketId: ticket.id,
    fromMe: false
  };

  if (ticket.sessionStartedAt) {
    where.createdAt = { [Op.gte]: ticket.sessionStartedAt };
  }

  const customerMessageCount = await Message.count({ where });

  return customerMessageCount <= 1;
};

export const isConnectionGreetingLimitEnabled = async (
  companyId: number
): Promise<boolean> => {
  const setting = await ListSettingsServiceOne({
    companyId,
    key: "limitConnectionGreeting"
  });

  return setting?.value === "enabled";
};

/**
 * Claim atômico do direito de enviar saudação da conexão.
 * Só um processo concorrente consegue atualizar lastGreetingSentAt.
 */
export const tryClaimConnectionGreeting = async (
  ticket: Pick<Ticket, "id" | "sessionStartedAt" | "lastGreetingSentAt">
): Promise<boolean> => {
  const cutoff24h = subHours(new Date(), 24);
  const now = new Date();

  const [affected] = await Ticket.update(
    { lastGreetingSentAt: now },
    {
      where: {
        id: ticket.id,
        [Op.or]: [
          { lastGreetingSentAt: null },
          { lastGreetingSentAt: { [Op.lt]: cutoff24h } },
          sqlWhere(col("lastGreetingSentAt"), "<", col("sessionStartedAt"))
        ]
      }
    }
  );

  return affected > 0;
};

/**
 * Decide se a saudação da conexão deve ser enviada.
 * - Setting desativado: comportamento legado (primeira msg do cliente na sessão).
 * - Setting ativado: claim atômico (1x / 24h ou após reabertura).
 */
export const shouldSendConnectionGreeting = async (
  ticket: Pick<
    Ticket,
    "id" | "companyId" | "sessionStartedAt" | "lastGreetingSentAt"
  >
): Promise<boolean> => {
  if (!(await isConnectionGreetingLimitEnabled(ticket.companyId))) {
    return isFirstCustomerMessageInTicket(ticket);
  }

  return tryClaimConnectionGreeting(ticket);
};
