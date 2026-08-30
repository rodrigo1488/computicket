import { flask } from "@/lib/api";

export type HelpdeskTab = "open" | "pending" | "closed";

export type HelpdeskContact = {
  id?: number;
  name?: string;
  number?: string;
  email?: string;
  profilePicUrl?: string | null;
};

export type QueueSchedule = {
  weekday: string;
  weekdayEn: string;
  startTime: string;
  endTime: string;
};

export type HelpdeskQueue = {
  id: number;
  name: string;
  color?: string;
  greetingMessage?: string;
  outOfHoursMessage?: string;
  orderQueue?: number | null;
  schedules?: QueueSchedule[] | null;
};

export type HelpdeskAssignee = {
  id: number;
  name: string;
  email?: string;
  role?: string;
  engine_user_id: number;
};

export type QuickMessage = {
  id: number;
  shortcode: string;
  message: string;
};

export type HelpdeskContactDetail = HelpdeskContact & {
  extraInfo?: { id?: number; name?: string; value?: string }[];
};

export type HelpdeskTag = {
  id: number;
  name: string;
  color?: string;
};

export type HelpdeskAgent = {
  id: number;
  name: string;
  email?: string;
  role?: string;
  engine_user_id?: number | null;
  queues?: HelpdeskQueue[];
};

export type HelpdeskConnection = {
  id: number;
  name: string;
  status?: string;
  qrcode?: string;
  type?: string;
  number?: string | null;
  isDefault?: boolean;
  greetingMessage?: string;
  complationMessage?: string;
  outOfHoursMessage?: string;
  queues?: HelpdeskQueue[];
};

export type HelpdeskRating = {
  id: number;
  engine_ticket_id: number;
  computicket_ticket_id?: number | null;
  score?: number | null;
  comment?: string;
  answered: boolean;
  agent_id?: number | null;
  agent_name?: string | null;
  customer_name?: string | null;
  requested_at?: string | null;
  sent_at?: string | null;
  responded_at?: string | null;
};

export type HelpdeskRatingSummary = {
  average: number;
  responded: number;
  pending: number;
  response_rate: number;
  distribution: Record<string, number>;
  recent: HelpdeskRating[];
};

export type HelpdeskConversation = {
  id: number;
  status: string;
  unreadMessages?: number;
  lastMessage?: string | null;
  updatedAt?: string;
  createdAt?: string;
  userId?: number | null;
  queueId?: number | null;
  contact?: HelpdeskContact;
  queue?: HelpdeskQueue | null;
  user?: { id?: number; name?: string } | null;
  whatsapp?: { name?: string; type?: string } | null;
  tags?: HelpdeskTag[];
  computicket_ticket_id?: number | null;
  rating?: HelpdeskRating | null;
  rating_warning?: string;
};

export type HelpdeskMessage = {
  id: string;
  body?: string;
  fromMe?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  createdAt?: string;
  ack?: number;
  isDeleted?: boolean;
  isPrivate?: boolean;
  isInternal?: boolean;
  quotedMsg?: HelpdeskMessage | null;
};

export type EngineSession = {
  token: string;
  companyId: number;
  engineUserId: number;
  engineUrl: string;
};

const DOCKER_ONLY_HOSTS = new Set([
  "whatsapp-engine",
  "baileys",
  "api",
  "web",
  "postgres",
  "redis",
]);

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

function isBrowserUnreachableHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h || DOCKER_ONLY_HOSTS.has(h)) return true;
  // Nomes de serviço Docker (sem ponto) não resolvem no browser.
  if (!h.includes(".") && !isLoopbackHost(h)) return true;
  return false;
}

/**
 * URL do Socket.IO do engine WhatsApp para o browser.
 * Nunca devolve hostname Docker; em páginas HTTPS força https (WSS) e
 * prefere same-origin (proxy Next `/socket.io` → whatsapp-engine).
 */
