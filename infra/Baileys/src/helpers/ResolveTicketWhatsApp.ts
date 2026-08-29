import AppError from "../errors/AppError";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import GetDefaultWhatsApp from "./GetDefaultWhatsApp";
import { logger } from "../utils/logger";

const ResolveTicketWhatsApp = async (ticket: Ticket): Promise<Whatsapp> => {
  if (ticket.whatsappId) {
    const ticketWhatsapp = await Whatsapp.findByPk(ticket.whatsappId);
    if (ticketWhatsapp) {
      return ticketWhatsapp;
    }

    logger.warn({
      msg: "ResolveTicketWhatsApp: conexão vinculada ao ticket não encontrada. Tentando fallback.",
      ticketId: ticket.id,
      companyId: ticket.companyId,
      oldWhatsappId: ticket.whatsappId
    });
  }

  const fallbackWhatsapp = await GetDefaultWhatsApp(ticket.companyId, ticket.userId);

  if (!fallbackWhatsapp) {
    throw new AppError("ERR_WAPP_NOT_FOUND");
  }

  await ticket.update({ whatsappId: fallbackWhatsapp.id });

  logger.info({
    msg: "ResolveTicketWhatsApp: ticket reanexado a conexão ativa.",
    ticketId: ticket.id,
    companyId: ticket.companyId,
    whatsappId: fallbackWhatsapp.id
  });

  return fallbackWhatsapp;
};

export default ResolveTicketWhatsApp;
