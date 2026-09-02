import axios from "axios";
import { logger } from "../utils/logger";

export type InternalChatNotifyPayload = {
  id: string | number;
  chatId: number;
  senderEngineUserId: number;
  senderName?: string | null;
  body?: string | null;
  mediaName?: string | null;
  isGroup?: boolean | null;
  chatTitle?: string | null;
  recipientEngineUserIds: number[];
};

/**
 * Avisa o Computicket (Flask) para criar AppNotification + Web Push
 * aos participantes do chat interno (1:1 e grupo), exceto o remetente.
 */
export async function notifyComputicketInternalChat(
  payload: InternalChatNotifyPayload
): Promise<void> {
  const recipients = Array.from(
    new Set(
      (payload.recipientEngineUserIds || []).filter(
        id => Number(id) && Number(id) !== Number(payload.senderEngineUserId)
      )
    )
  );
  if (!recipients.length) return;

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
    logger.debug("notifyComputicketInternalChat: token interno ausente — skip");
    return;
  }

  try {
    await axios.post(
      `${base}/api/notifications/internal-chat`,
      {
        id: payload.id,
        messageId: payload.id,
        chatId: payload.chatId,
        senderEngineUserId: payload.senderEngineUserId,
        senderName: payload.senderName,
        body: payload.body,
        mediaName: payload.mediaName,
        isGroup: !!payload.isGroup,
        chatTitle: payload.chatTitle,
        recipientEngineUserIds: recipients
      },
      {
        headers: { "X-Internal-Token": token },
        timeout: 8000,
        validateStatus: () => true
      }
    );
  } catch (error: any) {
    logger.warn({
      msg: "notifyComputicketInternalChat: falha de rede",
      error: error?.message || error
    });
  }
}
