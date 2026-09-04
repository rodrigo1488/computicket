"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, FileSignature, MessageCircle, Ticket, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flaskSocketOptions, getFlaskSocketConfig } from "@/lib/flask-socket";
import {
  dismissHelpdeskNotificationToasts,
  engineSocketOptions,
  HELPDESK_DISMISS_EVENT,
  helpdesk,
  isClosedHelpdeskStatus,
  isEngineSocketSameOrigin,
  resolveEngineSocketUrl,
} from "@/lib/helpdesk";
import {
  deliverNotificationOnce,
  helpdeskMessageDeliveryKey,
  notificationRecordDeliveryKey,
} from "@/lib/notification-delivery";
import {
  isRememberedHelpdeskConversation,
  playHelpdeskInboundSound,
  playNotificationSound,
  rememberHelpdeskConversation,
  soundKindForNotification,
  unlockNotificationSounds,
} from "@/lib/notification-sounds";

type AppNotification = {
  id: number;
  type: "message" | "ticket" | "appointment" | "internal_chat" | "helpdesk_pending" | "contract_expiry" | string;
  title: string;
  message: string;
  url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  read?: boolean;
  created_at?: string | null;
};

type PushConfig = { enabled: boolean; publicKey?: string | null };

function deliveryKeyFor(notification: AppNotification): string | null {
  const entity = String(notification.entity_id || "").trim();
  if (entity.startsWith("ic:")) return entity;
  if (isHelpdeskNotification(notification) || notification.type === "message") {
    const hd = helpdeskMessageDeliveryKey(entity);
    if (hd) return hd;
  }
  const fromId = notificationRecordDeliveryKey(notification.id, null);
  if (fromId) return fromId;
  return entity ? `entity:${entity}` : null;
}

function applicationServerKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

async function registerPush(publicKey: string) {
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  await flask.post("/api/notifications/push/subscribe", subscription.toJSON());
}

function iconFor(type: string) {
  if (type === "message" || type === "internal_chat" || type === "helpdesk_pending") return MessageCircle;
  if (type === "appointment") return CalendarDays;
  if (type === "contract_expiry") return FileSignature;
  if (type === "ticket") return Ticket;
  return Bell;
}

function notificationTone(type: string) {
  if (type === "internal_chat") return "bg-progress-bg text-brand";
  if (type === "helpdesk_pending") return "bg-open-bg text-warn-fg";
  if (type === "message") return "bg-progress-bg text-progress";
  if (type === "appointment") return "bg-open-bg text-warn-fg";
  if (type === "contract_expiry") return "bg-open-bg text-warn-fg";
  if (type === "ticket") return "bg-open-bg text-open";
  return "bg-line text-navy";
}

