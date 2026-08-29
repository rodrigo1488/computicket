import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import ShowTicketService from "../TicketServices/ShowTicketService";

interface Request {
  ticketId: string;
  companyId: number;
  query: string;
  queues?: number[];
}

interface Response {
  messages: Message[];
}

const SearchMessagesService = async ({
  ticketId,
  companyId,
  query,
  queues = []
}: Request): Promise<Response> => {
  const ticket = await ShowTicketService(ticketId, companyId);

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { messages: [] };
  }

  const searchTerm = `%${query.trim()}%`;

  const where: Record<string, unknown> = {
    ticketId,
    companyId,
    isDeleted: false,
    body: { [Op.like]: searchTerm }
  };

  if (queues.length > 0) {
    where.queueId = {
      [Op.or]: [
        { [Op.in]: queues },
        { [Op.eq]: null }
      ]
    };
  }

  const messages = await Message.findAll({
    where,
    include: [
      {
        model: Contact,
        as: "contact",
        required: false
      },
      {
        model: Message,
        as: "quotedMsg",
        required: false,
        include: [{
          model: Contact,
          as: "contact",
          required: false
        }]
      },
      {
        model: Queue,
        as: "queue",
        required: false
      }
    ],
    order: [["createdAt", "ASC"]],
    limit: 100
  });

  return { messages };
};

export default SearchMessagesService;
