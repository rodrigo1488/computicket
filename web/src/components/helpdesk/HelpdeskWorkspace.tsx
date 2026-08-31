"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  FilePlus2,
  Hand,
  History,
  LoaderCircle,
  Lock,
  MoreVertical,
  Paperclip,
  PenLine,
  RotateCcw,
  Search,
  Send,
  Settings,
  Smile,
  Star,
  Ticket,
  Undo2,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CloseTicketDialog } from "@/components/tickets/CloseTicketDialog";
import { TicketCreateDialog } from "@/components/tickets/TicketCreateDialog";
import { TimeEntryDialog } from "@/components/tickets/TimeEntryDialog";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { Modal } from "@/components/ui/Modal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import type { TicketDetail } from "@/lib/format";
import {
  helpdesk,
  publicMediaUrl,
  engineSocketOptions,
  resolveEngineSocketUrl,
  unwrapConnections,
  unwrapMessages,
  unwrapQuickMessages,
  type ConversationListRes,
  type EngineSession,
  type HelpdeskAiSource,
  type HelpdeskAiTicketDraft,
  type HelpdeskContactClientLink,
  type HelpdeskConversation,
  type HelpdeskConversationHistoryItem,
  type HelpdeskMessage,
  type HelpdeskTab,
  type QuickMessage,
  type TransferPayload,
} from "@/lib/helpdesk";

const TAB_META: { key: HelpdeskTab; label: string }[] = [
  { key: "pending", label: "Aguardando" },
  { key: "open", label: "Abertas" },
  { key: "closed", label: "Finalizadas" },
];

const FILTER_KEY = "computicket.helpdesk.filters";
const SIGN_KEY = "computicket.helpdesk.sign";

type AiResult =
  | { kind: "text"; title: string; draft: string; sources: HelpdeskAiSource[] }
  | { kind: "ticket"; title: string; ticket: HelpdeskAiTicketDraft; sources: HelpdeskAiSource[] };

function formatClock(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function contactName(c?: HelpdeskConversation | null) {
  return c?.contact?.name || c?.contact?.number || "Contato";
}

function ticketDefaultsFromConversation(
  conversation?: HelpdeskConversation | null,
  link?: HelpdeskContactClientLink | null,
  base?: Partial<HelpdeskAiTicketDraft> | null,
): HelpdeskAiTicketDraft {
  const solicitante = (base?.solicitante || contactName(conversation)).trim();
  const linkedName = link?.external_client_name?.trim() || "";
  return {
    title: base?.title || `WhatsApp ${contactName(conversation)}`,
    description: base?.description ?? (snippet(conversation?.lastMessage) || ""),
    solicitante,
    clientQuery: linkedName || base?.clientQuery || solicitante,
    external_client_id: link?.external_client_id ?? base?.external_client_id ?? null,
    external_client_name: linkedName || base?.external_client_name || null,
  };
}

function snippet(text?: string | null) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 90);
}

function withAgentSignature(body: string, name?: string | null, enabled?: boolean, isInternal?: boolean) {
  const text = body.trim();
  const agent = name?.trim();
  if (!enabled || !agent || isInternal || !text) return text;
  return `*${agent.toUpperCase()}*\n${text}`;
}

function statusChip(c: HelpdeskConversation) {
  if (c.status === "pending" || (c.unreadMessages || 0) > 0) {
    return { label: "Aguardando resposta", className: "bg-[#fff3e0] text-[#e67e22]" };
  }
  if (c.status === "closed") return { label: "Finalizada", className: "bg-[#f3f4f6] text-muted" };
  return { label: "Em atendimento", className: "bg-progress-bg text-progress" };
}

function asTab(raw: string | null): HelpdeskTab {
  if (raw === "open" || raw === "pending" || raw === "closed") return raw;
  return "pending";
}

function isTempMessageId(id?: string | null) {
  return !!id && String(id).startsWith("temp-");
}

function sameInternalFlags(a: HelpdeskMessage, b: HelpdeskMessage) {
  return !!(a.isInternal || a.isPrivate) === !!(b.isInternal || b.isPrivate);
}

function normalizeMessageBody(value?: string | null) {
  return (value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function isMediaMessage(m: HelpdeskMessage) {
  if (m.mediaUrl) return true;
  const t = (m.mediaType || "").toLowerCase();
  if (!t || t === "conversation" || t === "chat") return false;
  return /^(image|audio|video|application|document|sticker|ptt)/.test(t);
}

type AppMessagePayload = {
  ticket?: { id?: number | string } | null;
  message?: (HelpdeskMessage & { ticketId?: number | string; ticket?: { id?: number | string } | null }) | null;
};

function resolveAppMessageTicketId(payload: AppMessagePayload): number | null {
  const raw =
    payload.ticket?.id ?? payload.message?.ticketId ?? payload.message?.ticket?.id ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function conversationUpdatedAtMs(c: HelpdeskConversation) {
  return Date.parse(c.updatedAt || "") || 0;
}

/** Não lidas primeiro; dentro do grupo, mais recentes no topo. */
function sortInboxConversations(rows: HelpdeskConversation[]) {
  return [...rows].sort((a, b) => {
    const unreadA = a.unreadMessages || 0;
    const unreadB = b.unreadMessages || 0;
    const hasUnreadA = unreadA > 0;
    const hasUnreadB = unreadB > 0;
    if (hasUnreadA !== hasUnreadB) return hasUnreadB ? 1 : -1;
    if (unreadA !== unreadB) return unreadB - unreadA;
    return conversationUpdatedAtMs(b) - conversationUpdatedAtMs(a);
  });
}

function applyLinkedTicketId(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: number,
  ticketId: number,
) {
  qc.setQueryData<HelpdeskConversation>(["hd-conversation", conversationId], (prev) =>
    prev ? { ...prev, computicket_ticket_id: ticketId } : prev,
  );
  patchConversationInLists(qc, conversationId, (row) => ({
    ...row,
    computicket_ticket_id: ticketId,
  }));
}

function patchConversationInLists(
  qc: ReturnType<typeof useQueryClient>,
  ticketId: number,
  patch: (row: HelpdeskConversation) => HelpdeskConversation,
) {
  const apply = (prev: ConversationListRes | undefined) => {
    if (!prev?.tickets?.length) return prev;
    let changed = false;
    const tickets = prev.tickets.map((row) => {
      if (row.id !== ticketId) return row;
      changed = true;
      return patch(row);
    });
    if (!changed) return prev;
    return { ...prev, tickets: sortInboxConversations(tickets) };
  };
  qc.setQueriesData<ConversationListRes>({ queryKey: ["hd-list"] }, apply);
  qc.setQueriesData<ConversationListRes>({ queryKey: ["hd-list-counts"] }, apply);
}

function messageLooksSettled(real: HelpdeskMessage, pending: HelpdeskMessage) {
  if (isTempMessageId(real.id)) return false;
  if (!!real.fromMe !== !!pending.fromMe) return false;
  if (!sameInternalFlags(real, pending)) return false;
  if (isMediaMessage(real) !== isMediaMessage(pending)) return false;
  if (isMediaMessage(pending)) return true;
  return normalizeMessageBody(real.body) === normalizeMessageBody(pending.body);
}

/** GET assíncrono ainda não traz o que o socket/otimista já mostrou — não descartar. */
function retainOptimisticMessages(fetched: HelpdeskMessage[], previous?: HelpdeskMessage[]) {
  if (!previous?.length) return fetched;
  const fetchedIds = new Set(fetched.map((m) => String(m.id)));
  const extras: HelpdeskMessage[] = [];
  for (const pending of previous) {
    const id = String(pending.id);
    if (fetchedIds.has(id)) continue;
    if (isTempMessageId(id)) {
      if (!fetched.some((m) => messageLooksSettled(m, pending))) extras.push(pending);
      continue;
    }
    extras.push(pending);
  }
  return extras.length ? [...fetched, ...extras] : fetched;
}

function replaceMessageAt(current: HelpdeskMessage[], idx: number, nextMsg: HelpdeskMessage) {
  const copy = [...current];
  const prevUrl = copy[idx].mediaUrl;
  if (prevUrl?.startsWith("blob:") && prevUrl !== nextMsg.mediaUrl) URL.revokeObjectURL(prevUrl);
  copy[idx] = { ...copy[idx], ...nextMsg };
  return copy;
}

/** Insere/substitui mensagem no thread sem duplicar (id real ou placeholder temp-). */
function mergeMessageIntoThread(prev: HelpdeskMessage[] | undefined, incoming: HelpdeskMessage): HelpdeskMessage[] {
  const current = prev || [];
  const incomingId = incoming.id != null ? String(incoming.id) : "";
  if (!incomingId || incomingId === "undefined" || incomingId === "null") {
    return current;
  }
  const nextMsg: HelpdeskMessage = {
    id: incomingId,
    body: incoming.body,
    fromMe: incoming.fromMe,
    createdAt: incoming.createdAt,
    ack: incoming.ack,
    mediaType: incoming.mediaType,
    mediaUrl: publicMediaUrl(incoming.mediaUrl) || incoming.mediaUrl,
    isInternal: incoming.isInternal,
    isPrivate: incoming.isPrivate,
    quotedMsg: incoming.quotedMsg,
    isDeleted: incoming.isDeleted,
  };
  const byId = current.findIndex((m) => String(m.id) === nextMsg.id);
  if (byId >= 0) return replaceMessageAt(current, byId, nextMsg);

  if (!isTempMessageId(nextMsg.id)) {
    const textTempExact = current.findIndex(
      (m) =>
        isTempMessageId(m.id) &&
        !!m.fromMe === !!nextMsg.fromMe &&
        sameInternalFlags(m, nextMsg) &&
        !isMediaMessage(m) &&
        !isMediaMessage(nextMsg) &&
        normalizeMessageBody(m.body) === normalizeMessageBody(nextMsg.body),
    );
    if (textTempExact >= 0) return replaceMessageAt(current, textTempExact, nextMsg);

    if (isMediaMessage(nextMsg)) {
      const mediaTemp = current.findIndex(
        (m) =>
          isTempMessageId(m.id) &&
          !!m.fromMe === !!nextMsg.fromMe &&
          sameInternalFlags(m, nextMsg) &&
          isMediaMessage(m),
      );
      if (mediaTemp >= 0) return replaceMessageAt(current, mediaTemp, nextMsg);
    }
  }

  return [...current, nextMsg];
}

function extractSentMessage(data: unknown): HelpdeskMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.message && typeof d.message === "object" && !Array.isArray(d.message)) {
    return extractSentMessage(d.message);
  }
  const looksLikeTicket = d.status != null && (d.queueId != null || d.contact != null || d.unreadMessages != null);
  if (looksLikeTicket) return null;
  const body = typeof d.body === "string" ? d.body : undefined;
  const hasMedia = d.mediaUrl != null || d.mediaType != null;
  if (d.id == null || (!body && !hasMedia)) return null;
  return {
    id: String(d.id),
    body,
    fromMe: d.fromMe !== false,
    mediaUrl: (d.mediaUrl as string | null | undefined) ?? null,
    mediaType: (d.mediaType as string | null | undefined) ?? null,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : undefined,
    ack: typeof d.ack === "number" ? d.ack : undefined,
    isInternal: !!(d.isInternal || d.isPrivate),
    isPrivate: !!(d.isPrivate || d.isInternal),
    quotedMsg: (d.quotedMsg as HelpdeskMessage | null | undefined) ?? null,
  };
}

type MessagesCache = { messages?: HelpdeskMessage[]; [key: string]: unknown };

function readStoredFilters() {
  if (typeof window === "undefined") {
    return { queues: [] as number[], unassigned: true, unassignedOnly: false, mine: false };
  }
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return { queues: [] as number[], unassigned: true, unassignedOnly: false, mine: false };
    const parsed = JSON.parse(raw) as {
      queues?: number[];
      unassigned?: boolean;
      unassignedOnly?: boolean;
      mine?: boolean;
    };
    return {
      queues: Array.isArray(parsed.queues) ? parsed.queues.map(Number).filter((n) => Number.isFinite(n)) : [],
      unassigned: parsed.unassigned !== false,
      unassignedOnly: parsed.unassignedOnly === true,
      mine: parsed.mine === true,
    };
  } catch {
    return { queues: [] as number[], unassigned: true, unassignedOnly: false, mine: false };
  }
}

