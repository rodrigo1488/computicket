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

export type HelpdeskConversationHistoryItem = {
  id: number;
  status?: string;
  lastMessage?: string | null;
  updatedAt?: string;
  rating?: HelpdeskRating | null;
  computicket_ticket_id?: number | null;
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
  history?: HelpdeskConversationHistoryItem[];
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
  isEdited?: boolean;
  isPrivate?: boolean;
  isInternal?: boolean;
  quotedMsg?: HelpdeskMessage | null;
  transcription?: string | null;
  transcriptionStatus?: "pending" | "completed" | "failed" | string | null;
  transcriptionError?: string | null;
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
 * prefere same-origin (proxy Next `/engine-sio` → whatsapp-engine).
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

export function isEngineSocketSameOrigin(socketUrl: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return new URL(socketUrl).origin === window.location.origin;
  } catch {
    return true;
  }
}

export function engineSocketOptions(token: string, extra: Record<string, unknown> = {}) {
  const sameOrigin = extra.sameOrigin !== false;
  const rest = { ...extra };
  delete rest.sameOrigin;
  const path = sameOrigin ? "/engine-sio" : "/socket.io";
  return {
    // Same-origin: path sem `.io` (Next 404 em `/socket.io` como arquivo estático).
    path,
    addTrailingSlash: false,
    // Rewrite do Next faz polling HTTP; o upgrade para websocket
    // costuma “conectar” sem entregar eventos (só a 1ª mensagem aparece).
    transports: (sameOrigin ? ["polling"] : ["websocket", "polling"]) as ("websocket" | "polling")[],
    upgrade: !sameOrigin,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 20_000,
    query: { token },
    ...rest,
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
  source_type?: "knowledge_article" | "ticket" | "password_vault" | "budget" | string;
  title?: string;
  name?: string;
  type?: string;
  snippet?: string;
  score?: number;
  url?: string;
  href?: string;
  ticket_id?: number;
  client_id?: number;
  knowledge_id?: number;
  article_id?: number;
  category_id?: number;
  metadata?: {
    ticket_id?: number;
    client_id?: number;
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

/** WhatsApp recusa documentos acima disso; vídeos “na conversa” só até ~16 MB. */
export const HELPDESK_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export function helpdeskMediaSizeError(file: File): string | null {
  if (file.size <= HELPDESK_MAX_MEDIA_BYTES) return null;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return `Arquivo muito grande (${mb} MB). O WhatsApp aceita no máximo 100 MB.`;
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
  conversationHistory: (id: number) =>
    flask.get<{ history: HelpdeskConversationHistoryItem[] }>(`/helpdesk/api/conversations/${id}/history`),
  messages: (id: number, page = "1") =>
    flask.get<MessageListRes>(`/helpdesk/api/conversations/${id}/messages?pageNumber=${page}`),
  send: (id: number, body: string, opts?: { isInternal?: boolean; quotedMsg?: { id: string } }) =>
    flask.post(`/helpdesk/api/conversations/${id}/messages`, {
      body,
      isInternal: !!opts?.isInternal,
      ...(opts?.quotedMsg ? { quotedMsg: opts.quotedMsg } : {}),
    }),
  sendMedia: (id: number, file: File, body = "", quotedMsgId?: string) => {
    const form = new FormData();
    form.append("medias", file);
    form.append("body", body);
    if (quotedMsgId) form.append("quotedMsg", JSON.stringify({ id: quotedMsgId }));
    return flask.post(`/helpdesk/api/conversations/${id}/messages`, form);
  },
  edit: (id: number, messageId: string, body: string) =>
    flask.put(`/helpdesk/api/conversations/${id}/messages/${encodeURIComponent(messageId)}`, { body }),
  remove: (id: number, messageId: string) =>
    flask.delete(`/helpdesk/api/conversations/${id}/messages/${encodeURIComponent(messageId)}`),
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
  contacts: (opts?: { search?: string; pageNumber?: number }) => {
    const q = new URLSearchParams();
    if (opts?.search?.trim()) q.set("searchParam", opts.search.trim());
    if (opts?.pageNumber) q.set("pageNumber", String(opts.pageNumber));
    const qs = q.toString();
    return flask.get<{ contacts: HelpdeskContact[]; count: number; hasMore: boolean }>(
      `/helpdesk/api/contacts${qs ? `?${qs}` : ""}`,
    );
  },
  createContact: (payload: { name: string; number: string; email?: string }) =>
    flask.post<HelpdeskContactDetail>("/helpdesk/api/contacts", payload),
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
  startConversation: (payload: { contactId: number; queueId?: number; whatsappId?: number }) =>
    flask.post<HelpdeskConversation>("/helpdesk/api/conversations", payload),
  linkTicket: (id: number, ticketId: number) =>
    flask.post<{ ok: boolean; engine_ticket_id: number; computicket_ticket_id: number }>(
      `/helpdesk/api/conversations/${id}/link-ticket`,
      { ticket_id: ticketId },
    ),
  aiQuery: (question: string, conversationId?: number | null) =>
    flask.post<HelpdeskAiDraftRes>("/helpdesk/api/ai/query", {
      question,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  /** Chat RAG do dashboard: histórico curto da sessão + knowledge_chunk. */
  aiChat: (
    question: string,
    history?: { role: "user" | "assistant"; content: string }[],
  ) =>
    flask.post<HelpdeskAiDraftRes>("/helpdesk/api/ai/chat", {
      question,
      ...(history?.length ? { history } : {}),
    }),
  aiSuggestReply: (id: number) =>
    flask.post<HelpdeskAiDraftRes>(`/helpdesk/api/conversations/${id}/ai/suggest-reply`),
  aiImprove: (id: number, text: string) =>
    flask.post<HelpdeskAiDraftRes>(`/helpdesk/api/conversations/${id}/ai/improve`, { text }),
  aiSuggestTicket: (id: number) =>
    flask.post<HelpdeskAiTicketRes>(`/helpdesk/api/conversations/${id}/ai/suggest-ticket`),
  transcribeMessage: (conversationId: number, messageId: string, force = false) =>
    flask.post<{ transcription?: string; messageId: string; cached?: boolean; skipped?: boolean }>(
      `/helpdesk/api/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}/transcribe`,
      { force },
    ),
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
