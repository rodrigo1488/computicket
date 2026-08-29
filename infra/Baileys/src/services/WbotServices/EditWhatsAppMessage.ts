import { WASocket } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import GetWbotMessage from "../../helpers/GetWbotMessage";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

interface Request {
  messageId: string;
  body: string;
}

const EditWhatsAppMessage = async ({
  messageId,
  body
}: Request): Promise<Message> => {
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

  const messageToEdit = await GetWbotMessage(ticket, messageId);
  const msgToEdit = messageToEdit as Message;

  const wbot = await GetTicketWbot(ticket);

  if (!wbot) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  if (!message.fromMe) {
    throw new AppError("ERR_CANNOT_EDIT_OTHER_MESSAGE");
  }

  if (message.mediaType === "reactionMessage" || message.mediaType === "image" || message.mediaType === "video" || message.mediaType === "audio" || message.mediaType === "document" || message.mediaType === "sticker") {
    throw new AppError("ERR_CANNOT_EDIT_MEDIA");
  }

  if (!body || typeof body !== "string" || body.trim().length === 0) {
    throw new AppError("ERR_MESSAGE_BODY_REQUIRED");
  }

  const key = {
    id: msgToEdit.id,
    remoteJid: msgToEdit.remoteJid,
    participant: msgToEdit.participant || undefined,
    fromMe: msgToEdit.fromMe
  };

  try {
    await (wbot as WASocket).sendMessage(msgToEdit.remoteJid, {
      edit: key,
      text: body
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("EditWhatsAppMessage error:", err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }

  await message.update({ body, isEdited: true });

  return message;
};

export default EditWhatsAppMessage;
