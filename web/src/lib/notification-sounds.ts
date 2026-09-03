export const NOTIFICATION_SOUNDS = {
  internal_chat: "/sounds/notificacao_chat.mp3",
  message: "/sounds/notificacao_mensagem.mp3",
  helpdesk_pending: "/sounds/notificacao_novo_help_desk.mp3",
} as const;

export type NotificationSoundKind = keyof typeof NOTIFICATION_SOUNDS;

const players = new Map<string, HTMLAudioElement>();
const lastPlayedAt = new Map<string, number>();
let unlocked = false;
let gesturesBound = false;

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

export function playNotificationSound(kind: string) {
  const src = NOTIFICATION_SOUNDS[kind as NotificationSoundKind];
  if (!src || typeof window === "undefined") return;
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
