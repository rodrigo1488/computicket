export const NOTIFICATION_SOUNDS = {
  internal_chat: "/sounds/notificacao_chat.mp3",
  message: "/sounds/notificacao_mensagem.mp3",
  helpdesk_pending: "/sounds/notificacao_novo_help_desk.mp3",
} as const;

export type NotificationSoundKind = keyof typeof NOTIFICATION_SOUNDS;

const NEW_CONVERSATION_STORAGE = "computicket:hd-new-conversation-sounds";
const players = new Map<string, HTMLAudioElement>();
const lastPlayedAt = new Map<string, number>();
const playedEventKeys = new Set<string>();
let unlocked = false;
let gesturesBound = false;

function loadRememberedConversations(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(NEW_CONVERSATION_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

const rememberedConversations = loadRememberedConversations();

function persistRememberedConversations() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      NEW_CONVERSATION_STORAGE,
      JSON.stringify([...rememberedConversations].slice(-300)),
    );
  } catch {
    /* quota / privado */
  }
}

function conversationKey(ticketId: number | string | null | undefined): string | null {
  const id = Number(ticketId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return String(id);
}

export function rememberHelpdeskConversation(ticketId: number | string | null | undefined) {
  const key = conversationKey(ticketId);
  if (!key || rememberedConversations.has(key)) return;
  rememberedConversations.add(key);
  persistRememberedConversations();
}

export function isRememberedHelpdeskConversation(ticketId: number | string | null | undefined): boolean {
  const key = conversationKey(ticketId);
  return !!key && rememberedConversations.has(key);
}

export function takeNewHelpdeskConversation(ticketId: number | string | null | undefined): boolean {
  const key = conversationKey(ticketId);
  if (!key) return false;
  if (rememberedConversations.has(key)) return false;
  rememberedConversations.add(key);
  persistRememberedConversations();
  return true;
}

function markEventPlayed(eventKey?: string | null): boolean {
  const key = eventKey ? String(eventKey).trim() : "";
  if (!key) return true;
  if (playedEventKeys.has(key)) return false;
  playedEventKeys.add(key);
  window.setTimeout(() => playedEventKeys.delete(key), 60_000);
  return true;
}

function playerFor(src: string): HTMLAudioElement {
  let audio = players.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    players.set(src, audio);
  }
  return audio;
}

function bindUnlockGestures() {
  if (gesturesBound || typeof window === "undefined") return;
  gesturesBound = true;
  const onGesture = () => {
    unlockNotificationSounds();
    if (unlocked) {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      window.removeEventListener("touchstart", onGesture, true);
    }
  };
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
  window.addEventListener("touchstart", onGesture, true);
}

export function unlockNotificationSounds() {
  if (typeof window === "undefined") return;
  bindUnlockGestures();
  for (const src of Object.values(NOTIFICATION_SOUNDS)) {
    const audio = playerFor(src);
    audio.muted = true;
    void audio.play().then(
      () => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        unlocked = true;
      },
      () => {
        audio.muted = false;
      },
    );
  }
}

function playBeepFallback(kind: string) {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = kind === "internal_chat" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(kind === "helpdesk_pending" ? 660 : 880, ctx.currentTime);
    osc.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    /* sem áudio */
  }
}

export function playHelpdeskInboundSound(
  ticketId: number | string | null | undefined,
  isPending: boolean,
  eventKey?: string | null,
) {
  if (!markEventPlayed(eventKey ? `hd:${eventKey}` : null)) return;
  if (isPending && takeNewHelpdeskConversation(ticketId)) {
    playNotificationSound("helpdesk_pending");
    return;
  }
  rememberHelpdeskConversation(ticketId);
  playNotificationSound("message");
}

export function playNotificationSound(kind: string, eventKey?: string | null) {
  const src = NOTIFICATION_SOUNDS[kind as NotificationSoundKind];
  if (!src || typeof window === "undefined") return;
  if (!markEventPlayed(eventKey)) return;
  bindUnlockGestures();
  const now = Date.now();
  if ((lastPlayedAt.get(kind) || 0) > now - 1400) return;
  lastPlayedAt.set(kind, now);

  const audio = playerFor(src);
  audio.muted = false;
  audio.volume = 1;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    /* ainda não carregou */
  }
  const attempt = audio.play();
  if (attempt && typeof attempt.then === "function") {
    void attempt.catch(() => {
      unlocked = false;
      playBeepFallback(kind);
    });
  }
}

export function soundKindForNotification(type?: string | null) {
  if (type === "internal_chat") return "internal_chat";
  if (type === "helpdesk_pending") return "helpdesk_pending";
  if (type === "message") return "message";
  return null;
}

if (typeof window !== "undefined") {
  bindUnlockGestures();
}
