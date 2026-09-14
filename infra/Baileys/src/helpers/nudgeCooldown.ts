import AppError from "../errors/AppError";

export const NUDGE_COOLDOWN_MS = 10_000;

const lastNudgeAt = new Map<string, number>();

export function nudgeCooldownKey(userId: number, chatId: number): string {
  return `${userId}:${chatId}`;
}

export function assertNudgeAllowed(
  key: string,
  now = Date.now(),
  store: Map<string, number> = lastNudgeAt
): void {
  const last = store.get(key) || 0;
  const wait = NUDGE_COOLDOWN_MS - (now - last);
  if (wait > 0) {
    const secs = Math.max(1, Math.ceil(wait / 1000));
    throw new AppError(
      `Aguarde ${secs}s para chamar a atenção de novo.`,
      429
    );
  }
  store.set(key, now);
  if (store.size > 500) {
    const cutoff = now - NUDGE_COOLDOWN_MS;
    for (const [entryKey, at] of store) {
      if (at < cutoff) store.delete(entryKey);
    }
  }
}
