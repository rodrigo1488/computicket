import { Op, UniqueConstraintError } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import AppError from "../../errors/AppError";

const LIVE_STATUSES = ["open", "pending", "rating"];

const findLiveTicket = async (
  contactId: number,
  companyId: number,
  whatsappId?: number
): Promise<Ticket | null> => {
  return Ticket.findOne({
    where: {
      status: { [Op.in]: LIVE_STATUSES },
      contactId,
      companyId,
      ...(whatsappId ? { whatsappId } : {})
    },
    order: [["id", "DESC"]]
  });
};

const createFreshTicket = async (params: {
  contactId: number;
  companyId: number;
  whatsappId: number;
  unreadMessages: number;
  isGroup: boolean;
  integrationId: number | null;
  promptId: number | null;
}): Promise<Ticket> => {
  const ticket = await Ticket.create({
    contactId: params.contactId,
    status: params.isGroup ? "open" : "pending",
    isGroup: params.isGroup,
    unreadMessages: params.unreadMessages,
    whatsappId: params.whatsappId,
    companyId: params.companyId,
    integrationId: params.integrationId,
    promptId: params.promptId,
    useIntegration: false
  });

  await FindOrCreateATicketTrakingService({
    ticketId: ticket.id,
    companyId: params.companyId,
    whatsappId: params.whatsappId,
    userId: ticket.userId
  });

  logger.info("🎫 === TICKET CRIADO (ciclo novo) ===", {
    ticketId: ticket.id,
    contactId: ticket.contactId,
    whatsappId: ticket.whatsappId,
    status: ticket.status,
    isGroup: ticket.isGroup
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
  const contactId = groupContact ? groupContact.id : contact.id;
  const isGroup = !!groupContact;

  const whatsapp = await Whatsapp.findOne({
    where: { id: whatsappId }
  });

  let ticket = await findLiveTicket(contactId, companyId, whatsappId);

  if (!ticket && isGroup) {
    ticket = await findLiveTicket(contactId, companyId);
  }

  if (ticket) {
    await ticket.update({
      unreadMessages,
      whatsappId,
      integrationId: whatsapp?.integrationId || ticket.integrationId,
      promptId: whatsapp?.promptId || ticket.promptId
    });
    ticket = await ShowTicketService(ticket.id, companyId);
    return ticket;
  }

  // Ecos outbound/automáticos (conclusão, avaliação) ficam no ticket fechado
  // mais recente — sem reabrir e sem abrir um ciclo novo.
  if (fromMe || isAutomatedInbound) {
    const closed = await Ticket.findOne({
      where: { contactId, companyId, whatsappId, status: "closed" },
      order: [["id", "DESC"]]
    });
    if (closed) {
      return ShowTicketService(closed.id, companyId);
    }
  }

  try {
    ticket = await createFreshTicket({
      contactId,
      companyId,
      whatsappId,
      unreadMessages,
      isGroup,
      integrationId: whatsapp?.integrationId || null,
      promptId: whatsapp?.promptId || null
    });
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) {
      throw err;
    }
    ticket = await findLiveTicket(contactId, companyId, whatsappId);
    if (!ticket) {
      throw err;
    }
    logger.info({
      msg: "FindOrCreateTicketService: corrida — reutilizando ticket aberto/pendente",
      ticketId: ticket.id
    });
  }

  if (!ticket || !ticket.id) {
    logger.error("FindOrCreateTicketService: ticket.id indefinido após criação/busca", {
      contactId,
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
