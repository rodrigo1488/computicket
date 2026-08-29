import { subHours } from "date-fns";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Setting from "../../models/Setting";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import AppError from "../../errors/AppError";

interface TicketData {
  status?: string;
  companyId?: number;
  unreadMessages?: number;
}

const FindOrCreateTicketService = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  companyId: number,
  groupContact?: Contact,
  fromMe?: boolean,
  isAutomatedInbound?: boolean
): Promise<Ticket> => {
  let ticket = await Ticket.findOne({
    where: {
      status: {
        // Inclui "rating" para não cair no fallback das 2h que forçava pending e quebrava a etapa de avaliação
        [Op.or]: ["open", "pending", "closed", "rating"]
      },
      contactId: groupContact ? groupContact.id : contact.id,
      companyId,
      whatsappId
    },
    order: [["id", "DESC"]]
  });

  const whatsapp = await Whatsapp.findOne({
    where: { id: whatsappId }
  });

  if (ticket) {
    // Atualizar ticket existente com configurações atualizadas do WhatsApp
    // IMPORTANTE: NÃO atualizar useIntegration aqui para permitir que execute novamente
    await ticket.update({ 
      unreadMessages, 
      whatsappId,
      // Atualizar integração se mudou no WhatsApp
      integrationId: whatsapp?.integrationId || ticket.integrationId,
      promptId: whatsapp?.promptId || ticket.promptId
      // useIntegration mantém o valor atual do ticket (não forçar true)
    });

    logger.debug('🔄 Ticket existente atualizado com config do WhatsApp', {
      ticketId: ticket.id,
      integrationId: ticket.integrationId,
      promptId: ticket.promptId,
      useIntegration: ticket.useIntegration,
      atualizouIntegracao: whatsapp?.integrationId !== ticket.integrationId
    });
  }

  if (ticket?.status === "closed") {
    if (fromMe || isAutomatedInbound) {
      // Mensagem enviada pelo próprio sistema (eco fromMe) ou automática de outro
      // Compuchat (u200e/u200c) — não reabrir o ticket para evitar loop de bots B2B.
      return await ShowTicketService(ticket.id, companyId);
    }
    // Resetar estado de integração/flow para o FlowBuilder poder iniciar de novo
    await ticket.update({
      queueId: null,
      userId: null,
      status: "pending",
      sessionStartedAt: new Date(),
      useIntegration: false,
      integrationId: whatsapp?.integrationId || null,
      promptId: whatsapp?.promptId || null,
      flowWebhook: false,
      lastFlowId: null,
      hashFlowId: null,
      flowStopped: null,
      chatbot: false,
      queueOptionId: null
    });
  }

  if (!ticket && groupContact) {
    ticket = await Ticket.findOne({
      where: {
        contactId: groupContact.id
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      await ticket.update({
        status: "open", // Grupos vão direto para "open"
        userId: null,
        unreadMessages,
        queueId: null,
        companyId
      });
      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId: ticket.whatsappId,
        userId: ticket.userId
      });
    }
    const msgIsGroupBlock = await Setting.findOne({
      where: { key: "timeCreateNewTicket" }
    });

    const value = msgIsGroupBlock ? parseInt(msgIsGroupBlock.value, 10) : 7200;
  }

  if (!ticket && !groupContact) {
    ticket = await Ticket.findOne({
      where: {
        updatedAt: {
          [Op.between]: [+subHours(new Date(), 2), +new Date()]
        },
        contactId: contact.id,
        companyId,
        whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      // Não forçar pending se o ticket estiver em avaliação (rating) — fallback legado sem filtro de status
      if (ticket.status === "rating") {
        await ticket.update({
          unreadMessages,
          whatsappId,
          integrationId: whatsapp?.integrationId || ticket.integrationId,
          promptId: whatsapp?.promptId || ticket.promptId
        });
      } else {
        await ticket.update({
          status: "pending",
          userId: null,
          unreadMessages,
          queueId: null,
          companyId,
          sessionStartedAt: new Date()
        });
        await FindOrCreateATicketTrakingService({
          ticketId: ticket.id,
          companyId,
          whatsappId: ticket.whatsappId,
          userId: ticket.userId
        });
      }
    }
  }

  if (!ticket) {
    // Criar ticket herdando configurações do WhatsApp
    // useIntegration inicia como FALSE para permitir que o FlowBuilder execute
    // Grupos vão direto para "open", conversas individuais para "pending"
    ticket = await Ticket.create({
      contactId: groupContact ? groupContact.id : contact.id,
      status: groupContact ? "open" : "pending",
      isGroup: !!groupContact,
      unreadMessages,
      whatsappId,
      // CORREÇÃO: não passar o objeto whatsapp inteiro (causava NaN/conflito de associação)
      // apenas whatsappId (inteiro) é a coluna real da tabela
      companyId,
      // ✅ Herdar integração e prompt do WhatsApp
      integrationId: whatsapp?.integrationId || null,
      promptId: whatsapp?.promptId || null,
      useIntegration: false  // Sempre FALSE para permitir primeira execução
    });

    logger.info('🎫 === TICKET CRIADO ===', {
      ticketId: ticket.id,
      contactId: ticket.contactId,
      whatsappId: ticket.whatsappId,
      status: ticket.status,
      isGroup: ticket.isGroup,
      integrationId: ticket.integrationId,
      promptId: ticket.promptId,
      useIntegration: ticket.useIntegration,
      herdouIntegração: !!whatsapp?.integrationId
    });

    await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId,
      userId: ticket.userId
    });
  }

  // Guard: garantir que ticket e ticket.id são válidos antes de consultar o banco
  if (!ticket || !ticket.id) {
    logger.error("FindOrCreateTicketService: ticket.id está indefinido após todas as tentativas de criação/busca", {
      contactId: contact.id,
      companyId,
      whatsappId,
      groupContactId: groupContact?.id
    });
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  ticket = await ShowTicketService(ticket.id, companyId);

  return ticket;
};

export default FindOrCreateTicketService;
