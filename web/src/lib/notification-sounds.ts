export const NOTIFICATION_SOUNDS = {
  internal_chat: "/sounds/notificacao_chat.mp3",
  message: "/sounds/notificacao_mensagem.mp3",
  helpdesk_pending: "/sounds/notificacao_novo_help_desk.mp3",
} as const;

export type NotificationSoundKind = keyof typeof NOTIFICATION_SOUNDS;

const players = new Map<string, HTMLAudioElement>();
let unlocked = false;

function playerFor(src: string): HTMLAudioElement {
  let audio = players.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    players.set(src, audio);
  }
  return audio;
}

export function unlockNotificationSounds() {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  for (const src of Object.values(NOTIFICATION_SOUNDS)) {
    const audio = playerFor(src);
    audio.muted = true;
    void audio.play().then(
      () => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      },
      () => {
        audio.muted = false;
      },
    );
  }
}

export function playNotificationSound(kind: string) {
  const src = NOTIFICATION_SOUNDS[kind as NotificationSoundKind];
  if (!src || typeof window === "undefined") return;
  try {
    const audio = playerFor(src).cloneNode(true) as HTMLAudioElement;
    audio.muted = false;
    void audio.play().catch(() => undefined);
  } catch {
    /* autoplay bloqueado */
  }
}

export function soundKindForNotification(type?: string | null) {
  if (type === "internal_chat") return "internal_chat";
  if (type === "helpdesk_pending") return "helpdesk_pending";
  if (type === "message") return "message";
  return null;
}
