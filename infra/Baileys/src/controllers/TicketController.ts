import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import Ticket from "../models/Ticket";

import CreateTicketService from "../services/TicketServices/CreateTicketService";
import DeleteTicketService from "../services/TicketServices/DeleteTicketService";
import ListTicketsService from "../services/TicketServices/ListTicketsService";
import ShowTicketUUIDService from "../services/TicketServices/ShowTicketFromUUIDService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import SetTicketMessagesAsUnread from "../helpers/SetTicketMessagesAsUnread";
import ListTicketsServiceKanban from "../services/TicketServices/ListTicketsServiceKanban";
import GetGroupParticipantsService from "../services/TicketServices/GetGroupParticipantsService";
import GetTicketsOverviewService from "../services/TicketServices/GetTicketsOverviewService";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  status: string;
  date: string;
  updatedAt?: string;
  showAll: string;
  withUnreadMessages: string;
  queueIds: string;
  tags: string;
  users: string;
};

interface TicketData {
  contactId: number;
  status: string;
  queueId: number;
  userId: number;
  whatsappId: string;
  useIntegration: boolean;
  promptId: number;
  integrationId: number;
  reuseOpenTicket?: boolean;
}

export const overview = async (req: Request, res: Response): Promise<Response> => {
  const { showAll, queueIds: queueIdsStringified, search } = req.query as {
    showAll?: string;
    queueIds?: string;
    search?: string;
  };

  const { companyId, id: userId } = req.user;

  if (!companyId) {
    return res.status(400).json({ error: "companyId é obrigatório" });
  }

  let queueIds: number[] = [];
  if (queueIdsStringified) {
    try {
      queueIds = JSON.parse(queueIdsStringified);
    } catch {
      queueIds = [];
    }
  }

  const data = await GetTicketsOverviewService({
    companyId,
    userId,
    showAll,
    queueIds,
    search: search || "",
  });

  return res.status(200).json(data);
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const {
    pageNumber,
    status,
    date,
    updatedAt,
    searchParam,
    showAll,
    queueIds: queueIdsStringified,
    tags: tagIdsStringified,
    users: userIdsStringified,
    withUnreadMessages
  } = req.query as IndexQuery;

  const userId = req.user.id;
  const { companyId } = req.user;

  // Validação de companyId
  if (!companyId || companyId === undefined || companyId === null) {
    return res.status(400).json({ error: "companyId é obrigatório" });
  }

  let queueIds: number[] = [];
  let tagsIds: number[] = [];
  let usersIds: number[] = [];

  if (queueIdsStringified) {
    queueIds = JSON.parse(queueIdsStringified);
  }

  if (tagIdsStringified) {
    tagsIds = JSON.parse(tagIdsStringified);
  }

  if (userIdsStringified) {
    usersIds = JSON.parse(userIdsStringified);
  }

  const { tickets, count, hasMore } = await ListTicketsService({
    searchParam,
    tags: tagsIds,
    users: usersIds,
    pageNumber,
    status,
    date,
    updatedAt,
    showAll,
    userId,
    queueIds,
    withUnreadMessages,
    companyId,


  });
  return res.status(200).json({ tickets, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { contactId, status, userId, queueId, whatsappId, reuseOpenTicket }: TicketData = req.body;
  const { companyId, id: currentUserId } = req.user;

  const ticket = await CreateTicketService({
    contactId,
    status,
    userId: (userId != null ? Number(userId) : currentUserId) as number,
    companyId,
    queueId,
    whatsappId,
    reuseOpenTicket,
  });

  const io = getIO();
  io.to(`company-${companyId}-${ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${ticket.queueId}-${ticket.status}`)
    .to(`queue-${ticket.queueId}-notification`)
    .to(`user-${ticket.userId}`)
    .emit(`company-${companyId}-ticket`, {
      action: "create",
      ticket
    });
  return res.status(200).json(ticket);
};

export const kanban = async (req: Request, res: Response): Promise<Response> => {
  const {
    pageNumber,
    status,
    date,
    updatedAt,
    searchParam,
    showAll,
    queueIds: queueIdsStringified,
    tags: tagIdsStringified,
    users: userIdsStringified,
    withUnreadMessages
  } = req.query as IndexQuery;


  const userId = req.user.id;
  const { companyId } = req.user;

  // Validação de companyId
  if (!companyId || companyId === undefined || companyId === null) {
    return res.status(400).json({ error: "companyId é obrigatório" });
  }

  let queueIds: number[] = [];
  let tagsIds: number[] = [];
  let usersIds: number[] = [];

  if (queueIdsStringified) {
    queueIds = JSON.parse(queueIdsStringified);
  }

  if (tagIdsStringified) {
    tagsIds = JSON.parse(tagIdsStringified);
  }

  if (userIdsStringified) {
    usersIds = JSON.parse(userIdsStringified);
  }

  const { tickets, count, hasMore } = await ListTicketsServiceKanban({
    searchParam,
    tags: tagsIds,
    users: usersIds,
    pageNumber,
    status,
    date,
    updatedAt,
    showAll,
    userId,
    queueIds,
    withUnreadMessages,
    companyId

  });

  return res.status(200).json({ tickets, count, hasMore });
};

export const groupParticipants = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;

  const participants = await GetGroupParticipantsService(ticketId, companyId);
  return res.status(200).json({ participants });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;

  const contact = await ShowTicketService(ticketId, companyId);
  return res.status(200).json(contact);
};

export const showFromUUID = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { uuid } = req.params;
  const { companyId } = req.user;

  if (!uuid || String(uuid).trim() === "" || String(uuid) === "undefined") {
    return res.status(400).json({ error: "UUID do ticket é obrigatório" });
  }

  const ticket: Ticket = await ShowTicketUUIDService(uuid, companyId);

  return res.status(200).json(ticket);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const ticketData: TicketData = req.body;
  const { companyId, id} = req.user;

  const result = await UpdateTicketService({
    ticketData,
    ticketId,
    companyId,
    actionUserId: id
  });

  if (!result || !result.ticket) {
    return res.status(500).json({ error: "Erro ao atualizar ticket" });
  }

  return res.status(200).json(result.ticket);
};

export const markAsUnread = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);
  await SetTicketMessagesAsUnread(ticket);

  return res.status(200).json({ ticket: await ticket.reload() });
};

export const bulkClose = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { whatsappId } = req.body;

  const where: any = { companyId, status: "pending" };
  if (whatsappId) where.whatsappId = Number(whatsappId);

  const tickets = await Ticket.findAll({ where });

  const io = getIO();
  for (const ticket of tickets) {
    await ticket.update({ status: "closed" });
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-ticket`, {
      action: "delete",
      ticket,
      ticketId: ticket.id,
    });
  }

  return res.status(200).json({ closed: tickets.length });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;

  await ShowTicketService(ticketId, companyId);

  const ticket = await DeleteTicketService(ticketId);

  const io = getIO();
  io.to(ticketId)
    .to(`company-${companyId}-${ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${ticket.queueId}-${ticket.status}`)
    .to(`queue-${ticket.queueId}-notification`)
    .emit(`company-${companyId}-ticket`, {
      action: "delete",
      ticketId: +ticketId
    });

  return res.status(200).json({ message: "ticket deleted" });
};