export function resolveEngineSocketUrl(engineUrl: string): string {
  if (typeof window === "undefined") return engineUrl;

  const page = new URL(window.location.href);
  const pageIsHttps = page.protocol === "https:";
  const configured = (process.env.NEXT_PUBLIC_WHATSAPP_ENGINE_URL || "").trim().replace(/\/$/, "");

  try {
    const raw = (configured || engineUrl || page.origin).trim() || page.origin;
    let url = new URL(raw, page.origin);
    const host = url.hostname.toLowerCase();
    const loopbackFromRemote =
      isLoopbackHost(host) && !isLoopbackHost(page.hostname);

    if (isBrowserUnreachableHost(host) || loopbackFromRemote) {
      url = new URL(page.origin);
    }

    if (pageIsHttps) {
      url.protocol = "https:";
      // TLS público costuma estar só em 443 — não forçar :4000 no domínio do site.
      if (url.port === "4000" || url.port === "80" || url.port === "3000") {
        url.port = "";
      }
      if (isBrowserUnreachableHost(url.hostname)) {
        url = new URL(page.origin);
      }
    }

    return url.origin;
  } catch {
    return page.origin;
  }
}

export function engineSocketOptions(token: string, extra: Record<string, unknown> = {}) {
  return {
    path: "/socket.io",
    addTrailingSlash: false,
    transports: ["polling", "websocket"] as ("websocket" | "polling")[],
    query: { token },
    ...extra,
  };
}

export type ConversationListRes = {
  tickets: HelpdeskConversation[];
  count: number;
  hasMore: boolean;
};

export type MessageListRes = {
  messages: HelpdeskMessage[];
  ticket?: HelpdeskConversation;
  count?: number;
  hasMore?: boolean;
};

export type OverviewRes = {
  summary?: {
    active?: number;
    pending?: number;
    newMessages?: number;
    returns?: number;
  };
};

export type ConnectionPayload = {
  name: string;
  queueIds: number[];
  greetingMessage?: string;
  complationMessage?: string;
  outOfHoursMessage?: string;
  isDefault?: boolean;
};

export type QueuePayload = {
  name: string;
  color: string;
  greetingMessage?: string;
  outOfHoursMessage?: string;
  attachToConnections?: boolean;
  schedules?: QueueSchedule[];
};

export type TransferPayload = {
  userId?: number | null;
  queueId?: number | null;
  status?: string;
};

export type HelpdeskAiSource = {
  id?: number | string;
  source_id?: number;
  source_type?: "knowledge_article" | "ticket" | string;
  title?: string;
  name?: string;
  type?: string;
  snippet?: string;
  score?: number;
  url?: string;
  href?: string;
  ticket_id?: number;
  knowledge_id?: number;
  article_id?: number;
  category_id?: number;
  metadata?: {
    ticket_id?: number;
    knowledge_id?: number;
    article_id?: number;
    category_id?: number;
    title?: string;
  };
};

export type HelpdeskAiDraftRes = {
  draft: string;
  sources?: HelpdeskAiSource[];
};

export type HelpdeskAiTicketDraft = {
  title: string;
  description: string;
  solicitante: string;
  clientQuery: string;
  external_client_id?: number | null;
  external_client_name?: string | null;
};

