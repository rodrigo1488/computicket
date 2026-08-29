import { Op, fn, where, col, Filterable, Includeable } from "sequelize";
import { startOfDay, endOfDay, parseISO } from "date-fns";

import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";
import Tag from "../../models/Tag";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { sanitizeTicketContactPic } from "../../helpers/contactProfilePic";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  status?: string;
  date?: string;
  updatedAt?: string;
  showAll?: string;
  userId: string;
  withUnreadMessages?: string;
  queueIds: number[];
  tags: number[];
  users: number[];
  companyId: number;
}

interface Response {
  tickets: Ticket[];
  count: number;
  hasMore: boolean;
}

const KANBAN_LIMIT = 100;

const ListTicketsServiceKanban = async ({
  searchParam = "",
  pageNumber = "1",
  queueIds,
  tags,
  users,
  status,
  date,
  updatedAt,
  showAll,
  userId,
  withUnreadMessages,
  companyId
}: Request): Promise<Response> => {
  if (!companyId || companyId === undefined || companyId === null) {
    throw new AppError("companyId é obrigatório e não pode ser undefined", 400);
  }

  const normalizedQueueIds = Array.isArray(queueIds) ? queueIds : [];
  const queueFilter =
    normalizedQueueIds.length > 0
      ? { [Op.or]: [normalizedQueueIds, null] }
      : undefined;

  let whereCondition: Filterable["where"] = {
    [Op.and]: [
      {
        [Op.or]: [
          { userId },
          { status: "pending" },
          { isGroup: true, status: "open" }
        ]
      }
    ]
  };

  if (queueFilter) {
    whereCondition = {
      ...whereCondition,
      queueId: queueFilter
    };
  }

  let includeCondition: Includeable[] = [
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
      attributes: ["name"]
    }
  ];

  if (showAll === "true") {
    whereCondition = { status: { [Op.or]: ["pending", "open"] } };
    if (queueFilter) {
      whereCondition = { ...whereCondition, queueId: queueFilter };
    }
  } else {
    whereCondition = {
      ...whereCondition,
      status: { [Op.or]: ["pending", "open"] }
    };
  }

  if (status) {
    whereCondition = { ...whereCondition, status };
  }

  if (searchParam) {
    const sanitizedSearchParam = searchParam.toLocaleLowerCase().trim();

    includeCondition = [
      ...includeCondition,
      {
        model: Message,
        as: "messages",
        attributes: ["id", "body"],
        where: {
          body: where(
            fn("LOWER", col("body")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        required: false,
        duplicating: false
      }
    ];

    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        {
          "$contact.name$": where(
            fn("LOWER", col("contact.name")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        { "$contact.number$": { [Op.like]: `%${sanitizedSearchParam}%` } },
        {
          "$message.body$": where(
            fn("LOWER", col("body")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        }
      ]
    };
  }

  if (date) {
    whereCondition = {
      createdAt: {
        [Op.between]: [+startOfDay(parseISO(date)), +endOfDay(parseISO(date))]
      }
    };
  }

  if (updatedAt) {
    whereCondition = {
      updatedAt: {
        [Op.between]: [
          +startOfDay(parseISO(updatedAt)),
          +endOfDay(parseISO(updatedAt))
        ]
      }
    };
  }

  if (withUnreadMessages === "true") {
    const user = await ShowUserService(userId);
    const userQueueIds = user.queues.map(queue => queue.id);

    whereCondition = {
      [Op.or]: [{ userId }, { status: "pending" }],
      queueId: { [Op.or]: [userQueueIds, null] },
      unreadMessages: { [Op.gt]: 0 },
      status: { [Op.or]: ["pending", "open"] }
    };
  }

  if (Array.isArray(tags) && tags.length > 0) {
    const allTicketTags = await TicketTag.findAll({
      where: { tagId: { [Op.in]: tags } },
      attributes: ["ticketId", "tagId"]
    });

    if (allTicketTags.length === 0) {
      return { tickets: [], count: 0, hasMore: false };
    }

    const ticketsByTag = new Map<number, Set<number>>();
    allTicketTags.forEach(tt => {
      if (!ticketsByTag.has(tt.tagId)) {
        ticketsByTag.set(tt.tagId, new Set());
      }
      ticketsByTag.get(tt.tagId)!.add(tt.ticketId);
    });

    const tagSets = Array.from(ticketsByTag.values());
    let ticketsIntersection = Array.from(tagSets[0]);
    for (let i = 1; i < tagSets.length; i++) {
      ticketsIntersection = ticketsIntersection.filter(id => tagSets[i].has(id));
    }

    if (ticketsIntersection.length === 0) {
      return { tickets: [], count: 0, hasMore: false };
    }

    whereCondition = {
      ...whereCondition,
      id: { [Op.in]: ticketsIntersection }
    };
  }

  if (Array.isArray(users) && users.length > 0) {
    const allUserTickets = await Ticket.findAll({
      where: { userId: { [Op.in]: users }, companyId },
      attributes: ["id", "userId"]
    });

    if (allUserTickets.length === 0) {
      return { tickets: [], count: 0, hasMore: false };
    }

    const ticketsByUser = new Map<number, Set<number>>();
    allUserTickets.forEach(t => {
      if (!ticketsByUser.has(t.userId)) {
        ticketsByUser.set(t.userId, new Set());
      }
      ticketsByUser.get(t.userId)!.add(t.id);
    });

    const userSets = Array.from(ticketsByUser.values());
    let ticketsIntersection = Array.from(userSets[0]);
    for (let i = 1; i < userSets.length; i++) {
      ticketsIntersection = ticketsIntersection.filter(id => userSets[i].has(id));
    }

    if (ticketsIntersection.length === 0) {
      return { tickets: [], count: 0, hasMore: false };
    }

    whereCondition = {
      ...whereCondition,
      id: { [Op.in]: ticketsIntersection }
    };
  }

  const limit = KANBAN_LIMIT;
  const offset = limit * (Math.max(1, +pageNumber || 1) - 1);

  whereCondition = {
    ...whereCondition,
    companyId
  };

  const { count, rows: tickets } = await Ticket.findAndCountAll({
    where: whereCondition,
    include: includeCondition,
    distinct: true,
    limit,
    offset,
    order: [["updatedAt", "DESC"]],
    subQuery: false
  });

  return {
    tickets: tickets.map(t => sanitizeTicketContactPic(t.toJSON() as Ticket)),
    count,
    hasMore: count > offset + tickets.length
  };
};

export default ListTicketsServiceKanban;
