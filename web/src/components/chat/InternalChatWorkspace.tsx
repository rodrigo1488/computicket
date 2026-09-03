"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComposerContextBanner, MessageActions } from "@/components/chat/MessageActions";
import { ComposerAttachZone, ComposerFilePreview } from "@/components/ui/ComposerAttachZone";
import { MediaViewer, type MediaViewerItem } from "@/components/media/MediaViewer";
import { Modal } from "@/components/ui/Modal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/cn";
import {
  engineSocketOptions,
  helpdesk,
  isEngineSocketSameOrigin,
  resolveEngineSocketUrl,
  type EngineSession,
} from "@/lib/helpdesk";
import {
  chatDisplayName,
  internalChat,
  internalChatMediaSizeError,
  mergeInternalChat,
  publicInternalMediaUrl,
  isPlaceholderName,
  type InternalChat,
  type InternalChatColleague,
  type InternalChatMessage,
  type InternalChatTab,
} from "@/lib/internal-chat";
import { playNotificationSound } from "@/lib/notification-sounds";

type ChatEventPayload = {
  action?: string;
  newMessage?: InternalChatMessage;
  chat?: InternalChat;
  record?: InternalChat;
  id?: number | string;
};

function formatClock(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatDay(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

function formatMessageTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mediaKind(url?: string | null, name?: string | null): "image" | "audio" | "video" | "file" {
  const raw = `${url || ""} ${name || ""}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/.test(raw) || raw.includes("image/")) return "image";
  if (/\.(mp3|wav|ogg|oga|m4a|aac|webm|opus)(\?|$)/.test(raw) || raw.includes("audio/")) return "audio";
  if (/\.(mp4|webm|mov|m4v|3gp)(\?|$)/.test(raw) || raw.includes("video/")) return "video";
  return "file";
}

function snippet(text?: string | null) {
  const value = (text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function lastMessagePreview(chat: InternalChat) {
  return snippet(chat.lastMessage) || "Nenhuma mensagem ainda";
}

function senderLabel(message: InternalChatMessage, chat: InternalChat | null) {
  const fromMsg = message.sender?.name?.trim();
  if (fromMsg && !isPlaceholderName(fromMsg)) return fromMsg;
  const fromChat = (chat?.participants || []).find((p) => p.id != null && p.id === message.senderId)?.name?.trim();
  if (fromChat && !isPlaceholderName(fromChat)) return fromChat;
  return fromMsg || fromChat || "";
}

function participantNames(chat: InternalChat) {
  const names = (chat.participants || []).map((p) => p.name).filter(Boolean) as string[];
  return names.join(", ");
}

function mergeMessage(list: InternalChatMessage[] | undefined, incoming: InternalChatMessage) {
  const current = list || [];
  if (!incoming?.id) return current;
  const idx = current.findIndex((item) => item.id === incoming.id);
  if (idx >= 0) {
    const copy = [...current];
    copy[idx] = { ...copy[idx], ...incoming };
    return copy;
  }
  return [...current, incoming];
}

function chatFromEvent(payload?: ChatEventPayload | null): InternalChat | null {
  const raw = payload?.chat || payload?.record;
  if (!raw || raw.id == null) return null;
  return raw;
}

export function InternalChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const deepLink = Number(searchParams.get("c") || 0) || null;

  const [tab, setTab] = useState<InternalChatTab>("dm");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<number | null>(deepLink);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<InternalChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<InternalChatMessage | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [connected, setConnected] = useState(false);
  const [olderPage, setOlderPage] = useState(1);
  const [olderMessages, setOlderMessages] = useState<InternalChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [mediaViewer, setMediaViewer] = useState<MediaViewerItem | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef<number | null>(activeId);
  const stickToBottomRef = useRef(true);

  activeIdRef.current = activeId;

  const health = useQuery({
    queryKey: ["ic-health"],
    queryFn: internalChat.health,
    retry: 0,
    refetchInterval: 30_000,
  });
  const session = useQuery({
    queryKey: ["hd-engine-token"],
    queryFn: helpdesk.token,
    retry: 0,
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: ["ic-list"],
    queryFn: () => internalChat.chats(),
    refetchInterval: 45_000,
  });
  const colleagues = useQuery({
    queryKey: ["ic-colleagues"],
    queryFn: internalChat.colleagues,
    enabled: groupOpen,
  });
  const messages = useQuery({
    queryKey: ["ic-messages", activeId],
    queryFn: () => internalChat.messages(activeId!, "1"),
    enabled: !!activeId,
  });

  const engineDown = health.isFetched && !health.data?.ok;
  const engineUserId = session.data?.engineUserId ?? list.data?.engineUserId ?? health.data?.engineUserId ?? null;
  const chats = list.data?.records || [];
  const current = chats.find((c) => c.id === activeId) || null;

  useEffect(() => {
    if (deepLink && deepLink !== activeId) setActiveId(deepLink);
  }, [deepLink, activeId]);

  const tabSyncedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!activeId || tabSyncedFor.current === activeId) return;
    const linked = chats.find((c) => c.id === activeId);
    if (!linked) return;
    tabSyncedFor.current = activeId;
    setTab(linked.isGroup ? "group" : "dm");
  }, [activeId, chats]);

  useEffect(() => {
    setOlderPage(1);
    setOlderMessages([]);
    setText("");
    setFile(null);
    setReplyTo(null);
    setEditingMessage(null);
    stickToBottomRef.current = true;
  }, [activeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return chats
      .filter((chat) => (tab === "group" ? chat.isGroup : !chat.isGroup))
      .filter((chat) => {
        if (!q) return true;
        const hay = `${chatDisplayName(chat)} ${chat.lastMessage || ""} ${participantNames(chat)}`.toLowerCase();
        return hay.includes(q);
      });
  }, [chats, search, tab]);

  const thread = useMemo(() => {
    const first = messages.data?.records || [];
    const seen = new Set<number>();
    const merged: InternalChatMessage[] = [];
    for (const item of [...olderMessages, ...first]) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    merged.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });
    return merged;
  }, [messages.data?.records, olderMessages]);

  const grouped = useMemo(() => {
    const days: { day: string; items: InternalChatMessage[] }[] = [];
    for (const item of thread) {
      const day = formatDay(item.createdAt);
      const last = days[days.length - 1];
      if (!last || last.day !== day) days.push({ day, items: [item] });
      else last.items.push(item);
    }
    return days;
  }, [thread]);

  const selectChat = useCallback(
    (chat: InternalChat) => {
      setActiveId(chat.id);
      setTab(chat.isGroup ? "group" : "dm");
      setError(null);
      const next = new URLSearchParams(searchParams.toString());
      next.set("c", String(chat.id));
      router.replace(`/chat?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const invalidateLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["ic-list"] });
    window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["internal-chat-nav-badge"] });
    }, 400);
  }, [qc]);

  const markRead = useMutation({
    mutationFn: (id: number) => internalChat.read(id),
    onSuccess: (chat) => {
      qc.setQueryData(["ic-list"], (prev: { records?: InternalChat[] } | undefined) => {
        if (!prev?.records) return prev;
        return {
          ...prev,
          records: prev.records.map((row) =>
            row.id === chat.id ? mergeInternalChat(row, { ...chat, unreads: 0 }) : row,
          ),
        };
      });
      void qc.invalidateQueries({ queryKey: ["internal-chat-nav-badge"] });
    },
  });

  useEffect(() => {
    if (!activeId) return;
    markRead.mutate(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const send = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("Selecione uma conversa.");
      if (editingMessage) {
        const body = text.trim();
        if (!body) throw new Error("Digite uma mensagem.");
        return internalChat.edit(activeId, editingMessage.id, body);
      }
      const quotedId = replyTo && !replyTo.isDeleted ? replyTo.id : undefined;
      if (file) {
        const tooBig = internalChatMediaSizeError(file);
        if (tooBig) throw new Error(tooBig);
        return internalChat.sendMedia(activeId, file, text.trim(), quotedId);
      }
      if (!text.trim()) throw new Error("Digite uma mensagem.");
      return internalChat.send(activeId, text.trim(), quotedId);
    },
    onSuccess: (msg) => {
      setText("");
      setFile(null);
      setReplyTo(null);
      setEditingMessage(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.setQueryData(["ic-messages", activeId], (prev: { records?: InternalChatMessage[] } | undefined) => ({
        ...prev,
        records: mergeMessage(prev?.records, msg),
      }));
      invalidateLists();
      stickToBottomRef.current = true;
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMessage = useMutation({
    mutationFn: (message: InternalChatMessage) => {
      if (!activeId) throw new Error("Selecione uma conversa.");
      return internalChat.removeMessage(activeId, message.id);
    },
    onSuccess: (msg) => {
      qc.setQueryData(["ic-messages", activeId], (prev: { records?: InternalChatMessage[] } | undefined) => ({
        ...prev,
        records: mergeMessage(prev?.records, msg),
      }));
      if (replyTo?.id === msg.id) setReplyTo(null);
      if (editingMessage?.id === msg.id) {
        setEditingMessage(null);
        setText("");
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  function attachComposerFile(next: File) {
    const tooBig = internalChatMediaSizeError(next);
    if (tooBig) {
      setError(tooBig);
      return;
    }
    setError(null);
    setFile(next);
  }

  const createGroup = useMutation({
    mutationFn: ({ title, userIds }: { title: string; userIds: number[] }) =>
      internalChat.createGroup(title, userIds),
    onSuccess: (chat) => {
      setGroupOpen(false);
      setEditing(false);
      invalidateLists();
      selectChat(chat);
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateGroup = useMutation({
    mutationFn: ({ id, title, userIds }: { id: number; title: string; userIds: number[] }) =>
      internalChat.updateGroup(id, { title, userIds }),
    onSuccess: (chat) => {
      setGroupOpen(false);
      setEditing(false);
      invalidateLists();
      selectChat(chat);
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeGroup = useMutation({
    mutationFn: (id: number) => internalChat.remove(id),
    onSuccess: (_, id) => {
      setConfirmDelete(false);
      if (activeId === id) {
        setActiveId(null);
        router.replace("/chat", { scroll: false });
      }
      invalidateLists();
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    const engine: EngineSession | undefined = session.data;
    if (!engine?.token || !engine.engineUrl) return;
    const socketUrl = resolveEngineSocketUrl(engine.engineUrl);
    const socket = io(
      socketUrl,
      engineSocketOptions(engine.token, { sameOrigin: isEngineSocketSameOrigin(socketUrl) }),
    );
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("ready", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    const onChat = (payload: ChatEventPayload) => {
      const incoming = payload?.newMessage;
      const chat = chatFromEvent(payload);
      const openId = activeIdRef.current;
      if (payload?.action === "delete" && payload.id != null) {
        const deletedId = Number(payload.id);
        qc.setQueryData(["ic-list"], (prev: { records?: InternalChat[] } | undefined) => {
          if (!prev?.records) return prev;
          return { ...prev, records: prev.records.filter((row) => row.id !== deletedId) };
        });
        if (openId === deletedId) {
          setActiveId(null);
        }
        invalidateLists();
        return;
      }
      if (incoming && incoming.id) {
        if (incoming.senderId !== engine.engineUserId && payload?.action !== "delete") {
          playNotificationSound("internal_chat");
        }
        const incomingChatId = chat ? Number(chat.id) : Number(incoming.chatId);
        if (openId && incomingChatId === openId) {
          const normalized = {
            ...incoming,
            sender: incoming.sender,
            mine: incoming.senderId === engine.engineUserId,
            mediaUrl: incoming.mediaUrl || publicInternalMediaUrl(incoming.mediaPath),
          };
          qc.setQueryData(["ic-messages", openId], (prev: { records?: InternalChatMessage[] } | undefined) => ({
            ...prev,
            records: mergeMessage(prev?.records, normalized),
          }));
          if (document.visibilityState === "visible") {
            void internalChat.read(openId).catch(() => undefined);
          }
        }
        if (chat) {
          qc.setQueryData(["ic-list"], (prev: { records?: InternalChat[] } | undefined) => {
            if (!prev?.records) return prev;
            return {
              ...prev,
              records: prev.records.map((row) =>
                Number(row.id) === Number(chat.id) ? mergeInternalChat(row, chat) : row,
              ),
            };
          });
        }
      } else if (chat && payload?.action === "update") {
        qc.setQueryData(["ic-list"], (prev: { records?: InternalChat[] } | undefined) => {
          if (!prev?.records) return prev;
          return {
            ...prev,
            records: prev.records.map((row) =>
              Number(row.id) === Number(chat.id) ? mergeInternalChat(row, chat) : row,
            ),
          };
        });
      }
      invalidateLists();
    };

    socket.on(`company-${engine.companyId}-chat`, onChat);
    socket.on(`company-${engine.companyId}-chat-user-${engine.engineUserId}`, onChat);
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [invalidateLists, qc, session.data]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el || !stickToBottomRef.current) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    requestAnimationFrame(pin);
  }, [thread.length, activeId]);

  async function loadOlder() {
    if (!activeId || loadingOlder || messages.data?.hasMore === false) return;
    const nextPage = olderPage + 1;
    setLoadingOlder(true);
    try {
      const data = await internalChat.messages(activeId, String(nextPage));
      setOlderMessages((prev) => [...(data.records || []), ...prev]);
      setOlderPage(nextPage);
      if (data.hasMore === false) {
        qc.setQueryData(["ic-messages", activeId], (prev: { records?: InternalChatMessage[]; hasMore?: boolean } | undefined) => ({
          ...prev,
          records: prev?.records || [],
          hasMore: false,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar mensagens anteriores.");
    } finally {
      setLoadingOlder(false);
    }
  }

  const unreadInTab = filtered.reduce((sum, chat) => sum + (chat.unreads || 0), 0);
  const isOwner = !!current && current.ownerId === engineUserId;

  return (
    <div
      className="relative flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside className="relative flex w-[320px] min-h-0 min-w-[260px] shrink-0 flex-col overflow-hidden border-r border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                connected && !engineDown ? "bg-done-bg text-done" : "bg-open-bg text-open",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", connected && !engineDown ? "bg-done" : "bg-open")} />
              {engineDown ? "Offline" : connected ? "Ao vivo" : "Conectando"}
            </span>
          </div>
          <div className="flex border-b border-line">
            {(
              [
                { key: "dm", label: "Individuais" },
                { key: "group", label: "Grupos" },
              ] as const
            ).map((item) => {
              const active = tab === item.key;
              const count = chats.filter((c) => (item.key === "group" ? c.isGroup : !c.isGroup)).reduce((s, c) => s + (c.unreads || 0), 0);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "relative flex-1 truncate px-1 py-3 text-[11px] font-semibold uppercase tracking-wide",
                    active ? "text-brand" : "text-muted hover:text-ink",
                  )}
                >
                  {item.label}
                  {count > 0 ? (
                    <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-open px-1.5 text-[10px] text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                  {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
                </button>
              );
            })}
          </div>
          {tab === "group" ? (
            <div className="border-b border-line px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setGroupOpen(true);
                  setError(null);
                }}
                disabled={engineDown}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4 shrink-0" />
                Novo grupo
              </button>
            </div>
          ) : null}
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 rounded-lg border border-line bg-wash px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === "group" ? "Buscar grupo" : "Buscar colaborador"}
                className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </label>
          </div>
          <p className="px-3 pb-2 text-[11px] text-muted">
            {filtered.length} conversa{filtered.length === 1 ? "" : "s"}
            {unreadInTab ? ` · ${unreadInTab} não lida${unreadInTab === 1 ? "" : "s"}` : ""}
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
            ) : filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {tab === "group" ? "Nenhum grupo ainda. Crie o primeiro." : "Nenhuma conversa individual"}
              </p>
            ) : (
              filtered.map((chat) => {
                const name = chatDisplayName(chat);
                const selected = chat.id === activeId;
                const unread = chat.unreads || 0;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => selectChat(chat)}
                    className={cn(
                      "flex w-full gap-3 border-b border-line px-3 py-3 text-left hover:bg-wash",
                      selected && "bg-progress-bg",
                      unread > 0 && !selected && "bg-open-bg/40",
                    )}
                  >
                    <span className="relative shrink-0">
                      <UserAvatar
                        name={name}
                        src={publicInternalMediaUrl(chat.isGroup ? null : chat.peer?.avatar)}
                        size="sm"
                      />
                      {chat.isGroup ? (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white">
                          <Users className="h-2.5 w-2.5" />
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm text-ink", unread > 0 ? "font-bold" : "font-semibold")}>
                          {name}
                        </span>
                        <span className={cn("shrink-0 text-[11px]", unread > 0 ? "font-semibold text-open" : "text-muted")}>
                          {formatClock(chat.updatedAt)}
                        </span>
                        {unread > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-open px-1.5 text-[10px] font-bold leading-none text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">{lastMessagePreview(chat)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-chat">
          {current ? (
            <ComposerAttachZone
              enabled={!editingMessage}
              onFiles={(files) => {
                const next = files[0];
                if (next) attachComposerFile(next);
              }}
              className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden"
            >
              <header className="flex shrink-0 items-center gap-3 border-b border-chat-border bg-surface px-4 py-2.5">
                <UserAvatar
                  name={chatDisplayName(current)}
                  src={publicInternalMediaUrl(current.isGroup ? null : current.peer?.avatar)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{chatDisplayName(current)}</p>
                  <p className="truncate text-xs text-muted">
                    {current.isGroup
                      ? `${current.participants?.length || 0} participantes${participantNames(current) ? ` · ${participantNames(current)}` : ""}`
                      : current.peer?.name || "Conversa individual"}
                  </p>
                </div>
                {current.isGroup && isOwner ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setGroupOpen(true);
                        setError(null);
                      }}
                      className="rounded-lg p-1.5 text-muted hover:bg-wash hover:text-ink"
                      title="Editar grupo"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="rounded-lg p-1.5 text-muted hover:bg-open-bg hover:text-open"
                      title="Excluir grupo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </header>

              <div
                ref={threadRef}
                className="min-h-0 flex-1 basis-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  if (el.scrollTop < 48 && messages.data?.hasMore !== false) {
                    void loadOlder();
                  }
                }}
              >
                {loadingOlder ? (
                  <p className="text-center text-[11px] text-muted">Carregando mensagens anteriores…</p>
                ) : null}
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
                        <span className="rounded-full bg-surface/80 px-3 py-1 text-[11px] capitalize text-muted shadow-sm">
                          {group.day}
                        </span>
                      </p>
                    ) : null}
                    {group.items.map((m) => {
                      const mine = !!m.mine;
                      const src = publicInternalMediaUrl(m.mediaUrl || m.mediaPath);
                      const kind = mediaKind(src, m.mediaName);
                      const canAct = !m.isDeleted;
                      return (
                        <div key={m.id} className={cn("mb-2 flex", mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "group/msg relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm",
                              mine ? "bg-brand text-white" : "bg-surface text-ink",
                            )}
                          >
                            {canAct ? (
                              <MessageActions
                                align={mine ? "start" : "end"}
                                tone={mine ? "onBrand" : "default"}
                                canReply
                                canEdit={mine && !src}
                                canDelete={mine}
                                onReply={() => {
                                  setReplyTo(m);
                                  setEditingMessage(null);
                                }}
                                onEdit={() => {
                                  setEditingMessage(m);
                                  setReplyTo(null);
                                  setFile(null);
                                  setText(m.message || "");
                                }}
                                onDelete={() => {
                                  if (window.confirm("Excluir esta mensagem?")) {
                                    deleteMessage.mutate(m);
                                  }
                                }}
                              />
                            ) : null}
                            {current.isGroup && !mine && senderLabel(m, current) ? (
                              <p className={cn("mb-0.5 text-[11px] font-semibold", mine ? "text-white/80" : "text-brand")}>
                                {senderLabel(m, current)}
                              </p>
                            ) : null}
                            {m.isDeleted ? (
                              <p className={cn("italic", mine ? "text-white/80" : "text-muted")}>Esta mensagem foi apagada</p>
                            ) : (
                              <>
                                {m.quotedMsg ? (
                                  <p className={cn(
                                    "mb-1 border-l-2 pl-2 text-[11px]",
                                    mine ? "border-white/50 text-white/80" : "border-brand/50 text-muted",
                                  )}>
                                    {m.quotedMsg.isDeleted
                                      ? "Mensagem apagada"
                                      : (m.quotedMsg.message || m.quotedMsg.mediaName || "Mensagem").slice(0, 90)}
                                  </p>
                                ) : null}
                                {src && kind === "image" ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={src}
                                    alt={m.mediaName || ""}
                                    className="mb-1 block max-h-56 max-w-full cursor-zoom-in rounded-md object-contain"
                                    onClick={() => setMediaViewer({ src, kind: "image", name: m.mediaName || undefined })}
                                  />
                                ) : null}
                                {src && kind === "audio" ? (
                                  <audio controls preload="metadata" src={src} className="mb-1 block h-11 w-full max-w-[16rem]" />
                                ) : null}
                                {src && kind === "video" ? (
                                  <div className="relative mb-1 inline-block">
                                    <video controls src={src} className="block max-h-56 max-w-full rounded-md" />
                                    <button
                                      type="button"
                                      onClick={() => setMediaViewer({ src, kind: "video", name: m.mediaName || undefined })}
                                      className={cn(
                                        "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                                        mine ? "bg-black/40 text-white" : "bg-black/60 text-white",
                                      )}
                                    >
                                      Ampliar
                                    </button>
                                  </div>
                                ) : null}
                                {src && kind === "file" ? (
                                  <a
                                    href={src}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(
                                      "mb-1 inline-flex items-center gap-1 text-xs underline",
                                      mine ? "text-white" : "text-brand",
                                    )}
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    {m.mediaName || "Arquivo"}
                                  </a>
                                ) : null}
                                {m.message ? <p className="whitespace-pre-wrap break-words">{m.message}</p> : null}
                              </>
                            )}
                            <p className={cn("mt-1 text-right text-[10px]", mine ? "text-white/70" : "text-muted")}>
                              {formatMessageTime(m.createdAt)}
                              {m.isEdited && !m.isDeleted ? " · editada" : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <form
                className="shrink-0 border-t border-chat-border bg-surface px-4 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editingMessage) {
                    if (!text.trim()) return;
                    send.mutate();
                    return;
                  }
                  if (!text.trim() && !file) return;
                  send.mutate();
                }}
              >
                {editingMessage ? (
                  <ComposerContextBanner
                    title="Editando mensagem"
                    preview={(editingMessage.message || "").slice(0, 90)}
                    onClear={() => {
                      setEditingMessage(null);
                      setText("");
                    }}
                  />
                ) : replyTo ? (
                  <ComposerContextBanner
                    title="Respondendo"
                    preview={(replyTo.message || replyTo.mediaName || "Mensagem").slice(0, 90)}
                    onClear={() => setReplyTo(null)}
                  />
                ) : null}
                {file ? (
                  <ComposerFilePreview
                    file={file}
                    onClear={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="text-muted hover:text-ink disabled:opacity-40"
                    aria-label="Anexar"
                    disabled={!!editingMessage}
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const next = e.target.files?.[0];
                      if (next) attachComposerFile(next);
                      e.target.value = "";
                    }}
                  />
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (text.trim() || file) send.mutate();
                      }
                    }}
                    rows={1}
                    className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border-0 bg-wash px-3 py-2 text-sm shadow-sm outline-none"
                    placeholder="Digite uma mensagem"
                    autoComplete="off"
                    title="Cole uma imagem (Ctrl+V) ou arraste um arquivo"
                  />
                  <button
                    type="submit"
                    disabled={send.isPending || (!text.trim() && !file)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40"
                    aria-label="Enviar"
                  >
                    {send.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </form>
            </ComposerAttachZone>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-muted">
              <MessageCircle className="mb-3 h-10 w-10 text-line" />
              <p className="text-lg font-semibold text-navy">Selecione uma conversa</p>
              <p className="mt-1 text-sm">Fale com outro colaborador ou abra um grupo à esquerda.</p>
            </div>
          )}
        </section>
      </div>

      <GroupModal
        open={groupOpen}
        editing={editing}
        chat={editing ? current : null}
        colleagues={colleagues.data?.items || []}
        loading={colleagues.isLoading}
        pending={createGroup.isPending || updateGroup.isPending}
        engineUserId={engineUserId}
        onClose={() => {
          setGroupOpen(false);
          setEditing(false);
        }}
        onSubmit={(title, userIds) => {
          if (editing && current) updateGroup.mutate({ id: current.id, title, userIds });
          else createGroup.mutate({ title, userIds });
        }}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir grupo">
        <p className="text-sm text-muted">
          O grupo “{current ? chatDisplayName(current) : ""}” será removido para todos os participantes.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-2 text-sm text-muted">
            Cancelar
          </button>
          <button
            type="button"
            disabled={removeGroup.isPending || !current}
            onClick={() => current && removeGroup.mutate(current.id)}
            className="rounded-lg bg-open px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {removeGroup.isPending ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </Modal>

      <MediaViewer
        item={mediaViewer}
        onClose={() => setMediaViewer(null)}
        canResend={!!activeId}
        onResend={(file) => {
          if (!activeId) return;
          setMediaViewer(null);
          const tooBig = internalChatMediaSizeError(file);
          if (tooBig) {
            setError(tooBig);
            return;
          }
          void internalChat
            .sendMedia(activeId, file, "")
            .then((msg) => {
              qc.setQueryData(["ic-messages", activeId], (prev: { records?: InternalChatMessage[] } | undefined) => ({
                ...prev,
                records: mergeMessage(prev?.records, msg),
              }));
              invalidateLists();
              stickToBottomRef.current = true;
            })
            .catch((e: Error) => setError(e.message));
        }}
      />
    </div>
  );
}

function GroupModal({
  open,
  editing,
  chat,
  colleagues,
  loading,
  pending,
  engineUserId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  chat: InternalChat | null;
  colleagues: InternalChatColleague[];
  loading: boolean;
  pending: boolean;
  engineUserId: number | null;
  onClose: () => void;
  onSubmit: (title: string, userIds: number[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(editing ? chat?.title || "" : "");
    setQuery("");
    if (editing && chat) {
      setSelected(
        (chat.participants || [])
          .map((p) => p.id)
          .filter((id): id is number => !!id && id !== engineUserId),
      );
    } else {
      setSelected([]);
    }
  }, [open, editing, chat, engineUserId]);

  const visible = colleagues.filter((item) => {
    const hay = `${item.name} ${item.email || ""}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar grupo" : "Novo grupo"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || selected.length < 1) return;
          onSubmit(title.trim(), selected);
        }}
      >
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Nome do grupo</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="Ex.: Plantão da tarde"
          />
        </label>
        <div>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Participantes</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 mb-2 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="Buscar colaborador"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
            {loading ? (
              <p className="px-3 py-4 text-center text-sm text-muted">Carregando colaboradores…</p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted">Nenhum colaborador encontrado</p>
            ) : (
              visible.map((item) => {
                const checked = selected.includes(item.engine_user_id);
                return (
                  <label
                    key={item.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-wash",
                      checked && "bg-progress-bg",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelected((cur) =>
                          checked ? cur.filter((id) => id !== item.engine_user_id) : [...cur, item.engine_user_id],
                        );
                      }}
                    />
                    <UserAvatar name={item.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{item.name}</span>
                      <span className="block truncate text-[11px] text-muted">{item.email}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || !title.trim() || selected.length < 1}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {editing ? "Salvar" : "Criar grupo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
