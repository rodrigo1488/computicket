import type { HelpdeskMessage } from "./helpdesk.ts";

/** Reescreve URL interna do engine (whatsapp-engine:4000/public/...) para o proxy Flask. */
export function publicMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw || /nopicture/i.test(raw)) return null;
  if (raw.includes("/helpdesk/api/media/")) {
    const idx = raw.indexOf("/helpdesk/api/media/");
    return `/flask${raw.slice(idx)}`;
  }
  const publicIdx = raw.indexOf("/public/");
  if (publicIdx >= 0) {
    const path = raw.slice(publicIdx + "/public/".length).split(/[?#]/)[0];
    if (!path || path.split("/").includes("..")) return null;
    return `/flask/helpdesk/api/media/${path}`;
  }
  if (raw.startsWith("public/")) {
    return `/flask/helpdesk/api/media/${raw.slice("public/".length).split(/[?#]/)[0]}`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw;
}

export function isTempMessageId(id?: string | null) {
  return !!id && String(id).startsWith("temp-");
}

export function sameInternalFlags(a: HelpdeskMessage, b: HelpdeskMessage) {
  return !!(a.isInternal || a.isPrivate) === !!(b.isInternal || b.isPrivate);
}

export function normalizeMessageBody(value?: string | null) {
  return (value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function isMediaMessage(m: HelpdeskMessage) {
  if (m.mediaUrl) return true;
  const t = (m.mediaType || "").toLowerCase();
  if (!t || t === "conversation" || t === "chat") return false;
  return /^(image|audio|video|application|document|sticker|ptt)/.test(t);
}

/** ISO estável para ordenar; Date/number do socket não podem ir para o epoch (topo da conversa). */
export function normalizeMessageCreatedAt(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  return undefined;
}

function messageCreatedAtMs(m: HelpdeskMessage): number {
  const t = Date.parse(m.createdAt || "");
  // Sem data: trata como a mais nova para não jogar mensagem recém-chegada no início.
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function sortMessagesChronologically(rows: HelpdeskMessage[]): HelpdeskMessage[] {
  return [...rows].sort((a, b) => {
    const dt = messageCreatedAtMs(a) - messageCreatedAtMs(b);
    if (dt !== 0) return dt;
    return String(a.id).localeCompare(String(b.id));
  });
}

function messageLooksSettled(real: HelpdeskMessage, pending: HelpdeskMessage) {
  if (isTempMessageId(real.id)) return false;
  if (!!real.fromMe !== !!pending.fromMe) return false;
  if (!sameInternalFlags(real, pending)) return false;
  if (isMediaMessage(real) !== isMediaMessage(pending)) return false;
  if (isMediaMessage(pending)) return true;
  return normalizeMessageBody(real.body) === normalizeMessageBody(pending.body);
}

/**
 * GET da página 1 traz só as N mais recentes.
 * - Quando `preserveOlder` é falso (apenas página 1 carregada), mantém só
 *   placeholders `temp-` e itens da janela atual (ainda não persistidos).
 * - Quando `preserveOlder` é verdadeiro (o usuário já paginou páginas 2+),
 *   preserva também mensagens reais mais antigas já carregadas, sem perdê-las
 *   no refetch periódico.
 */
export function retainOptimisticMessages(
  fetched: HelpdeskMessage[],
  previous?: HelpdeskMessage[],
  opts?: { preserveOlder?: boolean },
) {
  const orderedFetched = sortMessagesChronologically(fetched);
  if (!previous?.length) return orderedFetched;

  const preserveOlder = !!opts?.preserveOlder;
  const fetchedIds = new Set(orderedFetched.map((m) => String(m.id)));
  const oldestFetchedMs = orderedFetched.reduce((min, m) => {
    const t = Date.parse(m.createdAt || "");
    if (!Number.isFinite(t)) return min;
    return t < min ? t : min;
  }, Number.POSITIVE_INFINITY);

  const extras: HelpdeskMessage[] = [];
  for (const pending of previous) {
    const id = String(pending.id);
    if (fetchedIds.has(id)) continue;
    if (isTempMessageId(id)) {
      if (!orderedFetched.some((m) => messageLooksSettled(m, pending))) extras.push(pending);
      continue;
    }
    if (preserveOlder) {
      extras.push(pending);
      continue;
    }
    const t = Date.parse(pending.createdAt || "");
    if (!Number.isFinite(t) || t >= oldestFetchedMs) extras.push(pending);
  }
  return extras.length ? sortMessagesChronologically([...orderedFetched, ...extras]) : orderedFetched;
}

/**
 * Mescla uma página mais antiga (pageNumber >= 2) com o thread atual,
 * deduplicando por id (evita duplicatas por deslocamento de offset quando
 * novas mensagens chegam durante a paginação) e mantendo ordem cronológica.
 */
export function mergeOlderMessagesPage(
  previous: HelpdeskMessage[] | undefined,
  olderPage: HelpdeskMessage[],
): HelpdeskMessage[] {
  const current = previous || [];
  if (!olderPage.length) return sortMessagesChronologically(current);
  const existingIds = new Set(current.map((m) => String(m.id)));
  const additions: HelpdeskMessage[] = [];
  for (const msg of olderPage) {
    const id = msg.id != null ? String(msg.id) : "";
    if (!id || existingIds.has(id)) continue;
    existingIds.add(id);
    additions.push(msg);
  }
  if (!additions.length) return sortMessagesChronologically(current);
  return sortMessagesChronologically([...additions, ...current]);
}

function replaceMessageAt(current: HelpdeskMessage[], idx: number, nextMsg: HelpdeskMessage) {
  const copy = [...current];
  const prevUrl = copy[idx].mediaUrl;
  if (prevUrl?.startsWith("blob:") && prevUrl !== nextMsg.mediaUrl) URL.revokeObjectURL(prevUrl);
  copy[idx] = { ...copy[idx], ...nextMsg };
  return copy;
}

export function mergeMessageIntoThread(
  prev: HelpdeskMessage[] | undefined,
  incoming: HelpdeskMessage,
  opts?: { insertIfMissing?: boolean },
): HelpdeskMessage[] {
  const current = prev || [];
  const insertIfMissing = opts?.insertIfMissing !== false;
  const incomingId = incoming.id != null ? String(incoming.id) : "";
  if (!incomingId || incomingId === "undefined" || incomingId === "null") {
    return current;
  }
  const createdAt = normalizeMessageCreatedAt(incoming.createdAt);
  const nextMsg: HelpdeskMessage = {
    id: incomingId,
    body: incoming.body,
    fromMe: incoming.fromMe,
    createdAt,
    ack: incoming.ack,
    mediaType: incoming.mediaType,
    mediaUrl: publicMediaUrl(incoming.mediaUrl) || incoming.mediaUrl,
    isInternal: incoming.isInternal,
    isPrivate: incoming.isPrivate,
    quotedMsg: incoming.quotedMsg,
    isDeleted: incoming.isDeleted,
    isEdited: incoming.isEdited,
    ...(incoming.transcription !== undefined ? { transcription: incoming.transcription } : {}),
    ...(incoming.transcriptionStatus !== undefined
      ? { transcriptionStatus: incoming.transcriptionStatus }
      : {}),
    ...(incoming.transcriptionError !== undefined ? { transcriptionError: incoming.transcriptionError } : {}),
  };
  const byId = current.findIndex((m) => String(m.id) === nextMsg.id);
  if (byId >= 0) {
    return sortMessagesChronologically(
      replaceMessageAt(current, byId, {
        ...nextMsg,
        createdAt: nextMsg.createdAt || current[byId].createdAt,
      }),
    );
  }

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
    if (textTempExact >= 0) {
      return sortMessagesChronologically(replaceMessageAt(current, textTempExact, nextMsg));
    }

    if (isMediaMessage(nextMsg)) {
      const mediaTemp = current.findIndex(
        (m) =>
          isTempMessageId(m.id) &&
          !!m.fromMe === !!nextMsg.fromMe &&
          sameInternalFlags(m, nextMsg) &&
          isMediaMessage(m),
      );
      if (mediaTemp >= 0) {
        return sortMessagesChronologically(replaceMessageAt(current, mediaTemp, nextMsg));
      }
    }
  }

  if (!insertIfMissing) return current;
  return sortMessagesChronologically([...current, nextMsg]);
}