function conversationIdFromUrl(url?: string | null): number | null {
  const match = String(url || "").match(/[?&]c=(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function isInternalChatNotification(notification: AppNotification) {
  return (
    notification.type === "internal_chat" ||
    notification.entity_type === "internal_chat" ||
    String(notification.url || "").startsWith("/chat")
  );
}

/** Conversa aberta e aba visível → não tocar toast/som. */
function isHelpdeskConversationFocused(ticketId?: number | null): boolean {
  if (typeof window === "undefined") return false;
  if (!window.location.pathname.startsWith("/helpdesk")) return false;
  if (document.hidden) return false;
  if (ticketId == null) return false;
  const openId = Number(new URLSearchParams(window.location.search).get("c"));
  return Number.isFinite(openId) && openId === ticketId;
}

function isInternalChatFocused(chatId?: number | null): boolean {
  if (typeof window === "undefined") return false;
  if (!window.location.pathname.startsWith("/chat")) return false;
  if (document.hidden) return false;
  if (chatId == null) return false;
  const openId = Number(new URLSearchParams(window.location.search).get("c"));
  return Number.isFinite(openId) && openId === chatId;
}

function isHelpdeskNotification(notification: AppNotification) {
  return notification.type === "message" || notification.type === "helpdesk_pending";
}

function hashNotificationId(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash || 1;
}

export function NotificationCenter() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const health = useQuery({
    queryKey: ["hd-health"],
    queryFn: helpdesk.health,
    retry: 1,
    enabled: !!user,
  });
  const session = useQuery({
    queryKey: ["hd-engine-token"],
    queryFn: helpdesk.token,
    enabled: !!user && !!health.data?.ok,
    refetchInterval: 8 * 60 * 1000,
  });
  const [items, setItems] = useState<AppNotification[]>([]);
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((notification: AppNotification) => {
    setItems((current) => {
      if (current.some((item) => item.id === notification.id)) return current;
      if (
        notification.entity_id &&
        current.some((item) => item.entity_id === notification.entity_id)
      ) {
        return current;
      }
      return [...current.slice(-3), notification];
    });
    const timer = setTimeout(() => dismiss(notification.id), 8000);
    timers.current.set(notification.id, timer);
  }, [dismiss]);

  const bumpHelpdeskBadge = useCallback(() => {
    queryClient.setQueriesData<{ count: number }>({ queryKey: ["helpdesk-nav-badge"] }, (prev) => ({
      count: Math.max(0, (prev?.count ?? 0) + 1),
    }));
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["helpdesk-nav-badge"] });
    }, 4000);
  }, [queryClient]);

  const bumpInternalChatBadge = useCallback(() => {
    queryClient.setQueriesData<{ count: number }>({ queryKey: ["internal-chat-nav-badge"] }, (prev) => ({
      count: Math.max(0, (prev?.count ?? 0) + 1),
    }));
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["internal-chat-nav-badge"] });
    }, 400);
  }, [queryClient]);

  const showMessageNotification = useCallback(
    (notification: AppNotification) => {
      const deliveryKey = deliveryKeyFor(notification);
      if (!deliveryKey) return false;

      return deliverNotificationOnce(deliveryKey, () => {
        const internal = isInternalChatNotification(notification);
        const targetId = conversationIdFromUrl(notification.url);
        if (internal) bumpInternalChatBadge();
        else bumpHelpdeskBadge();
        if (internal) {
          const sound = soundKindForNotification(notification.type);
          if (sound) playNotificationSound(sound, deliveryKey);
        } else {
          playHelpdeskInboundSound(
            targetId,
            notification.type === "helpdesk_pending",
            deliveryKey,
          );
        }
        const focused = internal
          ? isInternalChatFocused(targetId)
          : isHelpdeskConversationFocused(targetId);
        if (!focused) show(notification);
      });
    },
    [bumpHelpdeskBadge, bumpInternalChatBadge, show],
  );

  useEffect(() => {
    if (!user) return;
    if ("Notification" in window) setPermission(Notification.permission);
    flask.get<PushConfig>("/api/notifications/push/config")
      .then(setPushConfig)
      .catch(() => setPushConfig({ enabled: false }));
    unlockNotificationSounds();
    if (health.data?.ok) {
      helpdesk.conversations("pending", "1")
        .then((res) => {
          for (const row of res.tickets || []) rememberHelpdeskConversation(row.id);
        })
        .catch(() => undefined);
    }
  }, [user, health.data?.ok]);

  useEffect(() => {
    if (
      pushConfig?.publicKey &&
      permission === "granted" &&
      "serviceWorker" in navigator
    ) {
      registerPush(pushConfig.publicKey).catch(() => undefined);
    }
  }, [permission, pushConfig?.publicKey]);

  // Flask `app_notification` + socket do engine (mesmo canal do Help Desk/chat).
  const showRef = useRef(show);
  const showMessageRef = useRef(showMessageNotification);
  showRef.current = show;
  showMessageRef.current = showMessageNotification;

  useEffect(() => {
    if (!user) return;
    const { url } = getFlaskSocketConfig();
    const socket = io(url, flaskSocketOptions());
    const onAppNotification = (notification: AppNotification) => {
      if (isHelpdeskNotification(notification) || isInternalChatNotification(notification)) {
        showMessageRef.current(notification);
        return;
      }
      showRef.current(notification);
    };
    socket.on("connect", () => {
      socket.emit("join_agent_notifications");
    });
    socket.on("app_notification", onAppNotification);
    socket.on("helpdesk_notifications_dismissed", (payload: { ticketId?: number }) => {
      dismissHelpdeskNotificationToasts(payload?.ticketId);
    });
    return () => {
      socket.off("app_notification", onAppNotification);
      socket.off("helpdesk_notifications_dismissed");
      socket.disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const onDismiss = (event: Event) => {
      const ticketId = Number((event as CustomEvent<{ ticketId?: number }>).detail?.ticketId);
      if (!Number.isFinite(ticketId) || ticketId <= 0) return;
      setItems((current) =>
        current.filter((item) => conversationIdFromUrl(item.url) !== ticketId),
      );
    };
    window.addEventListener(HELPDESK_DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(HELPDESK_DISMISS_EVENT, onDismiss);
  }, []);

  useEffect(() => {
    const engine = session.data;
    if (!user || !engine?.token || !engine.engineUrl) return;
    const socketUrl = resolveEngineSocketUrl(engine.engineUrl);
    const socket = io(
      socketUrl,
      engineSocketOptions(engine.token, { sameOrigin: isEngineSocketSameOrigin(socketUrl) }),
    );
    const joinRooms = () => {
      socket.emit("joinTickets", "pending");
      socket.emit("joinTickets", "open");
      socket.emit("joinNotification");
    };
    const onAppMessage = (payload: {
      action?: string;
      ticket?: {
        id?: number | string;
        status?: string;
        userId?: number | string | null;
        user?: { id?: number | string } | null;
        contact?: { name?: string };
      } | null;
      message?: { id?: string; body?: string; fromMe?: boolean; isInternal?: boolean; isPrivate?: boolean; mediaType?: string } | null;
      contact?: { name?: string } | null;
    }) => {
      const incoming = payload.message;
      if (!incoming?.id || incoming.fromMe || incoming.isInternal || incoming.isPrivate) return;
      if (payload.action && payload.action !== "create") return;
      const ticketId = Number(payload.ticket?.id);
      if (isClosedHelpdeskStatus(payload.ticket?.status)) {
        dismissHelpdeskNotificationToasts(ticketId);
        return;
      }
      const status = String(payload.ticket?.status || "").toLowerCase();
      const waiting = status === "pending";
      const assigneeId = Number(payload.ticket?.userId ?? payload.ticket?.user?.id);
      const myEngineId = Number(engine.engineUserId);
      // Mensagem em conversa atribuída: só o responsável. Pending (sem dono) segue para todos.
      if (!waiting) {
        if (!Number.isFinite(assigneeId) || assigneeId <= 0) return;
        if (!Number.isFinite(myEngineId) || assigneeId !== myEngineId) return;
      }
      const isNewConversation = waiting && !isRememberedHelpdeskConversation(ticketId);
      const name = payload.ticket?.contact?.name || payload.contact?.name || "Contato";
      showMessageRef.current({
        id: -Math.abs(hashNotificationId(`hd:${incoming.id}`)),
        type: isNewConversation ? "helpdesk_pending" : "message",
        title: isNewConversation ? `Nova conversa de ${name}` : `Nova mensagem de ${name}`,
        message: (incoming.body || incoming.mediaType || "Nova mensagem").slice(0, 1000),
        url: Number.isFinite(ticketId) && ticketId > 0 ? `/helpdesk?c=${ticketId}` : "/helpdesk",
        entity_type: "message",
        entity_id: String(incoming.id),
      });
    };
    const onInternalChat = (payload: {
      action?: string;
      newMessage?: { id?: string | number; chatId?: number; senderId?: number; body?: string; mediaName?: string };
      chat?: { id?: number; title?: string; isGroup?: boolean };
    }) => {
      const incoming = payload.newMessage;
      if (!incoming?.id || incoming.senderId === engine.engineUserId) return;
      if (payload.action === "delete") return;
      const chatId = Number(payload.chat?.id ?? incoming.chatId);
      showMessageRef.current({
        id: -Math.abs(hashNotificationId(`ic:${chatId}:${incoming.id}`)),
        type: "internal_chat",
        title: "Chat interno",
        message: (incoming.body || incoming.mediaName || "Nova mensagem").slice(0, 1000),
        url: Number.isFinite(chatId) && chatId > 0 ? `/chat?c=${chatId}` : "/chat",
        entity_type: "internal_chat",
        entity_id: `ic:${chatId}:${incoming.id}`,
      });
    };
    socket.on("connect", joinRooms);
    socket.on("ready", joinRooms);
    socket.on(`company-${engine.companyId}-ticket`, (payload: {
      action?: string;
      ticketId?: number | string;
      ticket?: { id?: number | string; status?: string } | null;
    }) => {
      const ticketId = Number(payload.ticket?.id ?? payload.ticketId);
      const status = String(payload.ticket?.status || "").toLowerCase();
      if (payload.action === "delete" || isClosedHelpdeskStatus(status) || (status && status !== "pending")) {
        dismissHelpdeskNotificationToasts(ticketId);
      }
    });
    socket.on(`company-${engine.companyId}-appMessage`, onAppMessage);
    socket.on(`company-${engine.companyId}-chat`, onInternalChat);
    socket.on(`company-${engine.companyId}-chat-user-${engine.engineUserId}`, onInternalChat);
    return () => {
      socket.disconnect();
    };
  }, [user?.id, session.data?.token, session.data?.engineUrl, session.data?.companyId, session.data?.engineUserId]);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const deliverSystemToast = (item: AppNotification) => {
      if (item.type !== "contract_expiry" && item.type !== "appointment" && item.type !== "ticket") return;
      const key = notificationRecordDeliveryKey(item.id, item.entity_id) || `nid:${item.id}`;
      deliverNotificationOnce(key, () => showRef.current(item));
    };
    const loadUnreadSystem = async () => {
      try {
        const data = await flask.get<{ notifications?: AppNotification[] }>("/api/notifications/list?limit=30");
        if (stopped) return;
        for (const item of data.notifications || []) {
          if (item.read) continue;
          deliverSystemToast(item);
        }
      } catch {
        /* opcional */
      }
    };
    void loadUnreadSystem();

    const since = Date.now() - 1500;
    const poll = async () => {
      try {
        const data = await flask.get<{ notifications?: AppNotification[] }>("/api/notifications/list?limit=12");
        if (stopped) return;
        for (const item of data.notifications || []) {
          if (item.read) continue;
          if (item.type === "contract_expiry") {
            deliverSystemToast(item);
            continue;
          }
          const ts = item.created_at ? Date.parse(item.created_at) : 0;
          if (!ts || ts < since) continue;
          if (isHelpdeskNotification(item) || isInternalChatNotification(item)) {
            showMessageRef.current(item);
          }
        }
      } catch {
        /* poll é só backup */
      }
    };
    const timer = window.setInterval(() => void poll(), 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  async function enablePush() {
    if (!pushConfig?.publicKey || !("serviceWorker" in navigator) || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return;
    await registerPush(pushConfig.publicKey);
  }

  async function openNotification(item: AppNotification) {
    dismiss(item.id);
    if (item.id > 0) {
      flask.post(`/api/notifications/${item.id}/read`).catch(() => undefined);
    }
    if (item.url) router.push(item.url);
  }

  if (!user) return null;

  const canEnable =
    pushConfig?.enabled &&
    permission === "default" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(390px,calc(100vw-2.5rem))] flex-col gap-3">
      {canEnable ? (
        <div className="pointer-events-auto rounded-2xl border border-line bg-surface p-4 shadow-xl">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-progress-bg p-2 text-progress"><Bell size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-navy">Ativar notificações push</p>
              <p className="mt-1 text-xs leading-5 text-muted">Receba mensagens, tickets e lembretes mesmo fora desta tela.</p>
              <button
                type="button"
                onClick={() => void enablePush()}
                className="mt-3 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
              >
                Ativar notificações
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {items.map((item) => {
        const Icon = iconFor(item.type);
        return (
          <div
            key={item.id}
            className="pointer-events-auto relative overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
            role="status"
          >
            <button
              type="button"
              onClick={() => void openNotification(item)}
              className="flex w-full items-start gap-3 p-4 pr-11 text-left"
            >
              <span className={`shrink-0 rounded-xl p-2.5 ${notificationTone(item.type)}`}>
                <Icon size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{item.message}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Fechar notificação"
              onClick={() => dismiss(item.id)}
              className="absolute right-3 top-3 rounded-md p-1 text-muted hover:bg-line hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
