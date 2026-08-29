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
import { intersection } from "lodash";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { appCache, CACHE_TTL } from "../../libs/appCache";
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

const ListTicketsService = async ({
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
  const canCache =
    !searchParam?.trim() &&
    pageNumber === "1" &&
    !date &&
    !updatedAt &&
    withUnreadMessages !== "true";

  const cacheParams = {
    userId,
    showAll,
    queueIds,
    tags,
    users,
    status
  };

  const fetchTickets = async (): Promise<Response> =>
    listTicketsFromDb({
      searchParam,
      pageNumber,
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
    });

  if (canCache) {
    const cacheKey = appCache.buildKey("tickets", companyId, "list", cacheParams);
    const { value } = await appCache.getOrSet(
      cacheKey,
      CACHE_TTL.inbox,
      fetchTickets,
      "tickets"
    );
    return value;
  }

  return fetchTickets();
};

const listTicketsFromDb = async ({
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
  // Validação de companyId
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
      { status: { [Op.ne]: "rating" } },
      {
        [Op.or]: [
          { userId },
          { status: "pending" },
          // Grupos abertos não têm userId; precisam aparecer para atendentes
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
  let includeCondition: Includeable[];

  includeCondition = [
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
      attributes: ["name", "type"]
    },
  ];

  if (showAll === "true") {
    whereCondition = { status: { [Op.ne]: "rating" } };
    if (queueFilter) {
      whereCondition = {
        ...whereCondition,
        queueId: queueFilter
      };
    }
  }

  if (status) {
    whereCondition = {
      ...whereCondition,
      status
    };
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
      unreadMessages: { [Op.gt]: 0 },
      status: { [Op.ne]: "rating" }
    };
    if (userQueueIds.length > 0) {
      whereCondition = {
        ...whereCondition,
        queueId: { [Op.or]: [userQueueIds, null] }
      };
    }
  }

  if (Array.isArray(tags) && tags.length > 0) {
    // Otimização: buscar todos os ticketTags de uma vez ao invés de loop
    const allTicketTags = await TicketTag.findAll({
      where: { 
        tagId: { [Op.in]: tags }
      },
      attributes: ['ticketId', 'tagId']
    });

    if (allTicketTags.length === 0) {
      return { tickets: [], count: 0, hasMore: false };
    }

    // Agrupar por tagId
    const ticketsByTag: Map<number, Set<number>> = new Map();
    allTicketTags.forEach(tt => {
      if (!ticketsByTag.has(tt.tagId)) {
        ticketsByTag.set(tt.tagId, new Set());
      }
      ticketsByTag.get(tt.tagId)!.add(tt.ticketId);
    });

    // Calcular interseção: tickets que têm TODAS as tags
    let ticketsIntersection: number[] = [];
    const tagSets = Array.from(ticketsByTag.values());
    
    if (tagSets.length > 0) {
      // Começar com o primeiro conjunto
      ticketsIntersection = Array.from(tagSets[0]);
      
      // Intersecção com os demais
      for (let i = 1; i < tagSets.length; i++) {
        ticketsIntersection = ticketsIntersection.filter(ticketId => 
          tagSets[i].has(ticketId)
        );
      }
    }

    if (ticketsIntersection.length > 0) {
      whereCondition = {
        ...whereCondition,
        id: {
          [Op.in]: ticketsIntersection
        }
      };
    } else {
      // Se não há interseção, retornar vazio
      return { tickets: [], count: 0, hasMore: false };
    }
  }

  if (Array.isArray(users) && users.length > 0) {
    // Otimização: buscar todos os tickets dos usuários de uma vez
    const allUserTickets = await Ticket.findAll({
      where: { 
        userId: { [Op.in]: users },
        companyId 
      },
      attributes: ['id', 'userId']
    });

    if (allUserTickets.length === 0) {
      return { tickets: [], count: 0, hasMore: false };
    }

    // Agrupar por userId
    const ticketsByUser: Map<number, Set<number>> = new Map();
    allUserTickets.forEach(t => {
      if (!ticketsByUser.has(t.userId)) {
        ticketsByUser.set(t.userId, new Set());
      }
      ticketsByUser.get(t.userId)!.add(t.id);
    });

    // Calcular interseção: tickets que pertencem a TODOS os usuários
    let ticketsIntersection: number[] = [];
    const userSets = Array.from(ticketsByUser.values());
    
    if (userSets.length > 0) {
      // Começar com o primeiro conjunto
      ticketsIntersection = Array.from(userSets[0]);
      
      // Intersecção com os demais
      for (let i = 1; i < userSets.length; i++) {
        ticketsIntersection = ticketsIntersection.filter(ticketId => 
          userSets[i].has(ticketId)
        );
      }
    }

    if (ticketsIntersection.length > 0) {
      whereCondition = {
        ...whereCondition,
        id: {
          [Op.in]: ticketsIntersection
        }
      };
    } else {
      // Se não há interseção, retornar vazio
      return { tickets: [], count: 0, hasMore: false };
    }
  }

  const limit = 40;
  const offset = limit * (+pageNumber - 1);

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

  const hasMore = count > offset + tickets.length;

  return {
    tickets: tickets.map(t =>
      sanitizeTicketContactPic(t.toJSON() as Ticket)
    ),
    count,
    hasMore
  };
};

export default ListTicketsService;