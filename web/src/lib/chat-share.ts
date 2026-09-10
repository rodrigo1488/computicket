export const CHAT_SHARE_PREFIX = "::computicket-share::";

export type ChatShareKind = "ticket" | "knowledge" | "vault" | "helpdesk";

export type ChatSharePayload = {
  kind: ChatShareKind;
  id: number | string;
  title: string;
  subtitle?: string;
  status?: string;
  url: string;
};

export function chatShareKindLabel(kind: ChatShareKind) {
  if (kind === "ticket") return "Ticket";
  if (kind === "knowledge") return "Conhecimento";
  if (kind === "vault") return "Cofre";
  return "Help Desk";
}

export function encodeChatShare(payload: ChatSharePayload, note?: string) {
  const headline = `${chatShareKindLabel(payload.kind)}: ${payload.title}`.trim();
  const parts = [headline, `${CHAT_SHARE_PREFIX}${JSON.stringify(payload)}`];
  const extra = (note || "").trim();
  if (extra) parts.push(extra);
  return parts.join("\n");
}

function extractJsonObject(text: string): { json: string; rest: string } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { json: text.slice(start, i + 1), rest: text.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

export function parseChatShare(message?: string | null): { payload: ChatSharePayload; note: string } | null {
  const text = (message || "").trim();
  const idx = text.indexOf(CHAT_SHARE_PREFIX);
  if (idx < 0) return null;
  const extracted = extractJsonObject(text.slice(idx + CHAT_SHARE_PREFIX.length));
  if (!extracted) return null;
  try {
    const payload = JSON.parse(extracted.json) as ChatSharePayload;
    if (!payload?.kind || !payload.title || !payload.url) return null;
    if (!["ticket", "knowledge", "vault", "helpdesk"].includes(payload.kind)) return null;
    return { payload, note: extracted.rest };
  } catch {
    return null;
  }
}

export function chatSharePreview(message?: string | null) {
  const parsed = parseChatShare(message);
  if (!parsed) return (message || "").trim();
  return `${chatShareKindLabel(parsed.payload.kind)}: ${parsed.payload.title}`;
}
