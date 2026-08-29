import { WASocket } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import { getChatJid } from "./wbotMessageListener";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

interface Request {
  messageId: string;
  emoji: string;
}

const SendWhatsAppReaction = async ({
  messageId,
  emoji
}: Request): Promise<void> => {
  const message = await Message.findByPk(messageId, {
    include: [
      {
        model: Ticket,
        as: "ticket",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new AppError("ERR_NO_MESSAGE_FOUND");
  }

  const { ticket } = message as Message & { ticket: Ticket };

  if (!ticket.whatsappId) {
    throw new AppError("ERR_WAPP_NOT_FOUND");
  }

  const wbot = await GetTicketWbot(ticket);

  if (!wbot) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  const chatJid = getChatJid(ticket);

  const key = {
    id: message.id,
    remoteJid: message.remoteJid || chatJid,
    participant: message.participant || undefined,
    fromMe: message.fromMe
  };

  try {
    await (wbot as WASocket).sendMessage(chatJid, {
      react: {
        text: emoji || "👍",
        key
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("SendWhatsAppReaction error:", err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppReaction;
