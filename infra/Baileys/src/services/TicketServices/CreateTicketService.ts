import AppError from "../../errors/AppError";
import CheckContactOpenTickets from "../../helpers/CheckContactOpenTickets";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import Ticket from "../../models/Ticket";
import ShowContactService from "../ContactServices/ShowContactService";
import { getIO } from "../../libs/socket";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import GetDefaultWhatsAppByUser from "../../helpers/GetDefaultWhatsAppByUser";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { UniqueConstraintError } from "sequelize";

interface Request {
  contactId: number;
  status: string;
  userId: number;
  companyId: number;
  queueId?: number;
  whatsappId?: string;
  /** Ao ocupar mesa: reutilizar ticket aberto do contato em vez de retornar ERR_OTHER_OPEN_TICKET */
  reuseOpenTicket?: boolean;
}

const CreateTicketService = async ({
  contactId,
  status,
  userId,
  queueId,
  companyId,
  whatsappId,
  reuseOpenTicket = false,
}: Request): Promise<Ticket> => {
  let whatsapp;

  if (whatsappId !== undefined && whatsappId !== null && whatsappId !==  "") {
    whatsapp = await ShowWhatsAppService(whatsappId, companyId)
  }
  
  let defaultWhatsapp = await GetDefaultWhatsAppByUser(userId);

  if (whatsapp) {
    defaultWhatsapp = whatsapp;
  }
  if (!defaultWhatsapp)
    defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  if (!defaultWhatsapp?.id) {
    throw new AppError("ERR_WHATSAPP_NOT_FOUND", 404);
  }
  const targetWhatsappId = Number(defaultWhatsapp.id);

  if (!reuseOpenTicket) {
    await CheckContactOpenTickets(contactId, companyId, targetWhatsappId);
  }

  const { isGroup } = await ShowContactService(contactId, companyId);

  // IMPORTANTE: a tabela Tickets tem índice único em (contactId, companyId, whatsappId).
  // Não podemos "pegar qualquer ticket do contato" e depois trocar o whatsappId via UPDATE,
  // pois isso pode colidir com um ticket existente e gerar UniqueConstraintError.
  const whereTicket = { contactId, companyId, whatsappId: targetWhatsappId };

  let ticket = await Ticket.findOne({ where: whereTicket, include: ["contact", "queue"] });

  if (!ticket) {
    try {
      ticket = await Ticket.create({
        contactId,
        companyId,
        whatsappId: targetWhatsappId,
        status: status || "open",
        isGroup,
        userId,
        queueId
      });
      ticket = await Ticket.findByPk(ticket.id, { include: ["contact", "queue"] });
    } catch (err: any) {
      // Corrida: se outro request criou ao mesmo tempo, buscar e seguir.
      if (err instanceof UniqueConstraintError) {
        ticket = await Ticket.findOne({ where: whereTicket, include: ["contact", "queue"] });
      } else {
        throw err;
      }
    }
  }

  if (ticket) {
    await ticket.update({
      companyId,
      queueId,
      userId,
      whatsappId: targetWhatsappId,
      status: "open"
    });
    await ticket.reload({ include: ["contact", "queue"] });
  }

  if (!ticket) {
    throw new AppError("ERR_CREATING_TICKET");
  }

  const io = getIO();
  const ticketPayload = {
    ...ticket.toJSON(),
    id: ticket.id,
    uuid: ticket.uuid,
    status: ticket.status,
    queueId: ticket.queueId ?? null,
    userId: ticket.userId ?? null,
    unreadMessages: ticket.unreadMessages ?? 0,
    companyId
  };

  io.to(ticket.id.toString())
    .to(`company-${companyId}-${ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${ticket.queueId}-${ticket.status}`)
    .to(`queue-${ticket.queueId}-notification`)
    .to(`user-${ticket.userId}`)
    .emit(`company-${companyId}-ticket`, {
      action: "create",
      ticket: ticketPayload
    });

  void CacheInvalidationService.onTicketChanged(companyId, ticket.id);

  return ticket;
};

export default CreateTicketService;
