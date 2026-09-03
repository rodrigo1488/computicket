const DELIVERED_STORAGE = "computicket:delivered-notifications";

function loadDelivered(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(DELIVERED_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

const deliveredKeys = loadDelivered();

function persistDelivered() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      DELIVERED_STORAGE,
      JSON.stringify([...deliveredKeys].slice(-500)),
    );
  } catch {
    /* quota */
  }
}

export function helpdeskMessageDeliveryKey(messageId: string | number | null | undefined): string | null {
  const id = String(messageId || "").trim();
  return id ? `hd:msg:${id}` : null;
}

export function internalChatDeliveryKey(
  chatId: number | string | null | undefined,
  messageId: string | number | null | undefined,
): string | null {
  const chat = Number(chatId);
  const msg = String(messageId || "").trim();
  if (!Number.isFinite(chat) || chat <= 0 || !msg) return null;
  return `ic:${chat}:${msg}`;
}

export function notificationRecordDeliveryKey(
  notificationId?: number | null,
  entityId?: string | null,
): string | null {
  if (notificationId && notificationId > 0) return `nid:${notificationId}`;
  const entity = String(entityId || "").trim();
  return entity ? `entity:${entity}` : null;
}

export function wasNotificationDelivered(key: string | null | undefined): boolean {
  if (!key) return false;
  return deliveredKeys.has(key);
}

export function markNotificationDelivered(key: string | null | undefined) {
  if (!key || deliveredKeys.has(key)) return;
  deliveredKeys.add(key);
  persistDelivered();
}

/** Executa o callback só na primeira entrega desta chave na sessão. */
export function deliverNotificationOnce(key: string | null | undefined, deliver: () => void): boolean {
  if (!key || wasNotificationDelivered(key)) return false;
  markNotificationDelivered(key);
  deliver();
  return true;
}
