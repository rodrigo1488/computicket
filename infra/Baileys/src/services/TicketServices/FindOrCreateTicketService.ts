import { subHours } from "date-fns";
import { Op, UniqueConstraintError } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Setting from "../../models/Setting";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import AppError from "../../errors/AppError";

const reopenClosedTicket = async (
  ticket: Ticket,
  params: {
    unreadMessages: number;
    companyId: number;
    groupContact?: Contact;
  }
): Promise<Ticket> => {
  await ticket.update({
    status: params.groupContact ? "open" : "pending",
    userId: null,
    unreadMessages: params.unreadMessages,
    companyId: params.companyId,
    sessionStartedAt: new Date(),
    promptId: null,
    integrationId: ticket.integrationId,
    useIntegration: false,
    typebotStatus: false,
    typebotSessionId: null
  });
  await FindOrCreateATicketTrakingService({
    ticketId: ticket.id,
    companyId: params.companyId,
    whatsappId: ticket.whatsappId,
    userId: ticket.userId
  });
  logger.info({
    msg: "FindOrCreateTicketService: conversa fechada reaberta no mesmo ticket",
    ticketId: ticket.id,
    status: ticket.status
  });
  return ticket;
};

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
        [Op.or]: ["open", "pending", "rating", "closed"]
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

  if (ticket && ticket.status !== "closed") {
    await ticket.update({
      unreadMessages,
      whatsappId,
      integrationId: whatsapp?.integrationId || ticket.integrationId,
      promptId: whatsapp?.promptId || ticket.promptId
    });

    logger.debug("🔄 Ticket existente atualizado com config do WhatsApp", {
      ticketId: ticket.id,
      integrationId: ticket.integrationId,
      promptId: ticket.promptId,
      useIntegration: ticket.useIntegration,
      atualizouIntegracao: whatsapp?.integrationId !== ticket.integrationId
    });
  }

  if (ticket?.status === "closed") {
    if (fromMe || isAutomatedInbound) {
      return await ShowTicketService(ticket.id, companyId);
    }
    ticket = await reopenClosedTicket(ticket, {
      unreadMessages,
      companyId,
      groupContact
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
      if (ticket.status === "closed") {
        if (fromMe || isAutomatedInbound) {
          return await ShowTicketService(ticket.id, companyId);
        }
        ticket = await reopenClosedTicket(ticket, {
          unreadMessages,
          companyId,
          groupContact
        });
      } else {
        await ticket.update({
          status: "open",
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
    }
    const msgIsGroupBlock = await Setting.findOne({
      where: { key: "timeCreateNewTicket" }
    });

    const value = msgIsGroupBlock ? parseInt(msgIsGroupBlock.value, 10) : 7200;
    void value;
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
      if (ticket.status === "rating") {
        await ticket.update({
          unreadMessages,
          whatsappId,
          integrationId: whatsapp?.integrationId || ticket.integrationId,
          promptId: whatsapp?.promptId || ticket.promptId
        });
      } else if (ticket.status === "closed") {
        if (fromMe || isAutomatedInbound) {
          return await ShowTicketService(ticket.id, companyId);
        }
        ticket = await reopenClosedTicket(ticket, {
          unreadMessages,
          companyId
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
    try {
      ticket = await Ticket.create({
        contactId: groupContact ? groupContact.id : contact.id,
        status: groupContact ? "open" : "pending",
        isGroup: !!groupContact,
        unreadMessages,
        whatsappId,
        companyId,
        integrationId: whatsapp?.integrationId || null,
        promptId: whatsapp?.promptId || null,
        useIntegration: false
      });

      logger.info("🎫 === TICKET CRIADO ===", {
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
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) {
        throw err;
      }
      ticket = await Ticket.findOne({
        where: {
          contactId: groupContact ? groupContact.id : contact.id,
          companyId,
          whatsappId
        },
        order: [["id", "DESC"]]
      });
      if (!ticket) {
        throw err;
      }
      if (ticket.status === "closed" && !fromMe && !isAutomatedInbound) {
        ticket = await reopenClosedTicket(ticket, {
          unreadMessages,
          companyId,
          groupContact
        });
      }
    }
  }

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
