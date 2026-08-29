import { Request, Response } from "express";
import AppError from "../errors/AppError";
import User from "../models/User";
import Queue from "../models/Queue";
import ListClosedTicketsHistoryService from "../services/TicketServices/ListClosedTicketsHistoryService";
import ListContactClosedSessionsService from "../services/TicketServices/ListContactClosedSessionsService";
import ListContactMergedTimelineService from "../services/TicketServices/ListContactMergedTimelineService";
import SearchClosedConversationsService from "../services/TicketServices/SearchClosedConversationsService";

const parseJsonArray = (value?: string): number[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
      : [];
  } catch {
    return [];
  }
};

const loadUserWithQueues = async (userId: number): Promise<User> => {
  const user = await User.findByPk(userId, {
    include: [{ model: Queue, as: "queues" }]
  });
  if (!user) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }
  return user;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const {
    pageNumber,
    groupBy,
    searchParam,
    dateFrom,
    dateTo,
    queueIds: queueIdsStr,
    whatsappIds: whatsappIdsStr,
    users: usersStr,
    tags: tagsStr
  } = req.query as Record<string, string>;

  const user = await loadUserWithQueues(+userId);

  const result = await ListClosedTicketsHistoryService({
    companyId,
    pageNumber,
    groupBy: groupBy || "contact",
    searchParam,
    dateFrom,
    dateTo,
    queueIds: parseJsonArray(queueIdsStr),
    whatsappIds: parseJsonArray(whatsappIdsStr),
    userIds: parseJsonArray(usersStr),
    tags: parseJsonArray(tagsStr),
    user
  });

  return res.json(result);
};

export const search = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const { query, dateFrom, dateTo, queueIds: queueIdsStr, whatsappIds: whatsappIdsStr, users: usersStr, tags: tagsStr } =
    req.query as Record<string, string>;

  const user = await loadUserWithQueues(+userId);

  const result = await SearchClosedConversationsService({
    companyId,
    query: query || "",
    dateFrom,
    dateTo,
    queueIds: parseJsonArray(queueIdsStr),
    whatsappIds: parseJsonArray(whatsappIdsStr),
    userIds: parseJsonArray(usersStr),
    tags: parseJsonArray(tagsStr),
    user
  });

  return res.json(result);
};

export const contactSessions = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const { contactId } = req.params;

  const user = await loadUserWithQueues(+userId);

  const result = await ListContactClosedSessionsService({
    contactId: Number(contactId),
    companyId,
    user
  });

  return res.json(result);
};

export const contactTimeline = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const { contactId } = req.params;
  const { limit, beforeCreatedAt, beforeId } = req.query as Record<string, string>;

  const user = await loadUserWithQueues(+userId);

  const result = await ListContactMergedTimelineService({
    contactId: Number(contactId),
    companyId,
    user,
    limit: limit ? Number(limit) : 40,
    beforeCreatedAt,
    beforeId
  });

  return res.json(result);
};
