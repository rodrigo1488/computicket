import { FindOptions } from "sequelize/types";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowTicketService from "../TicketServices/ShowTicketService";
import Queue from "../../models/Queue";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";

interface Request {
  ticketId: string;
  companyId: number;
  pageNumber?: string;
  queues?: number[];
  includeQuoted?: boolean; // Opcional: incluir mensagens citadas
}

interface Response {
  messages: Message[];
  ticket: Ticket;
  count: number;
  hasMore: boolean;
}

const ListMessagesService = async ({
  pageNumber = "1",
  ticketId,
  companyId,
  queues = [],
  includeQuoted = true
}: Request): Promise<Response> => {
  const ticket = await ShowTicketService(ticketId, companyId);

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const options: FindOptions = {
    where: {
      ticketId,
      companyId
    }
  };

  // Construir includes otimizados
  const includes: any[] = [
    {
      model: Contact,
      as: "contact",
      required: false,
      attributes: ["id", "name", "number", "profilePicUrl"] // Limitar atributos
    }
  ];

  // Incluir quotedMsg apenas se necessário
  if (includeQuoted) {
    includes.push({
      model: Message,
      as: "quotedMsg",
      required: false,
      attributes: [
        "id",
        "body",
        "mediaType",
        "mediaUrl",
        "fromMe",
        "isDeleted",
        "createdAt",
        "transcription",
        "transcriptionStatus",
        "transcriptionError"
      ],
      include: [{
        model: Contact,
        as: "contact",
        required: false,
        attributes: ["id", "name"] // Limitar atributos
      }]
    });
  }

  // Queue apenas se necessário (geralmente não usado na listagem de mensagens)
  includes.push({
    model: Queue,
    as: "queue",
    required: false,
    attributes: ["id", "name"] // Limitar atributos
  });

  // Paginação consistente: sempre DESC (mais recentes primeiro), offset = (page-1)*limit.
  // Página 1 = 20 mais recentes; página 2 = próximas 20 mais antigas. Depois revertemos para ordem cronológica.
  const { count, rows: messages } = await Message.findAndCountAll({
    ...options,
    limit,
    attributes: {
      exclude: ["dataJson"]
    },
    include: includes,
    offset,
    order: [["createdAt", "DESC"], ["id", "DESC"]]
  });

  const hasMore = count > offset + messages.length;

  logger.debug({
    msg: "ListMessagesService: Resultado da query",
    ticketId,
    companyId,
    pageNumber,
    totalCount: count,
    returnedCount: messages.length,
    offset,
    limit,
    hasMore,
    messageIds: messages.map(m => m.id).slice(0, 5)
  });

  const sortedMessages = messages.reverse();

  return {
    messages: sortedMessages,
    ticket,
    count,
    hasMore
  };
};

export default ListMessagesService;
