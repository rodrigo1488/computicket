import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import { logger } from "../../utils/logger";
import AppError from "../../errors/AppError";

const SendWhatsAppReminderService = async (
  contact: Contact,
  message: string,
  companyId: number
): Promise<void> => {
  try {
    // Buscar WhatsApp padrão da empresa
    const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

    if (!defaultWhatsapp) {
      throw new AppError(
        "Nenhuma conexão WhatsApp padrão disponível para a empresa."
      );
    }

    // Buscar ou criar ticket para o contato
    const ticket = await FindOrCreateTicketService(
      contact,
      defaultWhatsapp.id!,
      0, // unreadMessages
      companyId
    );

    // Enviar mensagem via WhatsApp
    await SendWhatsAppMessage({
      body: message,
      ticket
    });

    // Atualizar última mensagem do ticket
    await ticket.update({
      lastMessage: message
    });

    logger.info(
      `Lembrete enviado via WhatsApp para contato ${contact.id} no ticket ${ticket.id}`
    );
  } catch (error: any) {
    logger.error(
      `Erro ao enviar lembrete via WhatsApp para contato ${contact.id}:`,
      error
    );
    throw error;
  }
};

export default SendWhatsAppReminderService;
