import { Op, QueryTypes } from "sequelize";
import sequelize from "../../database";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";
import AppError from "../../errors/AppError";
import { appCache, CACHE_TTL } from "../../libs/appCache";

export interface OverviewMetrics {
  newMessages: number;
  active: number;
  pending: number;
  returns: number;
}

export interface OverviewQueueRow extends OverviewMetrics {
  id: number | null;
  name: string;
  color: string;
}

export interface OverviewUserRow extends OverviewMetrics {
  id: number;
  name: string;
  avatar: string | null;
  online: boolean;
  profile: string;
}

export interface TicketsOverviewData {
  summary: OverviewMetrics & {
    onlineAttendants: number;
    potentials: number;
  };
  queues: OverviewQueueRow[];
  users: OverviewUserRow[];
}

interface Request {
  companyId: number;
  userId: string | number;
  showAll?: string;
  queueIds?: number[];
  search?: string;
}

interface AggRow {
  id: number | null;
  newMessages: string | number;
  active: string | number;
  pending: string | number;
  returns: string | number;
}

const toNum = (v: string | number | null | undefined): number =>
  Number(v) || 0;

const rowToMetrics = (row?: AggRow): OverviewMetrics => ({
  newMessages: toNum(row?.newMessages),
  active: toNum(row?.active),
  pending: toNum(row?.pending),
  returns: toNum(row?.returns),
});

const GetTicketsOverviewService = async (
  request: Request
): Promise<TicketsOverviewData> => {
  const { companyId, userId, showAll, queueIds, search = "" } = request;

  if (!companyId) {
    throw new AppError("companyId é obrigatório", 400);
  }

  const cacheKey = appCache.buildKey("tickets", companyId, `overview:${userId}`, {
    showAll,
    queueIds,
    search
  });

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.live,
    async () => fetchTicketsOverview(request),
    "tickets"
  );

  return value;
};

