import { subHours } from "date-fns";
import { Op, col, where as sqlWhere } from "sequelize";
import Ticket from "../models/Ticket";

export type AutoMessageKind = "greeting" | "outOfHours";

const FIELD_BY_KIND: Record<
  AutoMessageKind,
  "lastGreetingSentAt" | "lastOutOfHoursSentAt"
> = {
  greeting: "lastGreetingSentAt",
  outOfHours: "lastOutOfHoursSentAt"
};

/**
 * Claim atômico do direito de enviar uma mensagem automática (saudação ou fora
 * do expediente). Só um processo concorrente consegue gravar o timestamp.
 *
 * Libera de novo após 24h ou quando o ticket reabre (sessionStartedAt mais
 * recente que o último envio).
 */
export const tryClaimAutoMessageOnce = async (
  ticket: Pick<Ticket, "id">,
  kind: AutoMessageKind
): Promise<boolean> => {
  const field = FIELD_BY_KIND[kind];
  const cutoff24h = subHours(new Date(), 24);
  const now = new Date();

  const [affected] = await Ticket.update(
    { [field]: now },
    {
      where: {
        id: ticket.id,
        [Op.or]: [
          { [field]: null },
          { [field]: { [Op.lt]: cutoff24h } },
          sqlWhere(col(field), "<", col("sessionStartedAt"))
        ]
      }
    }
  );

  return affected > 0;
};

export const tryClaimConnectionGreeting = async (
  ticket: Pick<Ticket, "id">
): Promise<boolean> => tryClaimAutoMessageOnce(ticket, "greeting");

export const tryClaimOutOfHours = async (
  ticket: Pick<Ticket, "id">
): Promise<boolean> => tryClaimAutoMessageOnce(ticket, "outOfHours");

export const shouldSendConnectionGreeting = async (
  ticket: Pick<Ticket, "id">
): Promise<boolean> => tryClaimConnectionGreeting(ticket);

export const shouldSendOutOfHoursMessage = async (
  ticket: Pick<Ticket, "id">
): Promise<boolean> => tryClaimOutOfHours(ticket);
