"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  Hand,
  Lock,
  MoreVertical,
  Paperclip,
  PenLine,
  RotateCcw,
  Search,
  Send,
  Settings,
  Smile,
  Ticket,
  Undo2,
  UserRound,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { TicketCreateDialog } from "@/components/tickets/TicketCreateDialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import {
  helpdesk,
  unwrapConnections,
  unwrapMessages,
  unwrapQuickMessages,
  type EngineSession,
  type HelpdeskConversation,
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

function readStoredFilters() {
  if (typeof window === "undefined") return { queues: [] as number[], unassigned: true };
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return { queues: [] as number[], unassigned: true };
    const parsed = JSON.parse(raw) as { queues?: number[]; unassigned?: boolean };
    return {
      queues: Array.isArray(parsed.queues) ? parsed.queues.map(Number).filter((n) => Number.isFinite(n)) : [],
      unassigned: parsed.unassigned !== false,
    };
  } catch {
    return { queues: [] as number[], unassigned: true };
  }
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
  const [includeUnassigned, setIncludeUnassigned] = useState(() => params.get("unassigned") !== "0");
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
  const [sign, setSign] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SIGN_KEY) !== "0";
  });
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (params.get("queues") || params.get("unassigned")) {
      setFiltersReady(true);
      return;
    }
    const stored = readStoredFilters();
    if (stored.queues.length) setSelectedQueues(stored.queues);
    setIncludeUnassigned(stored.unassigned);
    setFiltersReady(true);
    // URL vazia: hidrata do localStorage só no cliente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    const q = new URLSearchParams();
    q.set("status", tab);
    if (selectedQueues.length) q.set("queues", selectedQueues.join(","));
    if (!includeUnassigned) q.set("unassigned", "0");
    if (debouncedSearch.trim()) q.set("q", debouncedSearch.trim());
    if (activeId) q.set("c", String(activeId));
    router.replace(`/helpdesk?${q}`, { scroll: false });
    window.localStorage.setItem(FILTER_KEY, JSON.stringify({ queues: selectedQueues, unassigned: includeUnassigned }));
  }, [tab, selectedQueues, includeUnassigned, debouncedSearch, activeId, router, filtersReady]);

  useEffect(() => {
    window.localStorage.setItem(SIGN_KEY, sign ? "1" : "0");
  }, [sign]);

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
    enabled: !!health.data?.ok,
    refetchInterval: 12000,
  });

  const conversation = useQuery({
    queryKey: ["hd-conversation", activeId],
    queryFn: () => helpdesk.conversation(activeId as number),
    enabled: !!activeId,
  });

  useEffect(() => {
    const status = conversation.data?.status;
    if (status === "open" || status === "pending" || status === "closed") setTab(status);
  }, [conversation.data?.id, conversation.data?.status]);

  const messages = useQuery({
    queryKey: ["hd-messages", activeId],
    queryFn: async () => {
      const res = await helpdesk.messages(activeId as number);
      return { ...res, messages: unwrapMessages(res) };
    },
    enabled: !!activeId,
  });

  const contactId = conversation.data?.contact?.id;
  const contact = useQuery({
    queryKey: ["hd-contact", contactId],
    queryFn: () => helpdesk.contact(contactId as number),
    enabled: !!contactId && contactOpen,
  });

  const tickets = useMemo(() => {
    const rows = list.data?.tickets || [];
    if (selectedQueues.length && includeUnassigned) return rows;
    if (selectedQueues.length && !includeUnassigned) return rows.filter((t) => t.queueId != null);
    if (!selectedQueues.length && !includeUnassigned) return rows.filter((t) => t.queueId != null);
    return rows;
  }, [list.data?.tickets, selectedQueues.length, includeUnassigned]);

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
  const allSelected = selectedQueues.length === 0 && includeUnassigned;
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
    onSuccess: () => {
      setActiveId(null);
      setTab("closed");
      invalidateInbox();
    },
    onError: (e: Error) => setError(e.message),
  });
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
    mutationFn: () => {
      const body = withAgentSignature(text, user?.name, sign, isInternal);
      return helpdesk.send(activeId as number, body, { isInternal });
    },
    onSuccess: () => {
      setText("");
      setIsInternal(false);
      qc.invalidateQueries({ queryKey: ["hd-messages", activeId] });
      qc.invalidateQueries({ queryKey: ["hd-list"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const sendFile = useMutation({
    mutationFn: (file: File) =>
      helpdesk.sendMedia(activeId as number, file, withAgentSignature(text, user?.name, sign, isInternal)),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["hd-messages", activeId] });
    },
    onError: (e: Error) => setError(e.message),
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

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.data?.messages?.length, activeId]);

  useEffect(() => {
    const engine: EngineSession | undefined = session.data;
    if (!engine?.token || !engine.engineUrl) return;
    const socket = io(engine.engineUrl, {
      transports: ["websocket", "polling"],
      query: { token: engine.token },
    });
    socketRef.current = socket;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["hd-list"] });
      qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
      qc.invalidateQueries({ queryKey: ["hd-overview"] });
    };
    socket.on("connect", () => {
      socket.emit("joinTickets", "pending");
      socket.emit("joinTickets", "open");
      socket.emit("joinTickets", "closed");
      socket.emit("joinNotification");
    });
    socket.on(`company-${engine.companyId}-ticket`, refresh);
    socket.on(`company-${engine.companyId}-appMessage`, (payload: { ticket?: HelpdeskConversation; message?: HelpdeskMessage }) => {
      refresh();
      const ticketId = payload?.ticket?.id;
      const openId = activeIdRef.current;
      if (ticketId && ticketId === openId && payload.message) {
        qc.setQueryData(["hd-messages", openId], (prev: { messages?: HelpdeskMessage[] } | undefined) => {
          const current = prev?.messages || [];
          if (current.some((m) => m.id === payload.message?.id)) return prev;
          return { ...prev, messages: [...current, payload.message as HelpdeskMessage] };
        });
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

  function toggleQueue(id: number) {
    setSelectedQueues((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function insertQuick(item: QuickMessage) {
    setText(item.message);
    setQuickOpen(false);
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

          <div className="flex flex-wrap gap-1 px-3 pb-2">
            <button
              type="button"
              onClick={() => {
                setSelectedQueues([]);
                setIncludeUnassigned(true);
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase",
                allSelected ? "bg-brand text-white" : "bg-[#f3f4f6] text-muted",
              )}
            >
              Todas
              <span className="ml-1 opacity-80">{countSource.data?.tickets?.length ?? 0}</span>
            </button>
            <button
              type="button"
              onClick={() => setIncludeUnassigned((v) => !v)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase",
                includeUnassigned ? "bg-[#6b7280] text-white" : "bg-[#f3f4f6] text-muted",
              )}
            >
              Sem fila
              <span className="ml-1 opacity-80">{queueCounts.get("none") ?? 0}</span>
            </button>
            {(queues.data || []).map((q) => {
              const on = selectedQueues.includes(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => toggleQueue(q.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase",
                    on ? "text-white" : "border border-line bg-white text-muted",
                  )}
                  style={on ? { background: q.color || "#3b82f6" } : { borderColor: q.color || "#d1d5db" }}
                >
                  {q.name}
                  <span className="ml-1 opacity-80">{queueCounts.get(q.id) ?? 0}</span>
                </button>
              );
            })}
          </div>
          <p className="px-3 pb-2 text-[11px] text-muted">
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
            {list.isError ? (
              <p className="px-4 py-10 text-center text-sm text-open">
                Não foi possível carregar as conversas. {(list.error as Error).message}
              </p>
            ) : tickets.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {allSelected ? "Nenhuma conversa nesta aba" : "Nenhuma conversa nestas filas"}
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
                    }}
                    className={cn(
                      "flex w-full gap-3 border-b border-[#f3f3f3] px-3 py-3 text-left hover:bg-[#fafafa]",
                      selected && "bg-[#eef5ff]",
                    )}
                  >
                    <span className="relative shrink-0">
                      <UserAvatar name={contactName(c)} src={c.contact?.profilePicUrl} size="sm" />
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
                        <span className="truncate text-sm font-semibold text-ink">{contactName(c)}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted">{formatClock(c.updatedAt)}</span>
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
                      <span className="mt-0.5 block truncate text-xs text-muted">{snippet(c.lastMessage)}</span>
                    </span>
                    {(c.unreadMessages || 0) > 0 ? (
                      <span className="mt-1 h-5 min-w-5 shrink-0 rounded-full bg-open px-1.5 text-center text-[10px] font-bold leading-5 text-white">
                        {c.unreadMessages}
                      </span>
                    ) : null}
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
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6e0d6] bg-white px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => setContactOpen(true)}
                    title="Ver contato"
                  >
                    <UserAvatar name={contactName(current)} src={current.contact?.profilePicUrl} />
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
                  {current.computicket_ticket_id ? (
                    <Link
                      href={`/tickets/${current.computicket_ticket_id}`}
                      className="shrink-0 rounded-md bg-progress-bg px-2 py-1 text-[11px] font-semibold text-brand hover:underline"
                    >
                      Chamado #{current.computicket_ticket_id}
                    </Link>
                  ) : null}
                </div>
                <div className="relative flex shrink-0 items-center gap-2">
                  {current.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => assume.mutate(current.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <Hand className="h-3.5 w-3.5" />
                      Assumir
                    </button>
                  ) : null}
                  {current.status !== "closed" ? (
                    <button
                      type="button"
                      onClick={() => setTransferOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Transferir
                    </button>
                  ) : null}
                  {current.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => giveBack.mutate(current.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Devolver
                    </button>
                  ) : null}
                  {current.status !== "closed" ? (
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-[#f7f7f7]"
                    >
                      <Ticket className="h-3.5 w-3.5" />
                      Abrir chamado
                    </button>
                  ) : null}
                  {current.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("Resolver esta conversa?")) resolve.mutate(current.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Resolver
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
                    {group.items.map((m) => {
                      const system = m.isInternal || m.isPrivate;
                      const mine = !!m.fromMe && !system;
                      return (
                        <div key={m.id} className={cn("mb-2 flex", system ? "justify-center" : mine ? "justify-end" : "justify-start")}>
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
                                  src={m.mediaUrl}
                                  alt=""
                                  className="mb-1 block max-h-56 max-w-full rounded-md object-contain"
                                  onLoad={() => {
                                    const el = threadRef.current;
                                    if (el) el.scrollTop = el.scrollHeight;
                                  }}
                                />
                              ) : (
                                <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 block text-xs text-brand underline">
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
                    if (text.trim()) send.mutate();
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
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) sendFile.mutate(file);
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
            onClose={() => setContactOpen(false)}
            onSave={(payload) => saveContact.mutate(payload)}
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
        onClose={() => setCreateOpen(false)}
        defaults={{
          title: `WhatsApp ${contactName(current)}`,
          description: snippet(current?.lastMessage) || "",
          solicitante: contactName(current),
          clientQuery: contactName(current),
        }}
        onCreated={(created) => {
          if (current?.id && created?.id) {
            helpdesk.linkTicket(current.id, created.id).then(() => {
              qc.invalidateQueries({ queryKey: ["hd-conversation", current.id] });
              qc.invalidateQueries({ queryKey: ["hd-messages", current.id] });
            });
          }
        }}
      />
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

function ContactDrawer({
  conversation,
  detail,
  loading,
  error,
  saving,
  onClose,
  onSave,
}: {
  conversation: HelpdeskConversation;
  detail?: { name?: string; number?: string; email?: string; extraInfo?: { name?: string; value?: string }[] };
  loading: boolean;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: { name: string; email: string; notes: string }) => void;
}) {
  const [name, setName] = useState(detail?.name || conversation.contact?.name || "");
  const [email, setEmail] = useState(detail?.email || conversation.contact?.email || "");
  const [notes, setNotes] = useState(
    detail?.extraInfo?.find((e) => (e.name || "").toLowerCase() === "observações")?.value || "",
  );

  useEffect(() => {
    if (!detail) return;
    setName(detail.name || conversation.contact?.name || "");
    setEmail(detail.email || "");
    setNotes(detail.extraInfo?.find((e) => (e.name || "").toLowerCase() === "observações")?.value || "");
  }, [detail, conversation.contact?.name]);

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
        <p className="text-xs text-muted">Número: {detail?.number || conversation.contact?.number || "—"}</p>
        {loading ? <p className="text-sm text-muted">Carregando dados…</p> : null}
        {error ? <p className="text-xs text-open">{error}</p> : null}
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
