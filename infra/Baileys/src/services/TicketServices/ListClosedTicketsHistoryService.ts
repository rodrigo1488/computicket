import { Op, fn, col } from "sequelize";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import {
  HistoryFilters,
  buildClosedTicketsWhere,
  ticketHistoryIncludes,
  serializeSession,
  filterTicketsByAccess
} from "./closedTicketsHistoryHelper";
import { appCache, CACHE_TTL } from "../../libs/appCache";

interface Request extends HistoryFilters {
  pageNumber?: string;
  groupBy?: string;
}

export interface ContactGroup {
  contact: Contact;
  sessions: ReturnType<typeof serializeSession>[];
  lastFinishedAt: Date | string;
  totalSessions: number;
  whatsappNames: string[];
}

interface Response {
  groups?: ContactGroup[];
  tickets?: ReturnType<typeof serializeSession>[];
  count: number;
  hasMore: boolean;
}

const ListClosedTicketsHistoryService = async (
  request: Request
): Promise<Response> => {
  const { pageNumber = "1", groupBy = "contact", ...filters } = request;

  const cacheKey = appCache.buildKey(
    "tickets",
    filters.companyId,
    `history:${groupBy}`,
    { pageNumber, ...filters, user: { id: filters.user.id, profile: filters.user.profile } }
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.list,
    async () => fetchClosedTicketsHistory(request),
    "tickets"
  );

  return value;
};

const fetchClosedTicketsHistory = async ({
  pageNumber = "1",
  groupBy = "contact",
  ...filters
}: Request): Promise<Response> => {
  const page = Math.max(1, +pageNumber || 1);
  const limit = groupBy === "contact" ? 30 : 40;
  const offset = limit * (page - 1);

  const whereCondition = await buildClosedTicketsWhere(filters);
  if ((whereCondition as { id?: number }).id === -1) {
    return groupBy === "contact"
      ? { groups: [], count: 0, hasMore: false }
      : { tickets: [], count: 0, hasMore: false };
  }

  const includes = ticketHistoryIncludes();

  if (groupBy === "contact") {
    const totalGroups = await Ticket.count({
      where: whereCondition,
      distinct: true,
      col: "contactId"
    });

    const contactPage = (await Ticket.findAll({
      where: whereCondition,
      attributes: [
        "contactId",
        [fn("MAX", col("updatedAt")), "lastFinishedAt"]
      ],
      group: ["contactId"],
      order: [[fn("MAX", col("updatedAt")), "DESC"]],
      limit,
      offset,
      raw: true
    })) as unknown as Array<{ contactId: number; lastFinishedAt: Date }>;

    if (contactPage.length === 0) {
      return { groups: [], count: totalGroups, hasMore: false };
    }

    const contactIds = contactPage.map(row => row.contactId);

    const rows = await Ticket.findAll({
      where: {
        ...whereCondition,
        contactId: { [Op.in]: contactIds }
      },
      include: includes,
      order: [["updatedAt", "DESC"]]
    });

    const accessible = filterTicketsByAccess(rows, filters.user);
    const groupsMap = new Map<number, ContactGroup>();

    accessible.forEach(ticket => {
      const cid = ticket.contactId;
      if (!cid) return;

      if (!groupsMap.has(cid)) {
        groupsMap.set(cid, {
          contact: ticket.contact,
          sessions: [],
          lastFinishedAt: ticket.updatedAt,
          totalSessions: 0,
          whatsappNames: []
        });
      }

      const group = groupsMap.get(cid)!;
      const session = serializeSession(ticket);
      group.sessions.push(session);
      group.totalSessions += 1;

      const wName = ticket.whatsapp?.name;
      if (wName && !group.whatsappNames.includes(wName)) {
        group.whatsappNames.push(wName);
      }

      if (new Date(session.finishedAt) > new Date(group.lastFinishedAt)) {
        group.lastFinishedAt = session.finishedAt;
      }
    });

    const groups = contactPage
      .map(row => groupsMap.get(row.contactId))
      .filter((group): group is ContactGroup => !!group);

    return {
      groups,
      count: totalGroups,
      hasMore: offset + limit < totalGroups
    };
  }

  const { count, rows } = await Ticket.findAndCountAll({
    where: whereCondition,
    include: includes,
    order: [["updatedAt", "DESC"]],
    distinct: true,
    limit,
    offset
  });

  const accessible = filterTicketsByAccess(rows, filters.user);
  const tickets = accessible.map(serializeSession);

  return {
    tickets,
    count,
    hasMore: offset + limit < count
  };
};

export default ListClosedTicketsHistoryService;
