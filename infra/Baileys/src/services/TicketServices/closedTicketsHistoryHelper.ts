import { Op, fn, where, col, Filterable, Includeable, literal } from "sequelize";
import { startOfDay, endOfDay, parseISO, isValid } from "date-fns";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import User from "../../models/User";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import TicketTag from "../../models/TicketTag";
import canUserAccessTicket from "../../helpers/CanUserAccessTicketQueue";

export const FINALIZED_STATUSES = ["closed", "rating"];

export const ticketHistoryIncludes = (): Includeable[] => [
  {
    model: Contact,
    as: "contact",
    attributes: ["id", "name", "number", "email", "profilePicUrl"]
  },
  {
    model: Queue,
    as: "queue",
    attributes: ["id", "name", "color"]
  },
  {
    model: User,
    as: "user",
    attributes: ["id", "name"]
  },
  {
    model: Tag,
    as: "tags",
    attributes: ["id", "name", "color"]
  },
  {
    model: Whatsapp,
    as: "whatsapp",
    attributes: ["id", "name"]
  }
];

export interface HistoryFilters {
  companyId: number;
  searchParam?: string;
  dateFrom?: string;
  dateTo?: string;
  queueIds?: number[];
  whatsappIds?: number[];
  userIds?: number[];
  tags?: number[];
  user: User & { queues?: Queue[] };
}

export const getUserQueueIds = (user: User & { queues?: Queue[] }): number[] =>
  (user.queues || []).map((q) => Number(q.id)).filter((id) => !Number.isNaN(id));

export const buildAccessFilterForUser = (
  user: User & { queues?: Queue[] }
): Filterable["where"] | null => {
  if (user.profile === "admin") return null;

  const userQueueIds = getUserQueueIds(user);
  const orConditions: Filterable["where"][] = [{ userId: user.id }];

  if (userQueueIds.length > 0) {
    orConditions.push({ queueId: { [Op.in]: userQueueIds } });
  }
  if (user.allTicket === "enabled") {
    orConditions.push({ queueId: null });
  }

  return { [Op.or]: orConditions };
};

export const buildClosedTicketsWhere = async (
  filters: HistoryFilters
): Promise<Filterable["where"]> => {
  const {
    companyId,
    searchParam,
    dateFrom,
    dateTo,
    queueIds = [],
    whatsappIds = [],
    userIds = [],
    tags = []
  } = filters;

  let whereCondition: Filterable["where"] = {
    companyId,
    status: { [Op.in]: FINALIZED_STATUSES }
  };

  const accessFilter = buildAccessFilterForUser(filters.user);
  if (accessFilter) {
    whereCondition = { [Op.and]: [whereCondition, accessFilter] };
  }

  if (queueIds.length > 0) {
    whereCondition = {
      [Op.and]: [
        whereCondition,
        {
          [Op.or]: [{ queueId: { [Op.in]: queueIds } }, { queueId: null }]
        }
      ]
    };
  }

  if (whatsappIds.length > 0) {
    whereCondition = {
      [Op.and]: [whereCondition, { whatsappId: { [Op.in]: whatsappIds } }]
    };
  }

  if (userIds.length > 0) {
    whereCondition = {
      [Op.and]: [whereCondition, { userId: { [Op.in]: userIds } }]
    };
  }

  if (dateFrom || dateTo) {
    let from: Date;
    let to: Date;
    if (dateFrom) {
      const parsed = parseISO(dateFrom);
      from = isValid(parsed) ? startOfDay(parsed) : startOfDay(new Date(0));
    } else {
      from = startOfDay(new Date(0));
    }
    if (dateTo) {
      const parsed = parseISO(dateTo);
      to = isValid(parsed) ? endOfDay(parsed) : endOfDay(new Date());
    } else {
      to = endOfDay(new Date());
    }
    const updatedAtRange = {
      updatedAt: { [Op.between]: [from, to] }
    } as Filterable["where"];
    whereCondition = {
      [Op.and]: [whereCondition, updatedAtRange]
    };
  }

  if (searchParam && searchParam.trim()) {
    const sanitized = searchParam.toLocaleLowerCase().trim();
    const normalizedSearch = searchParam.trim();

    const matchingContacts = await Contact.findAll({
      where: {
        companyId,
        [Op.or]: [
          where(fn("LOWER", col("name")), "LIKE", `%${sanitized}%`),
          { number: { [Op.like]: `%${normalizedSearch}%` } }
        ]
      },
      attributes: ["id"],
      raw: true
    });

    const contactIds = matchingContacts
      .map((contact) => Number(contact.id))
      .filter((id) => !Number.isNaN(id));

    if (contactIds.length === 0) {
      return { id: -1 };
    }

    whereCondition = {
      [Op.and]: [whereCondition, { contactId: { [Op.in]: contactIds } }]
    };
  }

  if (tags.length > 0) {
    const allTicketTags = await TicketTag.findAll({
      where: { tagId: { [Op.in]: tags } },
      attributes: ["ticketId", "tagId"]
    });

    if (allTicketTags.length === 0) {
      return { id: -1 };
    }

    const ticketsByTag = new Map<number, Set<number>>();
    allTicketTags.forEach((tt) => {
      if (!ticketsByTag.has(tt.tagId)) {
        ticketsByTag.set(tt.tagId, new Set());
      }
      ticketsByTag.get(tt.tagId)!.add(tt.ticketId);
    });

    const tagSets = Array.from(ticketsByTag.values());
    let intersection: number[] = Array.from(tagSets[0]);
    for (let i = 1; i < tagSets.length; i++) {
      intersection = intersection.filter((id) => tagSets[i].has(id));
    }

    if (intersection.length === 0) {
      return { id: -1 };
    }

    whereCondition = {
      [Op.and]: [whereCondition, { id: { [Op.in]: intersection } }]
    };
  }

  return whereCondition;
};

export const serializeSession = (ticket: Ticket) => {
  const finishedAt = ticket.updatedAt || ticket.createdAt;

  return {
    id: ticket.id,
    uuid: ticket.uuid,
    status: ticket.status,
    userId: ticket.userId,
    queueId: ticket.queueId,
    whatsappId: ticket.whatsappId,
    contactId: ticket.contactId,
    lastMessage: ticket.lastMessage,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    finishedAt,
    user: ticket.user,
    queue: ticket.queue,
    whatsapp: ticket.whatsapp,
    tags: ticket.tags
  };
};

export const filterTicketsByAccess = (
  tickets: Ticket[],
  user: User & { queues?: Queue[] }
): Ticket[] => {
  if (user.profile === "admin") return tickets;
  return tickets.filter((t) => canUserAccessTicket(t, user));
};
