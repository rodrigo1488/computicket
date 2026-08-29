import { QueryTypes, Op, Sequelize } from "sequelize";
import sequelize from "../../database";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Campaign from "../../models/Campaign";
import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";
import Task from "../../models/Task";
import CheckOpenAITokensService, {
  OpenAITokenInfo
} from "../AiServices/CheckOpenAITokensService";
import { logger } from "../../utils/logger";
import { appCache, CACHE_TTL } from "../../libs/appCache";

/** Mantido na resposta da API para compatibilidade com o dashboard legado. */
export interface GeminiTokenInfo {
  available: boolean;
  tokensUsed?: number;
  tokensRemaining?: number;
  tokensTotal?: number;
  quotaExceeded?: boolean;
  error?: string;
}

export interface ExtendedDashboardData {
  ticketsToday: number;
  resolutionRate: number;
  activeCampaigns: number;
  messagesSent: number;
  pendingTasks: number;
  onlineConnections: number;
  totalConnections: number;
  onlineUsers: number;
  totalUsers: number;
  ticketsByStatus: { status: string; count: number }[];
  ticketsByQueue: { name: string; count: number; color: string }[];
  ticketsByHour: { hour: string; count: number }[];
  ticketsByDay: { day: string; count: number }[];
  topAttendants: { name: string; count: number }[];
  geminiTokens: GeminiTokenInfo;
  openAITokens: OpenAITokenInfo;
}

export interface ExtendedParams {
  days?: number;
  date_from?: string;
  date_to?: string;
}

const resolveDateRange = (params: ExtendedParams) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dateFrom = today;
  let dateTo = new Date();

  if (params.days) {
    dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - params.days);
  }

  if (params.date_from) {
    dateFrom = new Date(params.date_from);
  }

  if (params.date_to) {
    dateTo = new Date(params.date_to);
    dateTo.setHours(23, 59, 59, 999);
  }

  return { today, dateFrom, dateTo };
};

const fetchLiveBlock = async (
  companyId: number,
  today: Date,
  params: ExtendedParams
) => {
  const cacheKey = appCache.buildKey(
    "dashboard",
    companyId,
    "block:live",
    params
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.live,
    async () => {
      const [ticketsToday, connections, users] = await Promise.all([
        Ticket.count({
          where: { companyId, createdAt: { [Op.gte]: today } }
        }),
        Whatsapp.findAll({
          where: { companyId },
          attributes: ["id", "status"]
        }),
        User.findAll({
          where: { companyId },
          attributes: ["id", "online"]
        })
      ]);

      const onlineConnections = connections.filter(
        w => w.status === "CONNECTED"
      ).length;

      return {
        ticketsToday,
        onlineConnections,
        totalConnections: connections.length,
        onlineUsers: users.filter(u => u.online).length,
        totalUsers: users.length
      };
    },
    "dashboard"
  );

  return value;
};

const fetchMetricsBlock = async (
  companyId: number,
  dateFrom: Date,
  dateTo: Date,
  params: ExtendedParams
) => {
  const cacheKey = appCache.buildKey(
    "dashboard",
    companyId,
    "block:metrics",
    params
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.warm,
    async () => {
      const [
        ticketsTotal,
        ticketsFinished,
        activeCampaigns,
        messagesSent,
        pendingTasks
      ] = await Promise.all([
        Ticket.count({
          where: {
            companyId,
            createdAt: { [Op.between]: [+dateFrom, +dateTo] }
          }
        }),
        Ticket.count({
          where: {
            companyId,
            status: "closed",
            createdAt: { [Op.between]: [+dateFrom, +dateTo] }
          }
        }),
        Campaign.count({
          where: { companyId, status: "EM_ANDAMENTO" }
        }),
        Message.count({
          where: {
            companyId,
            fromMe: true,
            createdAt: { [Op.between]: [+dateFrom, +dateTo] }
          }
        }),
        Task.count({
          where: { companyId, status: "pending" }
        }).catch(() => 0)
      ]);

      const resolutionRate =
        ticketsTotal > 0
          ? Math.min(100, Math.round((ticketsFinished / ticketsTotal) * 100))
          : 0;

      return {
        resolutionRate,
        activeCampaigns,
        messagesSent,
        pendingTasks
      };
    },
    "dashboard"
  );

  return value;
};

