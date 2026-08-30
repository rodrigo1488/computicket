"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, MessageCircle, Ticket, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flaskSocketOptions, getFlaskSocketConfig } from "@/lib/flask-socket";

type AppNotification = {
  id: number;
  type: "message" | "ticket" | "appointment" | string;
  title: string;
  message: string;
  url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  read?: boolean;
  created_at?: string | null;
};

type PushConfig = { enabled: boolean; publicKey?: string | null };

/** Dedupe global — sobrevive Strict Mode / remount e evita toast duplicado. */
const seenMessageIds = new Set<string>();

function markMessageSeen(messageId: string) {
  seenMessageIds.add(messageId);
  window.setTimeout(() => seenMessageIds.delete(messageId), 60_000);
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
  if (type === "message") return MessageCircle;
  if (type === "appointment") return CalendarDays;
  if (type === "ticket") return Ticket;
  return Bell;
}

function notificationTone(type: string) {
  if (type === "message") return "bg-progress-bg text-progress";
  if (type === "appointment") return "bg-[#fff3e0] text-[#e67e22]";
  if (type === "ticket") return "bg-open-bg text-open";
  return "bg-line text-navy";
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

function playMessageSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1175, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    /* autoplay bloqueado ou AudioContext indisponível */
  }
}

export function NotificationCenter() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
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

  const showMessageNotification = useCallback(
    (notification: AppNotification) => {
      const entityId = notification.entity_id ? String(notification.entity_id) : "";
      if (entityId) {
        if (seenMessageIds.has(entityId)) return false;
        markMessageSeen(entityId);
      }
      // Também dedupe por id numérico da notificação persistida.
      if (notification.id > 0 && seenMessageIds.has(`nid:${notification.id}`)) return false;
      if (notification.id > 0) markMessageSeen(`nid:${notification.id}`);

      const ticketId = (() => {
        const match = String(notification.url || "").match(/[?&]c=(\d+)/);
        return match ? Number(match[1]) : null;
      })();
      bumpHelpdeskBadge();
      if (isHelpdeskConversationFocused(ticketId)) return true;
      show(notification);
      playMessageSound();
      return true;
    },
    [bumpHelpdeskBadge, show],
  );

  useEffect(() => {
    if (!user) return;
    if ("Notification" in window) setPermission(Notification.permission);
    flask.get<PushConfig>("/api/notifications/push/config")
      .then(setPushConfig)
      .catch(() => setPushConfig({ enabled: false }));
  }, [user]);

  useEffect(() => {
    if (
      pushConfig?.publicKey &&
      permission === "granted" &&
      "serviceWorker" in navigator
    ) {
      registerPush(pushConfig.publicKey).catch(() => undefined);
    }
  }, [permission, pushConfig?.publicKey]);

  // Único canal de toast/som/badge para mensagens: Flask `app_notification`
  // (persistido uma vez pelo webhook Baileys → /engine-inbound).
  useEffect(() => {
    if (!user) return;
    const { url } = getFlaskSocketConfig();
    const socket = io(url, flaskSocketOptions());
    const onAppNotification = (notification: AppNotification) => {
      if (notification.type === "message") {
        showMessageNotification(notification);
        return;
      }
      show(notification);
    };
    socket.on("connect", () => {
      socket.emit("join_agent_notifications");
    });
    socket.on("app_notification", onAppNotification);
    return () => {
      socket.off("app_notification", onAppNotification);
      socket.disconnect();
    };
  }, [user, show, showMessageNotification]);

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
        <div className="pointer-events-auto rounded-2xl border border-line bg-white p-4 shadow-xl">
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
            className="pointer-events-auto relative overflow-hidden rounded-2xl border border-line bg-white shadow-xl"
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