const fetchTicketsOverview = async ({
  companyId,
  userId,
  showAll,
  queueIds: queueIdsParam,
  search = ""
}: Request): Promise<TicketsOverviewData> => {
  if (!companyId) {
    throw new AppError("companyId é obrigatório", 400);
  }

  const user = await ShowUserService(userId);
  const isAdmin = user.profile === "admin" || user.super === true;
  const showAllTickets = showAll === "true" || isAdmin;

  const userQueueIds = user.queues.map((q) => q.id);
  let allowedQueueIds: number[] | null = null;

  if (!showAllTickets) {
    allowedQueueIds =
      queueIdsParam && queueIdsParam.length > 0
        ? queueIdsParam.filter((id) => userQueueIds.includes(id))
        : userQueueIds;
  } else if (queueIdsParam && queueIdsParam.length > 0) {
    allowedQueueIds = queueIdsParam;
  }

  const queueFilterSql =
    allowedQueueIds && allowedQueueIds.length > 0
      ? `AND t."queueId" IN (${allowedQueueIds.join(",")})`
      : !showAllTickets && (!allowedQueueIds || allowedQueueIds.length === 0)
        ? "AND 1=0"
        : "";

  const baseWhere = `
    t."companyId" = :companyId
    AND t."isGroup" = false
    AND t.status != 'rating'
    ${queueFilterSql}
  `;

  const queueAggRows = (await sequelize.query<AggRow>(
    `
    SELECT
      t."queueId" AS id,
      COUNT(*) FILTER (WHERE t."unreadMessages" > 0)::int AS "newMessages",
      COUNT(*) FILTER (WHERE t.status = 'open')::int AS "active",
      COUNT(*) FILTER (WHERE t.status = 'pending')::int AS "pending",
      COUNT(*) FILTER (WHERE t.status = 'pending' AND t."unreadMessages" > 0)::int AS "returns"
    FROM "Tickets" t
    WHERE ${baseWhere}
    GROUP BY t."queueId"
    `,
    {
      replacements: { companyId },
      type: QueryTypes.SELECT,
    }
  )) as AggRow[];

  const userAggRows = (await sequelize.query<AggRow>(
    `
    SELECT
      t."userId" AS id,
      COUNT(*) FILTER (WHERE t."unreadMessages" > 0)::int AS "newMessages",
      COUNT(*) FILTER (WHERE t.status = 'open')::int AS "active",
      COUNT(*) FILTER (WHERE t.status = 'pending')::int AS "pending",
      COUNT(*) FILTER (WHERE t.status = 'pending' AND t."unreadMessages" > 0)::int AS "returns"
    FROM "Tickets" t
    WHERE ${baseWhere}
      AND t."userId" IS NOT NULL
    GROUP BY t."userId"
    `,
    {
      replacements: { companyId },
      type: QueryTypes.SELECT,
    }
  )) as AggRow[];

  const queueAggMap = new Map<number | null, OverviewMetrics>();
  queueAggRows.forEach((row) => {
    queueAggMap.set(row.id, rowToMetrics(row));
  });

  const userAggMap = new Map<number, OverviewMetrics>();
  userAggRows.forEach((row) => {
    if (row.id != null) {
      userAggMap.set(Number(row.id), rowToMetrics(row));
    }
  });

  const queueWhere: Record<string, unknown> = { companyId };
  if (allowedQueueIds && allowedQueueIds.length > 0) {
    queueWhere.id = { [Op.in]: allowedQueueIds };
  } else if (!showAllTickets && userQueueIds.length === 0) {
    queueWhere.id = { [Op.in]: [] };
  }

  let queues = await Queue.findAll({
    where: queueWhere,
    attributes: ["id", "name", "color"],
    order: [["name", "ASC"]],
  });

  const searchTerm = search.trim().toLowerCase();
  if (searchTerm) {
    queues = queues.filter((q) =>
      (q.name || "").toLowerCase().includes(searchTerm)
    );
  }

  const emptyMetrics = (): OverviewMetrics => ({
    newMessages: 0,
    active: 0,
    pending: 0,
    returns: 0,
  });

  const queueRows: OverviewQueueRow[] = queues.map((q) => ({
    id: q.id,
    name: q.name,
    color: q.color || "#7C7C7C",
    ...(queueAggMap.get(q.id) || emptyMetrics()),
  }));

  const orphanMetrics = queueAggMap.get(null);
  if (
    orphanMetrics &&
    (orphanMetrics.active > 0 ||
      orphanMetrics.pending > 0 ||
      orphanMetrics.newMessages > 0 ||
      orphanMetrics.returns > 0)
  ) {
    if (!searchTerm || "sem fila".includes(searchTerm)) {
      queueRows.push({
        id: null,
        name: "Sem fila",
        color: "#9CA3AF",
        ...orphanMetrics,
      });
    }
  }

  const userWhere: Record<string, unknown> = {
    companyId,
    active: true,
  };

  if (!showAllTickets) {
    userWhere.id = user.id;
  }

  let users = await User.findAll({
    where: userWhere,
    attributes: ["id", "name", "avatar", "online", "profile"],
    order: [["name", "ASC"]],
  });

  if (searchTerm) {
    users = users.filter((u) =>
      (u.name || "").toLowerCase().includes(searchTerm)
    );
  }

  const userRows: OverviewUserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    online: !!u.online,
    profile: u.profile,
    ...(userAggMap.get(u.id) || emptyMetrics()),
  }));

  const sumMetrics = (rows: OverviewMetrics[]): OverviewMetrics =>
    rows.reduce(
      (acc, r) => ({
        newMessages: acc.newMessages + r.newMessages,
        active: acc.active + r.active,
        pending: acc.pending + r.pending,
        returns: acc.returns + r.returns,
      }),
      emptyMetrics()
    );

  const queueTotals = sumMetrics(queueRows);

  const potentialsRow = (await sequelize.query<{ count: string }>(
    `
    SELECT COUNT(*)::int AS count FROM "Tickets" t
    WHERE ${baseWhere}
      AND t.status = 'pending'
      AND t."userId" IS NULL
    `,
    {
      replacements: { companyId },
      type: QueryTypes.SELECT,
      plain: true,
    }
  )) as { count?: string };

  const onlineAttendants = await User.count({
    where: {
      companyId,
      active: true,
      online: true,
    },
  });

  return {
    summary: {
      ...queueTotals,
      onlineAttendants,
      potentials: toNum(potentialsRow?.count),
    },
    queues: queueRows,
    users: userRows,
  };
};

export default GetTicketsOverviewService;