const fetchAggregatesBlock = async (
  companyId: number,
  dateFrom: Date,
  dateTo: Date,
  params: ExtendedParams
) => {
  const cacheKey = appCache.buildKey(
    "dashboard",
    companyId,
    "block:aggregates",
    params
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.warm,
    async () => {
      const ticketsByStatusQuery = (await Ticket.findAll({
            where: { companyId },
            attributes: [
              "status",
              [Sequelize.fn("COUNT", Sequelize.col("id")), "count"]
            ],
            group: ["status"],
            raw: true
          })) as any[];

      const ticketsByQueueQuery = (await sequelize.query(
            `
    SELECT 
      q.name,
      q.color,
      COUNT(t.id) as count
    FROM "Tickets" t
    LEFT JOIN "Queues" q ON q.id = t."queueId"
    WHERE t."companyId" = :companyId
    AND t.status IN ('open', 'pending')
    GROUP BY q.id, q.name, q.color
    ORDER BY count DESC
    LIMIT 6
  `,
            {
              replacements: { companyId },
              type: QueryTypes.SELECT
            }
          )) as any[];

      const topAttendantsQuery = (await sequelize.query(
            `
    SELECT 
      u.name,
      COUNT(t.id) as count
    FROM "Tickets" t
    INNER JOIN "Users" u ON u.id = t."userId"
    WHERE t."companyId" = :companyId
    AND t."createdAt" BETWEEN :dateFrom AND :dateTo
    AND t.status = 'closed'
    GROUP BY u.id, u.name
    ORDER BY count DESC
    LIMIT 5
  `,
            {
              replacements: {
                companyId,
                dateFrom,
                dateTo
              },
              type: QueryTypes.SELECT
            }
          )) as any[];

      return {
        ticketsByStatus: ticketsByStatusQuery.map(item => ({
          status: item.status,
          count: parseInt(item.count, 10)
        })),
        ticketsByQueue: ticketsByQueueQuery.map(item => ({
          name: item.name || "Sem Fila",
          count: parseInt(item.count, 10),
          color: item.color || "#6B7280"
        })),
        topAttendants: topAttendantsQuery.map(item => ({
          name: item.name,
          count: parseInt(item.count, 10)
        }))
      };
    },
    "dashboard"
  );

  return value;
};

const fetchHistoricalBlock = async (companyId: number) => {
  const cacheKey = appCache.buildKey(
    "dashboard",
    companyId,
    "block:historical",
    {}
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.historical,
    async () => {
      const ticketsByHourQuery = (await sequelize.query(
          `
    SELECT 
      TO_CHAR("createdAt", 'HH24:00') as hour,
      COUNT(*) as count
    FROM "Tickets"
    WHERE "companyId" = :companyId
    AND "createdAt" >= NOW() - INTERVAL '24 hours'
    GROUP BY TO_CHAR("createdAt", 'HH24:00')
    ORDER BY hour
  `,
          {
            replacements: { companyId },
            type: QueryTypes.SELECT
          }
        )) as any[];

      const ticketsByDayQuery = (await sequelize.query(
          `
    SELECT 
      TO_CHAR("createdAt", 'DD/MM') as day,
      COUNT(*) as count
    FROM "Tickets"
    WHERE "companyId" = :companyId
    AND "createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY TO_CHAR("createdAt", 'DD/MM'), DATE("createdAt")
    ORDER BY DATE("createdAt")
  `,
          {
            replacements: { companyId },
            type: QueryTypes.SELECT
          }
        )) as any[];

      return {
        ticketsByHour: ticketsByHourQuery.map(item => ({
          hour: item.hour,
          count: parseInt(item.count, 10)
        })),
        ticketsByDay: ticketsByDayQuery.map(item => ({
          day: item.day,
          count: parseInt(item.count, 10)
        }))
      };
    },
    "dashboard"
  );

  return value;
};

const fetchExternalBlock = async (companyId: number) => {
  const cacheKey = appCache.buildKey(
    "dashboard",
    companyId,
    "block:external",
    {}
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.external,
    async () => {
      const geminiTokens: GeminiTokenInfo = {
        available: false,
        error: "Não aplicável — a IA usa LM Studio no servidor (OpenAI-compat)."
      };

      let openAITokens: OpenAITokenInfo = {
        available: false,
        error: "Não verificado"
      };

      try {
        openAITokens = await Promise.race([
          CheckOpenAITokensService(companyId),
          new Promise<OpenAITokenInfo>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 5000)
          )
        ]);
      } catch (error: any) {
        logger.error(`Erro ao verificar tokens do OpenAI no dashboard:`, error);
        openAITokens = {
          available: false,
          error: error.message || "Erro ao verificar"
        };
      }

      return { geminiTokens, openAITokens };
    },
    "dashboard"
  );

  return value;
};

const DashboardExtendedService = async (
  companyId: number,
  params: ExtendedParams
): Promise<ExtendedDashboardData> => {
  const { today, dateFrom, dateTo } = resolveDateRange(params);

  const [live, metrics, aggregates, historical, external] = await Promise.all([
    fetchLiveBlock(companyId, today, params),
    fetchMetricsBlock(companyId, dateFrom, dateTo, params),
    fetchAggregatesBlock(companyId, dateFrom, dateTo, params),
    fetchHistoricalBlock(companyId),
    fetchExternalBlock(companyId)
  ]);

  return {
    ticketsToday: live.ticketsToday,
    resolutionRate: metrics.resolutionRate,
    activeCampaigns: metrics.activeCampaigns,
    messagesSent: metrics.messagesSent,
    pendingTasks: metrics.pendingTasks,
    onlineConnections: live.onlineConnections,
    totalConnections: live.totalConnections,
    onlineUsers: live.onlineUsers,
    totalUsers: live.totalUsers,
    ticketsByStatus: aggregates.ticketsByStatus,
    ticketsByQueue: aggregates.ticketsByQueue,
    ticketsByHour: historical.ticketsByHour,
    ticketsByDay: historical.ticketsByDay,
    topAttendants: aggregates.topAttendants,
    geminiTokens: external.geminiTokens,
    openAITokens: external.openAITokens
  };
};

export default DashboardExtendedService;
