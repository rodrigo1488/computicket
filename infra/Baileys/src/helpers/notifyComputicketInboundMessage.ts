import axios from "axios";
import { logger } from "../utils/logger";

type InboundNotifyPayload = {
  id: string;
  ticketId?: number | null;
  body?: string | null;
  fromMe?: boolean | null;
  engineUserId?: number | null;
  contactName?: string | null;
  ticketStatus?: string | null;
};

const recentInbound = new Map<string, number>();
const INBOUND_DEDUPE_MS = 12_000;

function inboundDedupeKey(payload: InboundNotifyPayload): string {
  const ticket = payload.ticketId != null ? String(payload.ticketId) : "none";
  const body = String(payload.body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${ticket}:${payload.id}:${body}`;
}

function shouldNotifyInbound(payload: InboundNotifyPayload): boolean {
  const now = Date.now();
  for (const [key, ts] of recentInbound) {
    if (now - ts > INBOUND_DEDUPE_MS) recentInbound.delete(key);
  }
  const exact = inboundDedupeKey(payload);
  const ticketBurst =
    payload.ticketId != null
      ? `ticket:${payload.ticketId}:${String(payload.body || "").replace(/\s+/g, " ").trim().slice(0, 160)}`
      : exact;
  if (recentInbound.has(exact) || recentInbound.has(ticketBurst)) return false;
  recentInbound.set(exact, now);
  recentInbound.set(ticketBurst, now);
  return true;
}

/**
 * Avisa o Computicket (Flask) na hora — toast/push/badge sem depender do poll
 * nem do Socket.IO do browser.
 */
export async function notifyComputicketInboundMessage(
  payload: InboundNotifyPayload
): Promise<void> {
  if (payload.fromMe) return;
  if (!shouldNotifyInbound(payload)) return;

  const base = (
    process.env.COMPUTICKET_API_URL ||
    process.env.BACKEND_URL_COMPUTICKET ||
    "http://api:5000"
  ).replace(/\/$/, "");
  const token = (
    process.env.COMPUTICKET_INTERNAL_TOKEN ||
    process.env.JWT_SECRET ||
    ""
  ).trim();
  if (!token) {
    logger.debug("notifyComputicketInboundMessage: token interno ausente — skip");
    return;
  }

  try {
    await axios.post(
      `${base}/api/notifications/engine-inbound`,
      {
        id: payload.id,
        messageId: payload.id,
        ticketId: payload.ticketId,
        body: payload.body,
        fromMe: false,
        engineUserId: payload.engineUserId,
        userId: payload.engineUserId,
        contactName: payload.contactName,
        ticketStatus: payload.ticketStatus
      },
      {
        headers: { "X-Internal-Token": token },
        timeout: 8000,
        validateStatus: () => true
      }
    );
  } catch (error: any) {
    logger.warn({
      msg: "notifyComputicketInboundMessage: falha de rede",
      error: error?.message || error
    });
  }
}
