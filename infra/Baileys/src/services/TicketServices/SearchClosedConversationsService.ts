import { Op, fn, where, col } from "sequelize";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";
import Queue from "../../models/Queue";
import {
  HistoryFilters,
  buildClosedTicketsWhere,
  serializeSession,
  filterTicketsByAccess,
  FINALIZED_STATUSES
} from "./closedTicketsHistoryHelper";

interface Request extends HistoryFilters {
  query: string;
}

interface SearchHit {
  ticket: ReturnType<typeof serializeSession>;
  contact: Contact;
  messagePreview?: string;
  matchType: "contact" | "message";
}

interface Response {
  results: SearchHit[];
}

const SearchClosedConversationsService = async ({
  query,
  ...filters
}: Request): Promise<Response> => {
  const trimmed = (query || "").trim();
  if (trimmed.length < 3) {
    return { results: [] };
  }

  const sanitized = trimmed.toLocaleLowerCase();
  const whereCondition = await buildClosedTicketsWhere(filters);

  if ((whereCondition as { id?: number }).id === -1) {
    return { results: [] };
  }

  const baseTicketWhere = {
    ...(whereCondition as object),
    status: { [Op.in]: FINALIZED_STATUSES }
  };

  const contactMatches = await Ticket.findAll({
    where: baseTicketWhere,
    include: [
      {
        model: Contact,
        as: "contact",
        where: {
          [Op.or]: [
            where(fn("LOWER", col("contact.name")), "LIKE", `%${sanitized}%`),
            { number: { [Op.like]: `%${trimmed}%` } }
          ]
        },
        required: true
      },
      { model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] },
      { model: User, as: "user", attributes: ["id", "name"] },
      { model: Queue, as: "queue", attributes: ["id", "name", "color"] }
    ],
    limit: 25,
    order: [["updatedAt", "DESC"]]
  });

  const accessibleContacts = filterTicketsByAccess(contactMatches, filters.user);
  const results: SearchHit[] = [];
  const seenTicketIds = new Set<number>();

  accessibleContacts.forEach((ticket) => {
    seenTicketIds.add(ticket.id);
    results.push({
      ticket: serializeSession(ticket),
      contact: ticket.contact,
      matchType: "contact"
    });
  });

  const messageMatches = await Message.findAll({
    where: {
      companyId: filters.companyId,
      isDeleted: false,
      body: where(fn("LOWER", col("body")), "LIKE", `%${sanitized}%`)
    },
    include: [
      {
        model: Ticket,
        as: "ticket",
        where: baseTicketWhere,
        required: true,
        include: [
          { model: Contact, as: "contact" },
          { model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] },
          { model: User, as: "user", attributes: ["id", "name"] },
          { model: Queue, as: "queue", attributes: ["id", "name", "color"] }
        ]
      }
    ],
    order: [["createdAt", "DESC"]],
    limit: 50
  });

  messageMatches.forEach((msg) => {
    const ticket = msg.ticket;
    if (!ticket || seenTicketIds.has(ticket.id)) return;
    if (!filterTicketsByAccess([ticket], filters.user).length) return;

    seenTicketIds.add(ticket.id);
    const preview =
      msg.body && msg.body.length > 120
        ? `${msg.body.slice(0, 120)}...`
        : msg.body;

    results.push({
      ticket: serializeSession(ticket),
      contact: ticket.contact,
      messagePreview: preview,
      matchType: "message"
    });
  });

  return { results: results.slice(0, 50) };
};

export default SearchClosedConversationsService;
