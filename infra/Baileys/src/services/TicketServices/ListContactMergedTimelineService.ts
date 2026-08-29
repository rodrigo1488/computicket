import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import {
  FINALIZED_STATUSES,
  HistoryFilters,
  filterTicketsByAccess
} from "./closedTicketsHistoryHelper";

interface Request {
  contactId: number;
  companyId: number;
  user: HistoryFilters["user"];
  limit?: number;
  beforeCreatedAt?: string;
  beforeId?: string;
}

interface TimelineMessage {
  id: string;
  body: string;
  fromMe: boolean;
  mediaType: string;
  mediaUrl: string;
  createdAt: Date;
  ticketId: number;
  whatsappId: number | null;
  whatsappName: string | null;
}

interface Response {
  messages: TimelineMessage[];
  hasMore: boolean;
}

const ListContactMergedTimelineService = async ({
  contactId,
  companyId,
  user,
  limit = 40,
  beforeCreatedAt,
  beforeId
}: Request): Promise<Response> => {
  const contact = await Contact.findOne({
    where: { id: contactId, companyId }
  });

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  const tickets = await Ticket.findAll({
    where: {
      companyId,
      contactId,
      status: { [Op.in]: FINALIZED_STATUSES }
    },
    include: [{ model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] }]
  });

  const accessible = filterTicketsByAccess(tickets, user);
  const ticketIds = accessible.map((t) => t.id);

  if (ticketIds.length === 0) {
    return { messages: [], hasMore: false };
  }

  const ticketWhatsappMap = new Map(
    accessible.map((t) => [t.id, { id: t.whatsappId, name: t.whatsapp?.name || null }])
  );

  const whereMessage: Record<string, unknown> = {
    companyId,
    ticketId: { [Op.in]: ticketIds },
    isDeleted: false
  };

  if (beforeCreatedAt) {
    const cursorDate = new Date(beforeCreatedAt);
    if (!Number.isNaN(cursorDate.getTime())) {
      whereMessage.createdAt = { [Op.lt]: cursorDate };
    }
  }

  const fetchLimit = limit + 1;

  const rows = await Message.findAll({
    where: whereMessage,
    attributes: [
      "id",
      "body",
      "fromMe",
      "mediaType",
      "mediaUrl",
      "createdAt",
      "ticketId"
    ],
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"]
    ],
    limit: fetchLimit
  });

  let filtered = rows;
  if (beforeId && beforeCreatedAt) {
    const cursorTime = new Date(beforeCreatedAt).getTime();
    filtered = rows.filter((m) => {
      const t = new Date(m.createdAt).getTime();
      if (t < cursorTime) return true;
      if (t === cursorTime && String(m.id) < String(beforeId)) return true;
      return false;
    });
  }

  const hasMore = filtered.length > limit;
  const page = hasMore ? filtered.slice(0, limit) : filtered;

  const messages: TimelineMessage[] = page.map((m) => {
    const w = ticketWhatsappMap.get(m.ticketId);
    return {
      id: m.id,
      body: m.body,
      fromMe: m.fromMe,
      mediaType: m.mediaType,
      mediaUrl: m.mediaUrl,
      createdAt: m.createdAt,
      ticketId: m.ticketId,
      whatsappId: w?.id ?? null,
      whatsappName: w?.name ?? null
    };
  });

  messages.reverse();

  return { messages, hasMore };
};

export default ListContactMergedTimelineService;
