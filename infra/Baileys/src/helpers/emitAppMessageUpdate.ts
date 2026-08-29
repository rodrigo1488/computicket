import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Queue from "../models/Queue";
import Whatsapp from "../models/Whatsapp";

/**
 * Recarrega a mensagem com os mesmos includes usados em CreateMessageService
 * e emite `company-{companyId}-appMessage` com action `update`.
 */
export const emitAppMessageUpdate = async (
  messageId: string,
  companyId: number
): Promise<void> => {
  const message = await Message.findByPk(messageId, {
    attributes: { exclude: ["dataJson"] },
    include: [
      {
        model: Contact,
        as: "contact",
        required: false,
        attributes: ["id", "name", "number", "isGroup", "profilePicUrl"]
      },
      {
        model: Ticket,
        as: "ticket",
        attributes: [
          "id",
          "uuid",
          "status",
          "queueId",
          "userId",
          "contactId",
          "companyId",
          "lastMessage",
          "fromMe",
          "isGroup",
          "unreadMessages"
        ],
        include: [
          {
            model: Contact,
            as: "contact",
            required: false,
            attributes: ["id", "name", "number", "isGroup", "profilePicUrl"]
          },
          { model: Queue, as: "queue", required: false, attributes: ["id", "name"] },
          { model: Whatsapp, as: "whatsapp", required: false, attributes: ["name", "type"] }
        ]
      },
      {
        model: Message,
        as: "quotedMsg",
        required: false,
        attributes: [
          "id",
          "body",
          "fromMe",
          "mediaType",
          "mediaUrl",
          "transcription",
          "transcriptionStatus",
          "transcriptionError"
        ],
        include: [{ model: Contact, as: "contact", required: false, attributes: ["id", "name"] }]
      }
    ]
  });

  if (!message) {
    return;
  }

  const ticket = message.ticket as any;
  const io = getIO();

  io.to(message.ticketId.toString())
    .to(`company-${companyId}-${ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${message.ticket.queueId}-${ticket.status}`)
    .to(`queue-${message.ticket.queueId}-notification`)
    .emit(`company-${companyId}-appMessage`, {
      action: "update",
      message
    });
};
