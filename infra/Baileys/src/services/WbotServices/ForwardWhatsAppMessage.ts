import { WAMessage } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";

interface Request {
  messageId: string;
  targetTicketId: number;
  companyId: number;
}

const ForwardWhatsAppMessage = async ({
  messageId,
  targetTicketId,
  companyId
}: Request): Promise<WAMessage | any> => {
  try {
    // Buscar mensagem original
    const sourceMessage = await Message.findByPk(messageId, {
      include: [
        {
          model: Ticket,
          as: "ticket",
          include: [{ model: Contact, as: "contact" }]
        }
      ]
    });

    if (!sourceMessage) {
      throw new AppError("Mensagem não encontrada");
    }

    const sourceTicket = (sourceMessage as any).ticket;
    if (!sourceTicket || sourceTicket.companyId !== companyId) {
      throw new AppError("Acesso negado à mensagem");
    }

    // Buscar ticket de destino
    const targetTicket = await Ticket.findByPk(targetTicketId, {
      include: [{ model: Contact, as: "contact" }]
    });

    if (!targetTicket) {
      throw new AppError("Conversa de destino não encontrada");
    }

    if (targetTicket.companyId !== companyId) {
      throw new AppError("Acesso negado à conversa de destino");
    }

    // Verificar se ambos os tickets usam o mesmo WhatsApp
    if (sourceTicket.whatsappId !== targetTicket.whatsappId) {
      throw new AppError("Não é possível encaminhar mensagens entre diferentes conexões WhatsApp");
    }

    // Verificar tipo de mídia
    const mediaType = sourceMessage.mediaType;
    const hasMedia = mediaType && sourceMessage.mediaUrl && 
      !["conversation", "extendedTextMessage"].includes(mediaType);

    let forwardedMessage: any;

    if (hasMedia) {
      // Encaminhar mídia usando SendWhatsAppMedia
      const SendWhatsAppMedia = (await import("./SendWhatsAppMedia")).default;
      const path = require("path");
      const fs = require("fs");
      
      const mediaPath = sourceMessage.mediaUrl.replace(
        `${process.env.BACKEND_URL}/public/`,
        ""
      );
      const fullMediaPath = path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "public",
        mediaPath
      );

      if (!fs.existsSync(fullMediaPath)) {
        throw new AppError("Arquivo de mídia não encontrado");
      }

      // Criar um objeto File-like para passar para SendWhatsAppMedia
      const mediaFile = {
        path: fullMediaPath,
        originalname: path.basename(mediaPath),
        mimetype: require("mime-types").lookup(fullMediaPath) || "application/octet-stream"
      } as Express.Multer.File;

      forwardedMessage = await SendWhatsAppMedia({
        media: mediaFile,
        ticket: targetTicket,
        body: sourceMessage.body
      });
    } else {
      // Encaminhar mensagem de texto usando SendWhatsAppMessage
      const SendWhatsAppMessage = (await import("./SendWhatsAppMessage")).default;
      const forwardBody = sourceMessage.body || "";
      forwardedMessage = await SendWhatsAppMessage({
        body: forwardBody,
        ticket: targetTicket
      });
    }

    // Marcar a mensagem no destino como encaminhada (a mensagem é criada pelo listener; atualizar após um curto delay)
    const sentId = forwardedMessage?.key?.id;
    if (sentId && targetTicketId) {
      setTimeout(() => {
        Message.update(
          { isForwarded: true },
          { where: { id: sentId, ticketId: targetTicketId } }
        ).catch(() => {});
      }, 2000);
    }

    return forwardedMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_FORWARDING_WAPP_MSG");
  }
};

export default ForwardWhatsAppMessage;