export type HelpdeskContactClientLink = {
  id: number;
  engine_contact_id: number;
  contact_number?: string | null;
  external_client_id: number;
  external_client_name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type HelpdeskContactClientLinkRes = {
  linked: boolean;
  link: HelpdeskContactClientLink | null;
  ok?: boolean;
};

export type HelpdeskAiTicketRes = {
  ticket: HelpdeskAiTicketDraft;
  sources?: HelpdeskAiSource[];
};

export function unwrapMessages(
  data: MessageListRes | { rows?: HelpdeskMessage[] } | HelpdeskMessage[] | null | undefined,
): HelpdeskMessage[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ("messages" in data && Array.isArray(data.messages)) return data.messages;
  if ("rows" in data && Array.isArray(data.rows)) return data.rows;
  return [];
}

/** Reescreve URL interna do engine (whatsapp-engine:4000/public/...) para o proxy Flask. */
export function publicMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw || /nopicture/i.test(raw)) return null;
  if (raw.includes("/helpdesk/api/media/")) {
    const idx = raw.indexOf("/helpdesk/api/media/");
    return `/flask${raw.slice(idx)}`;
  }
  const publicIdx = raw.indexOf("/public/");
  if (publicIdx >= 0) {
    const path = raw.slice(publicIdx + "/public/".length).split(/[?#]/)[0];
    if (!path || path.split("/").includes("..")) return null;
    return `/flask/helpdesk/api/media/${path}`;
  }
  if (raw.startsWith("public/")) {
    return `/flask/helpdesk/api/media/${raw.slice("public/".length).split(/[?#]/)[0]}`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw;
}

export const helpdesk = {
  health: () => flask.get<{ ok: boolean; error?: string; engine?: { ok?: boolean } }>("/helpdesk/api/health"),
  token: () => flask.get<EngineSession>("/helpdesk/api/engine-token"),
  overview: () => flask.get<OverviewRes>("/helpdesk/api/overview"),
  conversations: (status: HelpdeskTab, page = "1", search = "", queueIds?: number[]) => {
    const q = new URLSearchParams({ status, showAll: "true", pageNumber: page });
    if (search.trim()) q.set("searchParam", search.trim());
    if (queueIds?.length) q.set("queueIds", JSON.stringify(queueIds));
    return flask.get<ConversationListRes>(`/helpdesk/api/conversations?${q}`);
  },
  conversation: (id: number) => flask.get<HelpdeskConversation>(`/helpdesk/api/conversations/${id}`),
  messages: (id: number, page = "1") =>
    flask.get<MessageListRes>(`/helpdesk/api/conversations/${id}/messages?pageNumber=${page}`),
  send: (id: number, body: string, opts?: { isInternal?: boolean }) =>
    flask.post(`/helpdesk/api/conversations/${id}/messages`, {
      body,
      isInternal: !!opts?.isInternal,
    }),
  sendMedia: (id: number, file: File, body = "") => {
    const form = new FormData();
    form.append("medias", file);
    form.append("body", body);
    return flask.post(`/helpdesk/api/conversations/${id}/messages`, form);
  },
  assume: (id: number) => flask.put<HelpdeskConversation>(`/helpdesk/api/conversations/${id}/assume`),
  pending: (id: number) => flask.put<HelpdeskConversation>(`/helpdesk/api/conversations/${id}/pending`),
  resolve: (id: number) => flask.put<HelpdeskConversation>(`/helpdesk/api/conversations/${id}/resolve`),
  reopen: (id: number) => flask.put<HelpdeskConversation>(`/helpdesk/api/conversations/${id}/reopen`),
  resendRating: (id: number) =>
    flask.post<{ message: string; rating: HelpdeskRating }>(`/helpdesk/api/conversations/${id}/rating/resend`),
  ratingSummary: () => flask.get<HelpdeskRatingSummary>("/helpdesk/api/ratings/summary"),
  transfer: (id: number, payload: TransferPayload) =>
    flask.put<HelpdeskConversation>(`/helpdesk/api/conversations/${id}/transfer`, payload),
  assignees: () => flask.get<HelpdeskAssignee[]>("/helpdesk/api/assignees"),
  quickMessages: () => flask.get<QuickMessage[] | { records?: QuickMessage[] }>("/helpdesk/api/quick-messages"),
  createQuickMessage: (payload: { shortcode: string; message: string }) =>
    flask.post<QuickMessage>("/helpdesk/api/quick-messages", payload),
  updateQuickMessage: (id: number, payload: { shortcode: string; message: string }) =>
    flask.put<QuickMessage>(`/helpdesk/api/quick-messages/${id}`, payload),
  deleteQuickMessage: (id: number) => flask.delete(`/helpdesk/api/quick-messages/${id}`),
  contact: (id: number) => flask.get<HelpdeskContactDetail>(`/helpdesk/api/contacts/${id}`),
  updateContact: (id: number, payload: { name?: string; email?: string; extraInfo?: { id?: number; name?: string; value?: string }[] }) =>
    flask.put<HelpdeskContactDetail>(`/helpdesk/api/contacts/${id}`, payload),
  contactClientLink: (id: number) =>
    flask.get<HelpdeskContactClientLinkRes>(`/helpdesk/api/contacts/${id}/client-link`),
  upsertContactClientLink: (
    id: number,
    payload: { external_client_id: number; external_client_name: string; contact_number?: string },
  ) => flask.put<HelpdeskContactClientLinkRes>(`/helpdesk/api/contacts/${id}/client-link`, payload),
  deleteContactClientLink: (id: number) =>
    flask.delete<HelpdeskContactClientLinkRes>(`/helpdesk/api/contacts/${id}/client-link`),
  linkTicket: (id: number, ticketId: number) =>
    flask.post(`/helpdesk/api/conversations/${id}/link-ticket`, { ticket_id: ticketId }),
  aiQuery: (question: string, conversationId?: number | null) =>
    flask.post<HelpdeskAiDraftRes>("/helpdesk/api/ai/query", {
      question,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  aiSuggestReply: (id: number) =>
    flask.post<HelpdeskAiDraftRes>(`/helpdesk/api/conversations/${id}/ai/suggest-reply`),
  aiImprove: (id: number, text: string) =>
    flask.post<HelpdeskAiDraftRes>(`/helpdesk/api/conversations/${id}/ai/improve`, { text }),
  aiSuggestTicket: (id: number) =>
    flask.post<HelpdeskAiTicketRes>(`/helpdesk/api/conversations/${id}/ai/suggest-ticket`),
  connections: () => flask.get<HelpdeskConnection[] | { whatsapps?: HelpdeskConnection[] }>("/helpdesk/api/connections"),
  connection: (id: number) => flask.get<HelpdeskConnection>(`/helpdesk/api/connections/${id}`),
  createConnection: (payload: ConnectionPayload) => flask.post<HelpdeskConnection>("/helpdesk/api/connections", payload),
  updateConnection: (id: number, payload: ConnectionPayload) =>
    flask.put<HelpdeskConnection>(`/helpdesk/api/connections/${id}`, payload),
  startSession: (id: number) => flask.post(`/helpdesk/api/connections/${id}/session`),
  restartSession: (id: number) => flask.put(`/helpdesk/api/connections/${id}/session`),
  logoutSession: (id: number) => flask.delete(`/helpdesk/api/connections/${id}/session`),
  deleteConnection: (id: number) => flask.delete(`/helpdesk/api/connections/${id}`),
  queues: () => flask.get<HelpdeskQueue[]>("/helpdesk/api/queues"),
  createQueue: (payload: QueuePayload) => flask.post<HelpdeskQueue>("/helpdesk/api/queues", payload),
  updateQueue: (id: number, payload: QueuePayload) => flask.put<HelpdeskQueue>(`/helpdesk/api/queues/${id}`, payload),
  deleteQueue: (id: number) => flask.delete(`/helpdesk/api/queues/${id}`),
  agents: () => flask.get<HelpdeskAgent[]>("/helpdesk/api/agents"),
  updateAgentQueues: (userId: number, queueIds: number[]) =>
    flask.put<HelpdeskAgent>(`/helpdesk/api/agents/${userId}`, { queueIds }),
};

export function unwrapConnections(
  data: HelpdeskConnection[] | { whatsapps?: HelpdeskConnection[] } | { id?: number } | null | undefined,
): HelpdeskConnection[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ("whatsapps" in data && Array.isArray(data.whatsapps)) return data.whatsapps;
  if ("id" in data && data.id) return [data as HelpdeskConnection];
  return [];
}

export function unwrapQuickMessages(
  data: QuickMessage[] | { records?: QuickMessage[] } | null | undefined,
): QuickMessage[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.records || [];
}