function isAssignedToEngineUser(c: HelpdeskConversation, engineUserId?: number | null) {
  if (!engineUserId) return false;
  if (c.userId != null && Number(c.userId) === engineUserId) return true;
  if (c.user?.id != null && Number(c.user.id) === engineUserId) return true;
  return false;
}

function applyQueueVisibility(
  rows: HelpdeskConversation[],
  selectedQueues: number[],
  includeUnassigned: boolean,
  unassignedOnly = false,
) {
  if (unassignedOnly) return rows.filter((t) => t.queueId == null);
  if (selectedQueues.length && includeUnassigned) return rows;
  if (selectedQueues.length && !includeUnassigned) return rows.filter((t) => t.queueId != null);
  if (!selectedQueues.length && !includeUnassigned) return rows.filter((t) => t.queueId != null);
  return rows;
}

export function HelpdeskWorkspace() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());

  const [tab, setTab] = useState<HelpdeskTab>(() => asTab(params.get("status")));
  const [activeId, setActiveId] = useState<number | null>(() => {
    const raw = Number(params.get("c") || params.get("conversation") || "");
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  });
  const [selectedQueues, setSelectedQueues] = useState<number[]>(() =>
    (params.get("queues") || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  const [includeUnassigned, setIncludeUnassigned] = useState(() => {
    const raw = params.get("unassigned");
    return raw !== "0" && raw !== "only";
  });
  const [unassignedOnly, setUnassignedOnly] = useState(() => params.get("unassigned") === "only");
  const [mineOnly, setMineOnly] = useState(() => params.get("mine") === "1");
  const [search, setSearch] = useState(() => params.get("q") || "");
  const [filtersReady, setFiltersReady] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const [linkedTicket, setLinkedTicket] = useState<TicketDetail | null>(null);
  const [closeTicketOpen, setCloseTicketOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"stop" | "add" | null>(null);
  const [ticketFlowLoading, setTicketFlowLoading] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeQuestion, setKnowledgeQuestion] = useState("");
  const [aiAction, setAiAction] = useState<"reply" | "improve" | "query" | "ticket" | null>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<HTMLElement | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ticketDefaults, setTicketDefaults] = useState<HelpdeskAiTicketDraft | null>(null);
  const [historyViewId, setHistoryViewId] = useState<number | null>(null);
  const [sign, setSign] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SIGN_KEY) !== "0";
  });
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const pendingResolveChatId = useRef<number | null>(null);
  const entryContinueRef = useRef(false);
  const justLinkedTicketId = useRef<number | null>(null);
  const [linkedFallback, setLinkedFallback] = useState<{ conversationId: number; ticketId: number } | null>(
    null,
  );
  activeIdRef.current = activeId;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (params.get("queues") || params.get("unassigned") || params.get("mine")) {
      setFiltersReady(true);
      return;
    }
    const stored = readStoredFilters();
    if (stored.queues.length) setSelectedQueues(stored.queues);
    setIncludeUnassigned(stored.unassignedOnly ? true : stored.unassigned);
    setUnassignedOnly(stored.unassignedOnly);
    setMineOnly(stored.mine);
    setFiltersReady(true);
    // URL vazia: hidrata do localStorage só no cliente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    const q = new URLSearchParams();
    q.set("status", tab);
    if (selectedQueues.length) q.set("queues", selectedQueues.join(","));
    if (unassignedOnly) q.set("unassigned", "only");
    else if (!includeUnassigned) q.set("unassigned", "0");
    if (mineOnly) q.set("mine", "1");
    if (debouncedSearch.trim()) q.set("q", debouncedSearch.trim());
    if (activeId) q.set("c", String(activeId));
    router.replace(`/helpdesk?${q}`, { scroll: false });
    window.localStorage.setItem(
      FILTER_KEY,
      JSON.stringify({
        queues: selectedQueues,
        unassigned: includeUnassigned,
        unassignedOnly,
        mine: mineOnly,
      }),
    );
  }, [
    tab,
    selectedQueues,
    includeUnassigned,
    unassignedOnly,
    mineOnly,
    debouncedSearch,
    activeId,
    router,
    filtersReady,
  ]);

  useEffect(() => {
    window.localStorage.setItem(SIGN_KEY, sign ? "1" : "0");
  }, [sign]);

  useEffect(() => {
    setAiResult(null);
    setAiError(null);
    setKnowledgeOpen(false);
    setTicketDefaults(null);
    justLinkedTicketId.current = null;
    setLinkedFallback(null);
    setHistoryViewId(null);
  }, [activeId]);

  const health = useQuery({ queryKey: ["hd-health"], queryFn: helpdesk.health, retry: 1 });
  const session = useQuery({
    queryKey: ["hd-engine-token"],
    queryFn: helpdesk.token,
    enabled: !!health.data?.ok,
    refetchInterval: 8 * 60 * 1000,
  });

  const overview = useQuery({
    queryKey: ["hd-overview"],
    queryFn: helpdesk.overview,
    enabled: !!health.data?.ok,
    refetchInterval: 15000,
  });

  const queues = useQuery({
    queryKey: ["hd-queues"],
    queryFn: helpdesk.queues,
    enabled: !!health.data?.ok,
  });

  const connections = useQuery({
    queryKey: ["hd-connections"],
    queryFn: async () => unwrapConnections(await helpdesk.connections()),
    enabled: !!health.data?.ok,
    refetchInterval: 20000,
  });

  const assignees = useQuery({
    queryKey: ["hd-assignees"],
    queryFn: helpdesk.assignees,
    enabled: !!health.data?.ok,
  });

  const quicks = useQuery({
    queryKey: ["hd-quick-messages"],
    queryFn: async () => unwrapQuickMessages(await helpdesk.quickMessages()),
    enabled: !!health.data?.ok,
  });

  const countSource = useQuery({
    queryKey: ["hd-list-counts", tab, debouncedSearch],
    queryFn: () => helpdesk.conversations(tab, "1", debouncedSearch),
    enabled: !!health.data?.ok,
    refetchInterval: 15000,
  });

  const list = useQuery({
    queryKey: ["hd-list", tab, selectedQueues, includeUnassigned, debouncedSearch],
    queryFn: () =>
      helpdesk.conversations(tab, "1", debouncedSearch, selectedQueues.length ? selectedQueues : undefined),
    enabled: !!health.data?.ok && !mineOnly,
    refetchInterval: 12000,
  });

  const minePending = useQuery({
    queryKey: ["hd-list", "mine-pending", selectedQueues, includeUnassigned, debouncedSearch],
    queryFn: () =>
      helpdesk.conversations(
        "pending",
        "1",
        debouncedSearch,
        selectedQueues.length ? selectedQueues : undefined,
      ),
    enabled: !!health.data?.ok,
    refetchInterval: 12000,
  });

  const mineOpen = useQuery({
    queryKey: ["hd-list", "mine-open", selectedQueues, includeUnassigned, debouncedSearch],
    queryFn: () =>
      helpdesk.conversations("open", "1", debouncedSearch, selectedQueues.length ? selectedQueues : undefined),
    enabled: !!health.data?.ok,
    refetchInterval: 12000,
  });

  const conversation = useQuery({
    queryKey: ["hd-conversation", activeId],
    queryFn: async () => {
      const data = await helpdesk.conversation(activeId as number);
      const pendingId = justLinkedTicketId.current;
      if (!data.computicket_ticket_id && pendingId) {
        return { ...data, computicket_ticket_id: pendingId };
      }
      if (data.computicket_ticket_id) justLinkedTicketId.current = null;
      return data;
    },
    enabled: !!activeId,
  });

  useEffect(() => {
    const status = conversation.data?.status;
    if (status === "open" || status === "pending" || status === "closed") setTab(status);
  }, [conversation.data?.id, conversation.data?.status]);

  useEffect(() => {
    const convId = conversation.data?.id;
    const ticketId = conversation.data?.computicket_ticket_id;
    if (convId && ticketId) {
      setLinkedFallback({ conversationId: convId, ticketId });
    }
  }, [conversation.data?.id, conversation.data?.computicket_ticket_id]);

  const messages = useQuery({
    queryKey: ["hd-messages", activeId],
    queryFn: async () => {
      const ticketId = activeId as number;
      const res = await helpdesk.messages(ticketId);
      const fetched = unwrapMessages(res);
      const prev = qc.getQueryData<MessagesCache>(["hd-messages", ticketId]);
      return {
        ...res,
        messages: retainOptimisticMessages(fetched, prev?.messages),
      };
    },
    enabled: !!activeId,
    refetchOnMount: false,
    staleTime: 15_000,
  });

  const contactId = conversation.data?.contact?.id;
  const contact = useQuery({
    queryKey: ["hd-contact", contactId],
    queryFn: () => helpdesk.contact(contactId as number),
    enabled: !!contactId && contactOpen,
  });
  const contactClientLink = useQuery({
    queryKey: ["hd-contact-client-link", contactId],
    queryFn: () => helpdesk.contactClientLink(contactId as number),
    enabled: !!contactId,
  });

  const engineUserId = session.data?.engineUserId ?? null;

  const mineTickets = useMemo(() => {
    const byId = new Map<number, HelpdeskConversation>();
    for (const row of minePending.data?.tickets || []) byId.set(row.id, row);
    for (const row of mineOpen.data?.tickets || []) {
      if (isAssignedToEngineUser(row, engineUserId)) byId.set(row.id, row);
    }
    return sortInboxConversations(
      applyQueueVisibility([...byId.values()], selectedQueues, includeUnassigned, unassignedOnly),
    );
  }, [
    minePending.data?.tickets,
    mineOpen.data?.tickets,
    selectedQueues,
    includeUnassigned,
    unassignedOnly,
    engineUserId,
  ]);

  const tickets = useMemo(() => {
    if (mineOnly) return mineTickets;
    return sortInboxConversations(
      applyQueueVisibility(list.data?.tickets || [], selectedQueues, includeUnassigned, unassignedOnly),
    );
  }, [mineOnly, mineTickets, list.data?.tickets, selectedQueues, includeUnassigned, unassignedOnly]);

  const listIsError = mineOnly
    ? minePending.isError || mineOpen.isError
    : list.isError;
  const listErrorMessage = mineOnly
    ? ((minePending.error || mineOpen.error) as Error | null)?.message
    : (list.error as Error | null)?.message;

  const queueCounts = useMemo(() => {
    const map = new Map<number | "none", number>();
    for (const t of countSource.data?.tickets || []) {
      const key = t.queueId ?? "none";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [countSource.data?.tickets]);

  const counts = {
    open: overview.data?.summary?.active ?? list.data?.count ?? 0,
    pending: overview.data?.summary?.pending ?? 0,
    closed: 0,
  };
  if (tab === "open") counts.open = list.data?.count ?? counts.open;
  if (tab === "pending") counts.pending = list.data?.count ?? counts.pending;
  if (tab === "closed") counts.closed = list.data?.count ?? 0;

  const unread = overview.data?.summary?.newMessages || 0;
  const waitingReply = tickets.filter((t) => (t.unreadMessages || 0) > 0).length;
  const allSelected = selectedQueues.length === 0 && includeUnassigned && !unassignedOnly;
  const queueFilterValue = unassignedOnly
    ? "none"
    : selectedQueues.length >= 1
      ? String(selectedQueues[0])
      : "all";
  const selectedQueueMeta = (queues.data || []).find((q) => String(q.id) === queueFilterValue);
  const queueFilterCount = unassignedOnly
    ? (queueCounts.get("none") ?? 0)
    : selectedQueues.length >= 1
      ? (queueCounts.get(selectedQueues[0]) ?? 0)
      : (countSource.data?.tickets?.length ?? 0);
  const connected = (connections.data || []).some((c) => (c.status || "").toLowerCase() === "connected");
  const connectionLabel = connections.isError
    ? "Status da conexão indisponível"
    : connected
      ? "WhatsApp conectado"
      : (connections.data || []).length
        ? "WhatsApp desconectado"
        : "Sem conexão WhatsApp";

  const invalidateInbox = (id?: number) => {
    qc.invalidateQueries({ queryKey: ["hd-list"] });
    qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
    qc.invalidateQueries({ queryKey: ["hd-overview"] });
    qc.invalidateQueries({ queryKey: ["dashboard-helpdesk-ratings"] });
    if (id) {
      qc.invalidateQueries({ queryKey: ["hd-conversation", id] });
      qc.invalidateQueries({ queryKey: ["hd-messages", id] });
    }
  };

  const assume = useMutation({
    mutationFn: (id: number) => helpdesk.assume(id),
    onSuccess: (ticket) => {
      setTab("open");
      setActiveId(ticket.id);
      invalidateInbox(ticket.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const resolve = useMutation({
    mutationFn: (id: number) => helpdesk.resolve(id),
    onSuccess: (ticket) => {
      setActiveId(null);
      setTab("closed");
      invalidateInbox();
      if (ticket.rating_warning) setError(ticket.rating_warning);
    },
    onError: (e: Error) => setError(e.message),
  });
  const resendRating = useMutation({
    mutationFn: (id: number) => helpdesk.resendRating(id),
    onSuccess: (_, id) => {
      invalidateInbox(id);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const abortTicketCloseFlow = () => {
    pendingResolveChatId.current = null;
    entryContinueRef.current = false;
    setEntryMode(null);
    setCloseTicketOpen(false);
    setLinkedTicket(null);
  };

  const openCloseTicketFlow = async (conversationId: number, ticketId: number) => {
    setTicketFlowLoading(true);
    setError(null);
    try {
      const ticket = await flask.get<TicketDetail>(`/tickets/api/${ticketId}`);
      if (ticket.status === "fechado" || ticket.status === "cancelado") {
        if (window.confirm("Resolver esta conversa? O chamado vinculado já está encerrado.")) {
          resolve.mutate(conversationId);
        }
        return;
      }
      pendingResolveChatId.current = conversationId;
      setLinkedTicket(ticket);
      const entries = ticket.time_entries || [];
      if (ticket.status === "em_andamento") {
        setCloseTicketOpen(false);
        setEntryMode("stop");
      } else if (entries.length === 0) {
        setCloseTicketOpen(false);
        setEntryMode("add");
      } else {
        setEntryMode(null);
        setCloseTicketOpen(true);
      }
    } catch (e) {
      abortTicketCloseFlow();
      setError(e instanceof Error ? e.message : "Erro ao carregar chamado vinculado");
    } finally {
      setTicketFlowLoading(false);
    }
  };

  const handleResolverClick = () => {
    const conv = conversation.data;
    if (!conv || conv.status !== "open") return;
    const ticketId =
      conv.computicket_ticket_id ??
      (linkedFallback?.conversationId === conv.id ? linkedFallback.ticketId : null);
    if (!ticketId) {
      if (window.confirm("Resolver esta conversa?")) resolve.mutate(conv.id);
      return;
    }
    void openCloseTicketFlow(conv.id, ticketId);
  };

  const onLinkedTicketClosed = () => {
    const chatId = pendingResolveChatId.current;
    pendingResolveChatId.current = null;
    if (chatId) resolve.mutate(chatId);
  };
  const reopen = useMutation({
    mutationFn: (id: number) => helpdesk.reopen(id),
    onSuccess: (ticket) => {
      setTab(ticket?.status === "pending" ? "pending" : "open");
      if (ticket?.id) setActiveId(ticket.id);
      invalidateInbox(ticket?.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const giveBack = useMutation({
    mutationFn: (id: number) => helpdesk.pending(id),
    onSuccess: () => {
      setActiveId(null);
      setTab("pending");
      invalidateInbox();
    },
    onError: (e: Error) => setError(e.message),
  });
  const transfer = useMutation({
    mutationFn: (payload: TransferPayload) => helpdesk.transfer(activeId as number, payload),
    onSuccess: (ticket) => {
      setTransferOpen(false);
      if (ticket?.status === "pending") {
        setTab("pending");
        setActiveId(ticket.id);
      } else if (ticket?.id) {
        setTab("open");
        setActiveId(ticket.id);
      }
      invalidateInbox(ticket?.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const send = useMutation({
    mutationFn: (vars: { ticketId: number; body: string; isInternal: boolean; rawText: string }) =>
      helpdesk.send(vars.ticketId, vars.body, { isInternal: vars.isInternal }),
    onMutate: async (vars) => {
      // Limpa o draft antes do await para bloquear reenvio (Enter duplo) no mesmo ciclo.
      setText("");
      setIsInternal(false);
      setError(null);
      const previous = qc.getQueryData<MessagesCache>(["hd-messages", vars.ticketId]);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: HelpdeskMessage = {
        id: tempId,
        body: vars.body,
        fromMe: true,
        createdAt: new Date().toISOString(),
        ack: 0,
        ...(vars.isInternal ? { isInternal: true, isPrivate: true } : {}),
      };
      qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
        ...prev,
        messages: mergeMessageIntoThread(prev?.messages, optimistic),
      }));
      return { previous, ticketId: vars.ticketId, tempId, rawText: vars.rawText, wasInternal: vars.isInternal };
    },
    onSuccess: (data, vars, ctx) => {
      const sent = extractSentMessage(data);
      if (sent) {
        qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
          ...prev,
          messages: mergeMessageIntoThread(
            (prev?.messages || []).map((m) => (ctx?.tempId && m.id === ctx.tempId ? { ...m, ...sent } : m)),
            sent,
          ),
        }));
      }
      // Não invalidar hd-messages aqui: o POST costuma retornar antes do job persistir a msg.
      qc.invalidateQueries({ queryKey: ["hd-list"] });
      qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
      qc.invalidateQueries({ queryKey: ["hd-overview"] });
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous && ctx.ticketId) {
        qc.setQueryData(["hd-messages", ctx.ticketId], ctx.previous);
      }
      if (ctx?.rawText != null) setText(ctx.rawText);
      if (ctx?.wasInternal) setIsInternal(true);
      setError(e.message);
    },
  });
  const sendFile = useMutation({
    mutationFn: (vars: { ticketId: number; file: File; body: string; rawText: string }) =>
      helpdesk.sendMedia(vars.ticketId, vars.file, vars.body),
    onMutate: async (vars) => {
      setText("");
      setError(null);
      const previous = qc.getQueryData<MessagesCache>(["hd-messages", vars.ticketId]);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const mediaType = vars.file.type || "application/octet-stream";
      const objectUrl = mediaType.startsWith("image/") ? URL.createObjectURL(vars.file) : null;
      const optimistic: HelpdeskMessage = {
        id: tempId,
        body: vars.body || vars.file.name,
        fromMe: true,
        createdAt: new Date().toISOString(),
        ack: 0,
        mediaType,
        mediaUrl: objectUrl,
      };
      qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
        ...prev,
        messages: mergeMessageIntoThread(prev?.messages, optimistic),
      }));
      return { previous, ticketId: vars.ticketId, tempId, objectUrl, rawText: vars.rawText };
    },
    onSuccess: (data, vars) => {
      const sent = extractSentMessage(data);
      if (sent) {
        qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
          ...prev,
          messages: mergeMessageIntoThread(prev?.messages, sent),
        }));
      }
      // Media sync costuma persistir antes do 200; ainda assim evita refetch que apague o otimista.
      qc.invalidateQueries({ queryKey: ["hd-list"] });
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.objectUrl) URL.revokeObjectURL(ctx.objectUrl);
      if (ctx?.previous && ctx.ticketId) {
        qc.setQueryData(["hd-messages", ctx.ticketId], ctx.previous);
      }
      if (ctx?.rawText != null) setText(ctx.rawText);
      setError(e.message);
    },
  });
  const saveContact = useMutation({
    mutationFn: (payload: { name: string; email: string; notes: string }) => {
      const extras = [...(contact.data?.extraInfo || [])];
      const idx = extras.findIndex((e) => (e.name || "").toLowerCase() === "observações");
      if (idx >= 0) extras[idx] = { ...extras[idx], name: "Observações", value: payload.notes };
      else extras.push({ name: "Observações", value: payload.notes });
      return helpdesk.updateContact(contactId as number, { name: payload.name, email: payload.email, extraInfo: extras });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-contact", contactId] });
      if (activeId) qc.invalidateQueries({ queryKey: ["hd-conversation", activeId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const threadTailId = messages.data?.messages?.length
    ? messages.data.messages[messages.data.messages.length - 1]?.id
    : null;

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    requestAnimationFrame(pin);
  }, [messages.data?.messages?.length, threadTailId, activeId]);

  useEffect(() => {
    const engine: EngineSession | undefined = session.data;
    if (!engine?.token || !engine.engineUrl) return;
    const socket = io(resolveEngineSocketUrl(engine.engineUrl), engineSocketOptions(engine.token));
    socketRef.current = socket;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["hd-list"] });
      qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
      qc.invalidateQueries({ queryKey: ["hd-overview"] });
      // Badge: reconciliar com delay para não zerar o bump otimista do NotificationCenter.
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["helpdesk-nav-badge"] });
      }, 4000);
    };
    socket.on("connect", () => {
      socket.emit("joinTickets", "pending");
      socket.emit("joinTickets", "open");
      socket.emit("joinTickets", "closed");
      socket.emit("joinNotification");
      if (activeIdRef.current) socket.emit("joinChatBox", String(activeIdRef.current));
    });
    socket.on(`company-${engine.companyId}-ticket`, refresh);
    socket.on(`company-${engine.companyId}-appMessage`, (payload: AppMessagePayload) => {
      const ticketId = resolveAppMessageTicketId(payload);
      const openId = activeIdRef.current;
      const incoming = payload.message;
      const fromClient = !!incoming && !incoming.fromMe && !(incoming.isInternal || incoming.isPrivate);

      if (ticketId && fromClient && ticketId !== openId) {
        const preview =
          snippet(incoming.body) ||
          (incoming.mediaType ? `[${incoming.mediaType}]` : "") ||
          "Nova mensagem";
        patchConversationInLists(qc, ticketId, (row) => ({
          ...row,
          unreadMessages: Math.max(0, row.unreadMessages || 0) + 1,
          lastMessage: preview || row.lastMessage,
          updatedAt: incoming.createdAt || new Date().toISOString(),
        }));
      }

      refresh();
      if (ticketId && openId && ticketId === openId && payload.message?.id) {
        qc.setQueryData<MessagesCache>(["hd-messages", openId], (prev) => ({
          ...prev,
          messages: mergeMessageIntoThread(prev?.messages, payload.message as HelpdeskMessage),
        }));
        patchConversationInLists(qc, ticketId, (row) => ({
          ...row,
          unreadMessages: 0,
          lastMessage: snippet(payload.message?.body) || row.lastMessage,
          updatedAt: payload.message?.createdAt || row.updatedAt,
        }));
      }
    });
    socket.on(`company-${engine.companyId}-whatsappSession`, () => {
      qc.invalidateQueries({ queryKey: ["hd-connections"] });
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.data?.token, session.data?.engineUrl, session.data?.companyId, qc]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeId) return;
    socket.emit("joinChatBox", String(activeId));
    return () => {
      socket.emit("leaveChatBox", String(activeId));
    };
  }, [activeId, session.data?.token]);

  const current = conversation.data;
  const linkedTicketId =
    current?.computicket_ticket_id ??
    (linkedFallback?.conversationId === current?.id ? linkedFallback.ticketId : null);
  const canReply = current?.status === "open";
  const assignedName = current?.user?.name;
  const thread = messages.data?.messages || [];
  const quickItems = quicks.data || [];
  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : "";
  const quickMatches = slash
    ? quickItems.filter((q) => q.shortcode.toLowerCase().includes(slash) || q.message.toLowerCase().includes(slash))
    : quickOpen
      ? quickItems
      : [];

  const grouped = useMemo(() => {
    const out: { day: string; items: HelpdeskMessage[] }[] = [];
    for (const msg of thread) {
      const day = formatDay(msg.createdAt) || "";
      const last = out[out.length - 1];
      if (!last || last.day !== day) out.push({ day, items: [msg] });
      else last.items.push(msg);
    }
    return out;
  }, [thread]);

  const engineDown = health.isFetched && !health.data?.ok;

  function setQueueFilter(value: string) {
    if (value === "all") {
      setSelectedQueues([]);
      setIncludeUnassigned(true);
      setUnassignedOnly(false);
      return;
    }
    if (value === "none") {
      setSelectedQueues([]);
      setIncludeUnassigned(true);
      setUnassignedOnly(true);
      return;
    }
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelectedQueues([id]);
    setIncludeUnassigned(false);
    setUnassignedOnly(false);
  }

  function insertQuick(item: QuickMessage) {
    setText(item.message);
    setQuickOpen(false);
  }

  async function suggestReply() {
    if (!current) return;
    setAiAction("reply");
    setAiError(null);
    try {
      const result = await helpdesk.aiSuggestReply(current.id);
      setAiResult({
        kind: "text",
        title: "Sugestão de resposta",
        draft: result.draft || "",
        sources: result.sources || [],
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível gerar a sugestão");
    } finally {
      setAiAction(null);
    }
  }

  async function improveText() {
    if (!current || !text.trim()) return;
    setAiAction("improve");
    setAiError(null);
    try {
      const result = await helpdesk.aiImprove(current.id, text.trim());
      setAiResult({
        kind: "text",
        title: "Texto melhorado",
        draft: result.draft || "",
        sources: result.sources || [],
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível melhorar o texto");
    } finally {
      setAiAction(null);
    }
  }

  async function askKnowledge() {
    if (!knowledgeQuestion.trim()) return;
    setAiAction("query");
    setAiError(null);
    try {
      const result = await helpdesk.aiQuery(knowledgeQuestion.trim(), current?.id);
      setAiResult({
        kind: "text",
        title: "Consulta ao conhecimento",
        draft: result.draft || "",
        sources: result.sources || [],
      });
      setKnowledgeOpen(false);
      setKnowledgeQuestion("");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível consultar o conhecimento");
    } finally {
      setAiAction(null);
    }
  }

  async function suggestTicket() {
    if (!current) return;
    setAiAction("ticket");
    setAiError(null);
    try {
      const result = await helpdesk.aiSuggestTicket(current.id);
      const link = contactClientLink.data?.link || null;
      setAiResult({
        kind: "ticket",
        title: "Sugestão de chamado",
        ticket: ticketDefaultsFromConversation(current, link, result.ticket),
        sources: result.sources || [],
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível gerar o rascunho do chamado");
    } finally {
      setAiAction(null);
    }
  }

  return (
    <div className="relative flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside className="flex min-h-0 w-[340px] shrink-0 flex-col overflow-hidden border-r border-[#ececec]">
          <div className="flex items-center justify-between gap-2 border-b border-[#ececec] px-3 py-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                connected ? "bg-done-bg text-done" : "bg-open-bg text-open",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-done" : "bg-open")} />
              {connectionLabel}
            </span>
            {isAdmin ? (
              <Link
                href="/configuracoes?tab=whatsapp&section=conexoes"
                className="rounded-md p-1 text-brand hover:bg-progress-bg"
                title="Configurar WhatsApp"
              >
                <Settings className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
          <div className="flex border-b border-[#ececec]">
            {TAB_META.map((t) => {
              const count = t.key === "open" ? counts.open : t.key === "pending" ? counts.pending : counts.closed;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setActiveId(null);
                    setError(null);
                  }}
                  className={cn(
                    "relative flex-1 py-3 text-[11px] font-semibold uppercase tracking-wide",
                    active ? "text-brand" : "text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                  {t.key !== "closed" && count > 0 ? (
                    <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-open px-1.5 text-[10px] text-white">
                      {count}
                    </span>
                  ) : null}
                  {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2">
            <label className="flex items-center gap-2 rounded-lg border border-line bg-[#fafafa] px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversa ou número"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </label>
          </div>

          <div className="space-y-1.5 px-3 pb-2">
            <div className="flex rounded-lg border border-line bg-[#f3f4f6] p-0.5">
              <button
                type="button"
                onClick={() => setMineOnly(true)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                  mineOnly ? "bg-navy text-white shadow-sm" : "text-muted hover:text-ink",
                )}
                title="Suas conversas em atendimento e todas as aguardando"
              >
                Meus
                <span className="ml-1 opacity-80">{mineTickets.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setMineOnly(false)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                  !mineOnly ? "bg-brand text-white shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                Todas
                <span className="ml-1 opacity-80">{countSource.data?.tickets?.length ?? 0}</span>
              </button>
            </div>

            <label className="relative block">
              <span className="sr-only">Filtrar por fila</span>
              {selectedQueueMeta?.color || queueFilterValue === "none" ? (
                <span
                  className="pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                  style={{
                    background:
                      queueFilterValue === "none" ? "#6b7280" : selectedQueueMeta?.color || "#3b82f6",
                  }}
                />
              ) : null}
              <select
                value={queueFilterValue}
                onChange={(e) => setQueueFilter(e.target.value)}
                className={cn(
                  "w-full appearance-none rounded-lg border border-line bg-[#fafafa] py-1.5 pr-14 text-xs font-medium text-ink outline-none focus:border-brand",
                  selectedQueueMeta?.color || queueFilterValue === "none" ? "pl-6" : "pl-2.5",
                )}
              >
                <option value="all">
                  Todas as filas ({countSource.data?.tickets?.length ?? 0})
                </option>
                <option value="none">Sem fila ({queueCounts.get("none") ?? 0})</option>
                {(queues.data || []).map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name} ({queueCounts.get(q.id) ?? 0})
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                <span className="rounded-full bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                  {queueFilterCount}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted" />
              </span>
            </label>
          </div>
          <p className="px-3 pb-2 text-[11px] text-muted">
            {mineOnly ? "Filtro Meus · " : ""}
            {tickets.length} conversa{tickets.length === 1 ? "" : "s"}
            {unread ? ` · ${unread} não lida` : ""}
            {waitingReply ? ` · ${waitingReply} aguardando resposta` : ""}
          </p>

          {engineDown ? (
            <div className="mx-3 mb-2 rounded-lg bg-open-bg px-3 py-2 text-xs text-open">
              Engine WhatsApp offline. Suba o serviço e recarregue.
            </div>
          ) : null}
          {error ? <p className="px-3 pb-2 text-xs text-open">{error}</p> : null}

          <div className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain">
            {listIsError ? (
              <p className="px-4 py-10 text-center text-sm text-open">
                Não foi possível carregar as conversas. {listErrorMessage}
              </p>
            ) : tickets.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {mineOnly
                  ? "Nenhuma conversa sua ou em aguardando"
                  : allSelected
                    ? "Nenhuma conversa nesta aba"
                    : unassignedOnly
                      ? "Nenhuma conversa sem fila"
                      : "Nenhuma conversa nestas filas"}
              </p>
            ) : (
              tickets.map((c) => {
                const selected = activeId === c.id;
                const chipItem = statusChip(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveId(c.id);
                      setError(null);
                      setContactOpen(false);
                      if ((c.unreadMessages || 0) > 0) {
                        patchConversationInLists(qc, c.id, (row) => ({ ...row, unreadMessages: 0 }));
                      }
                    }}
                    className={cn(
                      "flex w-full gap-3 border-b border-[#f3f3f3] px-3 py-3 text-left hover:bg-[#fafafa]",
                      selected && "bg-[#eef5ff]",
                      (c.unreadMessages || 0) > 0 && !selected && "bg-[#fffbf5]",
                    )}
                  >
                    <span className="relative shrink-0">
                      <UserAvatar name={contactName(c)} src={publicMediaUrl(c.contact?.profilePicUrl)} size="sm" />
                      {c.user?.name ? (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-navy text-[8px] font-bold text-white ring-2 ring-white"
                          title={c.user.name}
                        >
                          {c.user.name.slice(0, 1).toUpperCase()}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-sm text-ink",
                            (c.unreadMessages || 0) > 0 ? "font-bold" : "font-semibold",
                          )}
                        >
                          {contactName(c)}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[11px]",
                              (c.unreadMessages || 0) > 0 ? "font-semibold text-open" : "text-muted",
                            )}
                          >
                            {formatClock(c.updatedAt)}
                          </span>
                          {(c.unreadMessages || 0) > 0 ? (
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-open px-1.5 text-[10px] font-bold leading-none text-white">
                              {(c.unreadMessages || 0) > 99 ? "99+" : c.unreadMessages}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        Atendente: {c.user?.name || "ninguém"}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {c.queue ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                            style={{ background: c.queue.color || "#3b82f6" }}
                          >
                            {c.queue.name}
                          </span>
                        ) : (
                          <span className="rounded bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                            Sem fila
                          </span>
                        )}
                        {c.whatsapp?.name ? <span className="text-[10px] text-muted">{c.whatsapp.name}</span> : null}
                        {(c.tags || []).map((tag) => (
                          <span
                            key={tag.id}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                            style={{ background: tag.color || "#6b7280" }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </span>
                      <span className={cn("mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", chipItem.className)}>
                        {chipItem.label}
                      </span>
                      {c.status === "closed" && c.rating?.answered ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-[#fff8df] px-1.5 py-0.5 text-[10px] font-semibold text-[#765a00]">
                          <Star className="h-3 w-3 fill-[#f6b91a] text-[#f6b91a]" />
                          {c.rating.score}/5
                        </span>
                      ) : c.status === "closed" && c.rating ? (
                        <span className="ml-1 inline-flex rounded bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] text-muted">
                          Aguardando avaliação
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-xs",
                          (c.unreadMessages || 0) > 0 ? "font-semibold text-ink" : "text-muted",
                        )}
                      >
                        {snippet(c.lastMessage)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-[#efeae2]">
          {current ? (
            <div
              key={current.id}
              className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden"
            >
              <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e6e0d6] bg-white px-4 py-2.5">
                <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1 overflow-hidden">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => setContactOpen(true)}
                    title="Ver contato"
                  >
                    <span className="shrink-0">
                      <UserAvatar name={contactName(current)} src={publicMediaUrl(current.contact?.profilePicUrl)} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {contactName(current)} #{current.id}
                      </p>
                      <p className="truncate text-xs text-muted">
                        Atribuído à: {assignedName || "ninguém"}
                        {current.queue?.name ? ` · ${current.queue.name}` : " · sem fila"}
                      </p>
                    </div>
                  </button>
                  {linkedTicketId ? (
                    <Link
                      href={`/tickets/${linkedTicketId}`}
                      className="ml-[3.25rem] w-fit max-w-[calc(100%-3.25rem)] truncate rounded-md bg-progress-bg px-2 py-0.5 text-[11px] font-semibold text-brand hover:underline"
                    >
                      Chamado #{linkedTicketId}
                    </Link>
                  ) : null}
                </div>
                <div className="relative ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                  {current.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => assume.mutate(current.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <Hand className="h-3.5 w-3.5 shrink-0" />
                      Assumir
                    </button>
                  ) : null}
                  {current.status !== "closed" ? (
                    <button
                      type="button"
                      onClick={() => setTransferOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                      Transferir
                    </button>
                  ) : null}
                  {current.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => giveBack.mutate(current.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <Undo2 className="h-3.5 w-3.5 shrink-0" />
                      Devolver
                    </button>
                  ) : null}
                  {current.status !== "closed" && !linkedTicketId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTicketDefaults(
                          ticketDefaultsFromConversation(current, contactClientLink.data?.link || null),
                        );
                        setCreateOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <Ticket className="h-3.5 w-3.5 shrink-0" />
                      Abrir chamado
                    </button>
                  ) : null}
                  {current.status === "open" ? (
                    <button
                      type="button"
                      disabled={ticketFlowLoading || resolve.isPending}
                      onClick={handleResolverClick}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      {ticketFlowLoading ? "Carregando…" : "Resolver"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setContactOpen(true)}
                    className="rounded-lg p-1.5 text-muted hover:bg-[#f5f5f5]"
                    title="Dados do contato"
                    aria-label="Dados do contato"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {current.status === "closed" && current.rating ? (
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6e0d6] bg-[#fffdf5] px-4 py-2 text-xs">
                  {current.rating.answered ? (
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#765a00]">
                        <Star className="h-4 w-4 fill-[#f6b91a] text-[#f6b91a]" />
                        Atendimento avaliado com {current.rating.score}/5
                      </span>
                      {current.rating.comment ? (
                        <span className="ml-2 text-muted">“{current.rating.comment}”</span>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <span className="text-muted">Pesquisa enviada; aguardando resposta do cliente.</span>
                      <button
                        type="button"
                        onClick={() => resendRating.mutate(current.id)}
                        disabled={resendRating.isPending}
                        className="shrink-0 font-semibold text-brand hover:underline disabled:opacity-50"
                      >
                        {resendRating.isPending ? "Reenviando…" : "Reenviar pesquisa"}
                      </button>
                    </>
                  )}
                </div>
              ) : null}

              {(current.history || []).length > 0 ? (
                <ConversationHistoryStrip
                  items={current.history || []}
                  onOpen={(id) => setHistoryViewId(id)}
                />
              ) : null}

              <div
                ref={threadRef}
                className="min-h-0 flex-1 basis-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
              >
                {messages.isError ? (
                  <p className="rounded-lg bg-open-bg px-3 py-2 text-center text-xs text-open">
                    Não foi possível carregar as mensagens. {(messages.error as Error).message}
                  </p>
                ) : null}
                {messages.isSuccess && grouped.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">Nenhuma mensagem nesta conversa</p>
                ) : null}
                {grouped.map((group) => (
                  <div key={group.day}>
                    {group.day ? (
                      <p className="mb-3 text-center">
                        <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] text-muted shadow-sm">{group.day}</span>
                      </p>
                    ) : null}
                    {group.items.map((m, idx) => {
                      const system = m.isInternal || m.isPrivate;
                      const mine = !!m.fromMe && !system;
                      return (
                        <div key={`${m.id}-${idx}`} className={cn("mb-2 flex", system ? "justify-center" : mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm",
                              system
                                ? "bg-[#d1ecf1] text-center text-xs text-[#0c5460]"
                                : mine
                                  ? "rounded-tr-none bg-[#d9fdd3] text-ink"
                                  : "rounded-tl-none bg-white text-ink",
                            )}
                          >
                            {system ? <p className="mb-1 text-[10px] font-semibold uppercase">Nota interna</p> : null}
                            {m.quotedMsg?.body ? (
                              <p className="mb-1 border-l-2 border-brand/50 pl-2 text-[11px] text-muted">{snippet(m.quotedMsg.body)}</p>
                            ) : null}
                            {m.mediaUrl ? (
                              m.mediaType?.startsWith("image") ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={publicMediaUrl(m.mediaUrl) || m.mediaUrl}
                                  alt=""
                                  className="mb-1 block max-h-56 max-w-full rounded-md object-contain"
                                  onLoad={() => {
                                    const el = threadRef.current;
                                    if (el) el.scrollTop = el.scrollHeight;
                                  }}
                                />
                              ) : (
                                <a
                                  href={publicMediaUrl(m.mediaUrl) || m.mediaUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mb-1 block text-xs text-brand underline"
                                >
                                  Abrir anexo
                                </a>
                              )
                            ) : null}
                            {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                            <p className="mt-0.5 text-right text-[10px] text-muted">{formatClock(m.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {canReply ? (
                <form
                  className="relative shrink-0 border-t border-[#e6e0d6] bg-[#f0f2f5] px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (send.isPending || !activeId || !text.trim()) return;
                    const rawText = text;
                    const sendingInternal = isInternal;
                    const body = withAgentSignature(rawText, user?.name, sign, sendingInternal);
                    if (!body.trim()) return;
                    send.mutate({
                      ticketId: activeId,
                      body,
                      isInternal: sendingInternal,
                      rawText,
                    });
                  }}
                >
                  {quickMatches.length ? (
                    <div className="absolute inset-x-3 bottom-full z-10 mb-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
                      {quickMatches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left hover:bg-[#f7f7f7]"
                          onClick={() => insertQuick(item)}
                        >
                          <span className="text-xs font-semibold text-brand">/{item.shortcode}</span>
                          <span className="mt-0.5 block truncate text-sm text-ink">{item.message}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {aiResult ? (
                    <AiDraftPanel
                      result={aiResult}
                      onDraftChange={(draft) =>
                        setAiResult((value) => (value?.kind === "text" ? { ...value, draft } : value))
                      }
                      onApplyText={() => {
                        if (aiResult.kind === "text") setText(aiResult.draft);
                        setAiResult(null);
                      }}
                      onApplyTicket={() => {
                        if (aiResult.kind !== "ticket") return;
                        if (linkedTicketId) {
                          setAiError("Esta conversa já possui um chamado ativo.");
                          setAiResult(null);
                          return;
                        }
                        setTicketDefaults(
                          ticketDefaultsFromConversation(
                            current,
                            contactClientLink.data?.link || null,
                            aiResult.ticket,
                          ),
                        );
                        setCreateOpen(true);
                      }}
                      onClose={() => setAiResult(null)}
                    />
                  ) : null}
                  {aiError ? (
                    <div className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-open-bg px-3 py-2 text-xs text-open">
                      <span>{aiError}</span>
                      <button type="button" onClick={() => setAiError(null)} aria-label="Fechar erro">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Smile className="h-5 w-5 text-muted" />
                    <button
                      type="button"
                      onClick={() => setQuickOpen((v) => !v)}
                      className={cn("text-muted hover:text-ink", quickOpen && "text-brand")}
                      aria-label="Mensagens rápidas"
                      title="Mensagens rápidas"
                    >
                      <Zap className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="text-muted hover:text-ink"
                      aria-label="Anexar"
                    >
                      <Paperclip className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => setAiMenuAnchor((cur) => (cur ? null : e.currentTarget))}
                      className={cn(
                        "text-muted hover:text-ink",
                        (aiMenuAnchor || aiAction) && "text-brand",
                      )}
                      aria-label="Copiloto"
                      title="Copiloto"
                      aria-expanded={!!aiMenuAnchor}
                      aria-haspopup="menu"
                    >
                      {aiAction ? (
                        <LoaderCircle className="h-5 w-5 animate-spin" />
                      ) : (
                        <Bot className="h-5 w-5" />
                      )}
                    </button>
                    {aiMenuAnchor ? (
                      <FloatingMenu
                        anchor={aiMenuAnchor}
                        width={220}
                        onClose={() => setAiMenuAnchor(null)}
                      >
                        <div className="border-b border-[#e5e7eb] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Copiloto
                        </div>
                        <AiMenuItem
                          label="Sugerir resposta"
                          pending={aiAction === "reply"}
                          disabled={aiAction !== null}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            void suggestReply();
                          }}
                        />
                        <AiMenuItem
                          label="Melhorar texto"
                          pending={aiAction === "improve"}
                          disabled={aiAction !== null || !text.trim()}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            void improveText();
                          }}
                        />
                        <AiMenuItem
                          label="Consultar conhecimento"
                          icon={<BookOpen className="h-3.5 w-3.5" />}
                          pending={aiAction === "query"}
                          disabled={aiAction !== null}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            setAiError(null);
                            setKnowledgeOpen(true);
                          }}
                        />
                        <AiMenuItem
                          label="Gerar ticket"
                          icon={<FilePlus2 className="h-3.5 w-3.5" />}
                          pending={aiAction === "ticket"}
                          disabled={aiAction !== null}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            void suggestTicket();
                          }}
                        />
                      </FloatingMenu>
                    ) : null}
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && activeId) {
                          sendFile.mutate({
                            ticketId: activeId,
                            file,
                            body: withAgentSignature(text, user?.name, sign, isInternal),
                            rawText: text,
                          });
                        }
                        e.target.value = "";
                      }}
                    />
                    <input
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        if (!e.target.value.startsWith("/")) setQuickOpen(false);
                      }}
                      className="flex-1 rounded-lg border-0 bg-white px-3 py-2 text-sm shadow-sm"
                      placeholder={isInternal ? "Nota interna (não vai para o WhatsApp)" : "Digite uma mensagem ou /atalho"}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setIsInternal((v) => !v)}
                      className={cn("rounded-md p-1.5", isInternal ? "bg-[#d1ecf1] text-[#0c5460]" : "text-muted hover:text-ink")}
                      title="Mensagem interna"
                    >
                      <Lock className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSign((v) => !v)}
                      className={cn("rounded-md p-1.5", sign ? "bg-[#eef5ff] text-brand" : "text-muted hover:text-ink")}
                      title={sign ? "Assinatura ligada" : "Assinatura desligada"}
                    >
                      <PenLine className="h-4 w-4" />
                    </button>
                    <button
                      type="submit"
                      disabled={send.isPending || !text.trim()}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40"
                      aria-label="Enviar"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[#e6e0d6] bg-white px-4 py-3 text-xs text-muted">
                  {current.status === "closed" ? (
                    <>
                      <span>Conversa finalizada — somente leitura</span>
                      <button
                        type="button"
                        onClick={() => reopen.mutate(current.id)}
                        disabled={reopen.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7] disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {reopen.isPending ? "Reabrindo…" : "Reabrir"}
                      </button>
                    </>
                  ) : (
                    <span>Assuma ou transfira a conversa para responder</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-muted">
              <p className="text-lg font-semibold text-navy">Selecione uma conversa</p>
              <p className="mt-1 text-sm">Escolha um atendimento na lista à esquerda para ver as mensagens.</p>
            </div>
          )}
        </section>

        {contactOpen && current ? (
          <ContactDrawer
            conversation={current}
            detail={contact.data}
            loading={contact.isLoading}
            error={contact.isError ? (contact.error as Error).message : null}
            saving={saveContact.isPending}
            clientLink={contactClientLink.data?.link || null}
            clientLinkLoading={contactClientLink.isLoading}
            onClose={() => setContactOpen(false)}
            onSave={(payload) => saveContact.mutate(payload)}
            onLinked={() => {
              qc.invalidateQueries({ queryKey: ["hd-contact-client-link", contactId] });
            }}
          />
        ) : null}
      </div>

      {transferOpen && current ? (
        <TransferDialog
          conversation={current}
          queues={queues.data || []}
          assignees={assignees.data || []}
          pending={transfer.isPending}
          error={transfer.error ? (transfer.error as Error).message : null}
          onClose={() => setTransferOpen(false)}
          onSubmit={(payload) => transfer.mutate(payload)}
        />
      ) : null}

      <TicketCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setTicketDefaults(null);
        }}
        defaults={
          ticketDefaults ||
          ticketDefaultsFromConversation(current, contactClientLink.data?.link || null)
        }
        onCreated={(created) => {
          setAiResult(null);
          setTicketDefaults(null);
          if (!current?.id || !created?.id) return;
          const conversationId = current.id;
          const ticketId = created.id;
          if (linkedTicketId) {
            setError("Esta conversa já possui um chamado ativo.");
            return;
          }
          justLinkedTicketId.current = ticketId;
          setLinkedFallback({ conversationId, ticketId });
          applyLinkedTicketId(qc, conversationId, ticketId);
          helpdesk
            .linkTicket(conversationId, ticketId)
            .then((res) => {
              const confirmedId = res?.computicket_ticket_id || ticketId;
              justLinkedTicketId.current = confirmedId;
              setLinkedFallback({ conversationId, ticketId: confirmedId });
              applyLinkedTicketId(qc, conversationId, confirmedId);
              qc.invalidateQueries({ queryKey: ["hd-conversation", conversationId] });
              qc.invalidateQueries({ queryKey: ["hd-messages", conversationId] });
            })
            .catch((e: Error) => {
              justLinkedTicketId.current = null;
              setLinkedFallback((prev) =>
                prev?.conversationId === conversationId && prev.ticketId === ticketId ? null : prev,
              );
              qc.invalidateQueries({ queryKey: ["hd-conversation", conversationId] });
              setError(e.message || "Não foi possível vincular o chamado.");
            });
        }}
      />

      <Modal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} title="Consultar conhecimento">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void askKnowledge();
          }}
        >
          <p className="text-sm text-muted">
            Faça uma pergunta ao banco de conhecimento. A resposta será exibida como rascunho antes de ir para o campo de mensagem.
          </p>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Pergunta</span>
            <textarea
              autoFocus
              value={knowledgeQuestion}
              onChange={(e) => setKnowledgeQuestion(e.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="Ex.: Como orientar o cliente sobre este problema?"
            />
          </label>
          {aiError ? <p className="text-sm text-open">{aiError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setKnowledgeOpen(false)} className="rounded-lg px-3 py-2 text-sm text-muted">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={aiAction !== null || !knowledgeQuestion.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {aiAction === "query" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {aiAction === "query" ? "Consultando…" : "Consultar"}
            </button>
          </div>
        </form>
      </Modal>

      {historyViewId ? (
        <HistoryMessagesModal conversationId={historyViewId} onClose={() => setHistoryViewId(null)} />
      ) : null}

      {linkedTicket && entryMode ? (
        <TimeEntryDialog
          open
          ticketId={linkedTicket.id}
          mode={entryMode}
          onSaved={() => {
            entryContinueRef.current = true;
            const ticketId = linkedTicket.id;
            void flask
              .get<TicketDetail>(`/tickets/api/${ticketId}`)
              .then((ticket) => {
                setLinkedTicket(ticket);
                setCloseTicketOpen(true);
              })
              .catch((e) => {
                abortTicketCloseFlow();
                setError(e instanceof Error ? e.message : "Erro ao recarregar chamado");
              });
          }}
          onClose={() => {
            setEntryMode(null);
            if (entryContinueRef.current) {
              entryContinueRef.current = false;
              return;
            }
            abortTicketCloseFlow();
          }}
        />
      ) : null}

      {linkedTicket && closeTicketOpen ? (
        <CloseTicketDialog
          open
          ticket={linkedTicket}
          onClosed={onLinkedTicketClosed}
          onClose={() => {
            setCloseTicketOpen(false);
            setLinkedTicket(null);
            pendingResolveChatId.current = null;
          }}
        />
      ) : null}
    </div>
  );
}

function AiMenuItem({
  label,
  pending,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? (
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        icon || <WandSparkles className="h-3.5 w-3.5 shrink-0" />
      )}
      {label}
    </button>
  );
}

function sourceHref(source: HelpdeskAiSource) {
  const explicit = source.href || source.url;
  if (explicit?.startsWith("/conhecimento") || explicit?.startsWith("/tickets")) return explicit;

  const ticketId =
    source.ticket_id ||
    source.metadata?.ticket_id ||
    (source.source_type === "ticket" ? source.source_id : undefined);
  if (ticketId) return `/tickets/${ticketId}`;

  const categoryId =
    source.category_id ||
    source.metadata?.category_id ||
    source.knowledge_id ||
    source.metadata?.knowledge_id;
  if (categoryId) return `/conhecimento/${categoryId}`;
  return null;
}

function AiSources({ sources }: { sources: HelpdeskAiSource[] }) {
  return (
    <div className="mt-3 border-t border-line pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Fontes</p>
      {sources.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {sources.map((source, index) => {
            const href = sourceHref(source);
            const label =
              source.title ||
              source.name ||
              source.metadata?.title ||
              (source.ticket_id || source.metadata?.ticket_id || source.source_type === "ticket"
                ? `Chamado #${source.ticket_id || source.metadata?.ticket_id || source.source_id}`
                : `Evidência ${index + 1}`);
            return href ? (
              <Link
                key={`${href}-${index}`}
                href={href}
                target="_blank"
                className="rounded-full bg-progress-bg px-2 py-1 text-[11px] font-medium text-brand hover:underline"
              >
                {label}
              </Link>
            ) : (
              <span key={`${label}-${index}`} className="rounded-full bg-[#f3f4f6] px-2 py-1 text-[11px] text-muted">
                {label}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">Sem evidências encontradas para este rascunho.</p>
      )}
    </div>
  );
}

function AiDraftPanel({
  result,
  onDraftChange,
  onApplyText,
  onApplyTicket,
  onClose,
}: {
  result: AiResult;
  onDraftChange: (draft: string) => void;
  onApplyText: () => void;
  onApplyTicket: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-2 rounded-xl border border-[#cbd8ed] bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-navy">
          <Bot className="h-4 w-4 text-brand" />
          {result.title}
        </p>
        <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Descartar rascunho">
          <X className="h-4 w-4" />
        </button>
      </div>
      {result.kind === "text" ? (
        <>
          <textarea
            value={result.draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={4}
            className="mt-2 max-h-40 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            aria-label="Rascunho do copiloto"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!result.draft.trim()}
              onClick={onApplyText}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Usar no campo de mensagem
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 rounded-lg bg-[#f8fafc] p-3 text-xs text-ink">
            <p className="font-semibold">{result.ticket.title || "Chamado sem título"}</p>
            <p className="mt-1 whitespace-pre-wrap text-muted">{result.ticket.description || "Sem descrição"}</p>
            {result.ticket.solicitante ? <p className="mt-2 text-muted">Solicitante: {result.ticket.solicitante}</p> : null}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onApplyTicket}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
            >
              Revisar no formulário
            </button>
          </div>
        </>
      )}
      <AiSources sources={result.sources} />
      <p className="mt-2 text-[10px] text-muted">Conteúdo gerado por IA. Revise antes de usar.</p>
    </div>
  );
}

function TransferDialog({
  conversation,
  queues,
  assignees,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  conversation: HelpdeskConversation;
  queues: { id: number; name: string; color?: string }[];
  assignees: { name: string; engine_user_id: number }[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: TransferPayload) => void;
}) {
  const [userId, setUserId] = useState<string>(conversation.userId ? String(conversation.userId) : "");
  const [queueId, setQueueId] = useState<string>(conversation.queueId ? String(conversation.queueId) : "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-navy">Transferir</h2>
        <p className="mt-1 text-sm text-muted">Mova a conversa para outro agente e/ou outra fila.</p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const payload: TransferPayload = {};
            if (userId) payload.userId = Number(userId);
            if (queueId) payload.queueId = Number(queueId);
            if (!payload.userId && !payload.queueId) return;
            onSubmit(payload);
          }}
        >
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Agente</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px]"
            >
              <option value="">Manter / não atribuir</option>
              {assignees.map((a) => (
                <option key={a.engine_user_id} value={a.engine_user_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Fila</span>
            <select
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px]"
            >
              <option value="">Manter fila atual</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-sm text-open">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || (!userId && !queueId)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {pending ? "Transferindo…" : "Transferir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConversationHistoryStrip({
  items,
  onOpen,
}: {
  items: HelpdeskConversationHistoryItem[];
  onOpen: (id: number) => void;
}) {
  return (
    <div className="shrink-0 border-b border-[#e6e0d6] bg-[#faf8f4] px-4 py-2">
      <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        <History className="h-3 w-3" />
        Histórico
      </p>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            className="min-w-[11rem] max-w-[14rem] shrink-0 rounded-lg border border-[#e6e0d6] bg-white px-2.5 py-1.5 text-left hover:border-brand/40"
            title="Ver mensagens deste ciclo"
          >
            <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-ink">
              <span>#{item.id}</span>
              <span className="font-normal text-muted">{formatDay(item.updatedAt)}</span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {snippet(item.lastMessage) || "Sem última mensagem"}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
              {item.computicket_ticket_id ? <span>Chamado #{item.computicket_ticket_id}</span> : null}
              {item.rating?.answered && item.rating.score != null ? (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-[#f6b91a] text-[#f6b91a]" />
                  {item.rating.score}/5
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryMessagesModal({
  conversationId,
  onClose,
}: {
  conversationId: number;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["hd-messages", "history", conversationId],
    queryFn: () => helpdesk.messages(conversationId),
  });
  const items = unwrapMessages(query.data);

  return (
    <Modal open onClose={onClose} title={`Histórico · conversa #${conversationId}`}>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {query.isLoading ? <p className="text-sm text-muted">Carregando mensagens…</p> : null}
        {query.isError ? (
          <p className="text-sm text-open">Não foi possível carregar este ciclo.</p>
        ) : null}
        {query.isSuccess && items.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma mensagem neste ciclo.</p>
        ) : null}
        {items.map((m, idx) => {
          const system = m.isInternal || m.isPrivate;
          const mine = !!m.fromMe && !system;
          return (
            <div
              key={`${m.id}-${idx}`}
              className={cn("flex", system ? "justify-center" : mine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-1.5 text-sm",
                  system
                    ? "bg-[#d1ecf1] text-center text-xs text-[#0c5460]"
                    : mine
                      ? "bg-[#d9fdd3] text-ink"
                      : "bg-[#f5f5f5] text-ink",
                )}
              >
                {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                <p className="mt-0.5 text-right text-[10px] text-muted">
                  {formatDay(m.createdAt)} {formatClock(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ContactDrawer({
  conversation,
  detail,
  loading,
  error,
  saving,
  clientLink,
  clientLinkLoading,
  onClose,
  onSave,
  onLinked,
}: {
  conversation: HelpdeskConversation;
  detail?: {
    name?: string;
    number?: string;
    email?: string;
    profilePicUrl?: string | null;
    extraInfo?: { name?: string; value?: string }[];
  };
  loading: boolean;
  error: string | null;
  saving: boolean;
  clientLink: HelpdeskContactClientLink | null;
  clientLinkLoading: boolean;
  onClose: () => void;
  onSave: (payload: { name: string; email: string; notes: string }) => void;
  onLinked: () => void;
}) {
  const [name, setName] = useState(detail?.name || conversation.contact?.name || "");
  const [email, setEmail] = useState(detail?.email || conversation.contact?.email || "");
  const [notes, setNotes] = useState(
    detail?.extraInfo?.find((e) => (e.name || "").toLowerCase() === "observações")?.value || "",
  );
  const [clientQ, setClientQ] = useState("");
  const [debouncedClientQ, setDebouncedClientQ] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const photo =
    publicMediaUrl(detail?.profilePicUrl) || publicMediaUrl(conversation.contact?.profilePicUrl);

  const clients = useQuery({
    queryKey: ["clients", "hd-contact-link", debouncedClientQ],
    queryFn: () =>
      flask.get<{ items: { id: number; name: string; document?: string; phone?: string }[] }>(
        `/api/web/clients?q=${encodeURIComponent(debouncedClientQ)}&per_page=30`,
      ),
    enabled: !clientLink && debouncedClientQ.length >= 1,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedClientQ(clientQ.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [clientQ]);

  useEffect(() => {
    if (!detail) return;
    setName(detail.name || conversation.contact?.name || "");
    setEmail(detail.email || "");
    setNotes(detail.extraInfo?.find((e) => (e.name || "").toLowerCase() === "observações")?.value || "");
  }, [detail, conversation.contact?.name]);

  useEffect(() => {
    setClientQ("");
    setDebouncedClientQ("");
    setLinkError(null);
  }, [conversation.contact?.id, clientLink?.id]);

  async function linkClient(chosen: { id: number; name: string }) {
    const contactId = conversation.contact?.id;
    if (!contactId) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await helpdesk.upsertContactClientLink(contactId, {
        external_client_id: chosen.id,
        external_client_name: chosen.name,
        contact_number: detail?.number || conversation.contact?.number || undefined,
      });
      setClientQ("");
      setDebouncedClientQ("");
      onLinked();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Falha ao vincular cliente");
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlinkClient() {
    const contactId = conversation.contact?.id;
    if (!contactId || !clientLink) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await helpdesk.deleteContactClientLink(contactId);
      onLinked();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Falha ao desvincular cliente");
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <aside className="flex min-h-0 w-[320px] shrink-0 flex-col overflow-hidden border-l border-[#ececec] bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-[#ececec] px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-navy">
          <UserRound className="h-4 w-4" />
          Contato
        </p>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink">
          Fechar
        </button>
      </div>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim(), email: email.trim(), notes });
        }}
      >
        <div className="flex flex-col items-center gap-2 py-2">
          <UserAvatar
            name={name || conversation.contact?.name || conversation.contact?.number}
            src={photo}
            size="xl"
          />
          <p className="text-center text-sm font-semibold text-ink">
            {name || conversation.contact?.name || "Contato"}
          </p>
          <p className="text-center text-xs text-muted">
            {detail?.number || conversation.contact?.number || "—"}
          </p>
        </div>
        {loading ? <p className="text-sm text-muted">Carregando dados…</p> : null}
        {error ? (
          <p className="text-xs text-open">
            {/^Erro 50[234]$/i.test(error) || /indispon/i.test(error)
              ? "Não foi possível carregar o contato (engine WhatsApp indisponível). Você ainda pode editar e salvar com os dados da conversa."
              : error}
          </p>
        ) : null}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border-0 border-b border-[#d7d7d7] py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">E-mail</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border-0 border-b border-[#d7d7d7] py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Observações</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            className="mt-1 w-full resize-y border-0 border-b border-[#d7d7d7] py-2 text-sm"
          />
        </label>

        <div className="space-y-2 border-t border-[#ececec] pt-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Cliente do Uniplus
          </span>
          {clientLinkLoading ? (
            <p className="text-sm text-muted">Carregando vínculo…</p>
          ) : clientLink ? (
            <div className="space-y-2">
              <p className="text-sm text-ink">{clientLink.external_client_name}</p>
              <p className="text-xs text-muted">ID #{clientLink.external_client_id}</p>
              <button
                type="button"
                disabled={linkBusy || !conversation.contact?.id}
                onClick={() => void unlinkClient()}
                className="text-xs font-medium text-open hover:underline disabled:opacity-40"
              >
                {linkBusy ? "Desvinculando…" : "Desvincular cliente"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="sr-only">Buscar cliente</span>
                <input
                  value={clientQ}
                  onChange={(e) => setClientQ(e.target.value)}
                  placeholder="Digite nome, documento ou telefone…"
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </label>
              {!clientQ.trim() ? (
                <p className="text-xs text-muted">Digite para pesquisar diretamente nos clientes do Uniplus.</p>
              ) : clients.isFetching || clientQ.trim() !== debouncedClientQ ? (
                <p className="flex items-center gap-2 py-2 text-xs text-muted">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Buscando no Uniplus…
                </p>
              ) : clients.error ? (
                <p className="text-xs text-open">{(clients.error as Error).message}</p>
              ) : (clients.data?.items || []).length ? (
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-line bg-white p-1">
                  {(clients.data?.items || []).map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      disabled={linkBusy || !conversation.contact?.id}
                      onClick={() => void linkClient(client)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-[#f5f7fa] disabled:opacity-40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{client.name}</span>
                        {client.document || client.phone ? (
                          <span className="block truncate text-[11px] text-muted">
                            {[client.document, client.phone].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold text-brand">
                        {linkBusy ? "Aguarde…" : "Vincular"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-xs text-muted">Nenhum cliente encontrado no Uniplus.</p>
              )}
            </div>
          )}
          {linkError ? <p className="text-xs text-open">{linkError}</p> : null}
        </div>

        <button
          type="submit"
          disabled={saving || !conversation.contact?.id}
          className="mt-auto rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Salvando…" : "Salvar contato"}
        </button>
      </form>
    </aside>
  );
}
