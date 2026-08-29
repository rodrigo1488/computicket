import * as Sentry from "@sentry/node";
import { logger } from "../../utils/logger";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import formatBody from "../../helpers/Mustache";
import axios from "axios";
import fs from "fs";
import path from "path";
import { lookup, extension as mimeExtension } from "mime-types";

/**
 * Processa mensagem recebida do webhook Gupshup
 * 
 * Formato esperado do payload Gupshup (exemplo):
 * {
 *   "app": "appName",
 *   "timestamp": "1234567890",
 *   "version": 2,
 *   "type": "message",
 *   "payload": {
 *     "id": "messageId",
 *     "source": "5511999999999",
 *     "destination": "appName",
 *     "type": "text",
 *     "payload": {
 *       "text": "Mensagem de texto"
 *     }
 *   }
 * }
 */
export const processGupshupWebhook = async (payload: any): Promise<void> => {
  try {
    // Extrair informações do payload
    const appName = payload.app || payload.payload?.destination;
    if (!appName) {
      logger.error("Gupshup webhook: appName não encontrado no payload");
      return;
    }

    // Buscar Whatsapp pelo gupshupAppName
    const whatsapp = await Whatsapp.findOne({
      where: {
        gupshupAppName: appName,
        provider: "gupshup"
      }
    });

    if (!whatsapp) {
      logger.error(`Gupshup webhook: Whatsapp não encontrado para appName: ${appName}`);
      return;
    }

    const companyId = whatsapp.companyId;
    const messagePayload = payload.payload || payload;

    // Extrair informações da mensagem
    const messageId = messagePayload.id || messagePayload.messageId;
    const sourceNumber = messagePayload.source || messagePayload.from;
    const messageType = messagePayload.type || "text";
    const messageContent = messagePayload.payload || messagePayload;

    if (!sourceNumber) {
      logger.error("Gupshup webhook: número de origem não encontrado");
      return;
    }

    // Limpar número (remover caracteres não numéricos)
    const cleanNumber = sourceNumber.replace(/\D/g, "");

    // Verificar se mensagem já foi processada
    const messageExists = await Message.count({
      where: {
        id: messageId,
        companyId
      }
    });

    if (messageExists) {
      logger.debug(`Gupshup webhook: Mensagem ${messageId} já processada`);
      return;
    }

    // Criar ou atualizar contato
    const contactData = {
      name: cleanNumber,
      number: cleanNumber,
      profilePicUrl: "",
      isGroup: false,
      companyId,
      whatsappId: whatsapp.id
    };

    const contact = await CreateOrUpdateContactService(contactData);

    // Criar ou obter ticket
    const ticket = await FindOrCreateTicketService(
      contact,
      whatsapp.id,
      0,
      companyId
    );

    // Extrair corpo da mensagem baseado no tipo
    let bodyMessage = "";
    let mediaUrl = "";
    let mediaType = messageType;
    let savedMediaFilename = "";

    if (messageType === "text") {
      bodyMessage = messageContent.text || messageContent.message || "";
    } else if (messageType === "image") {
      bodyMessage = messageContent.caption || "";
      mediaUrl = messageContent.originalUrl || messageContent.url || messageContent.mediaUrl || "";
      mediaType = "image";
    } else if (messageType === "video") {
      bodyMessage = messageContent.caption || "";
      mediaUrl = messageContent.url || messageContent.mediaUrl || "";
      mediaType = "video";
    } else if (messageType === "audio") {
      bodyMessage = messageContent.caption || "";
      mediaUrl = messageContent.url || messageContent.mediaUrl || "";
      mediaType = "audio";
    } else if (messageType === "document" || messageType === "file") {
      bodyMessage = messageContent.caption || messageContent.filename || "";
      mediaUrl = messageContent.url || messageContent.mediaUrl || "";
      mediaType = "document";
    } else {
      bodyMessage = JSON.stringify(messageContent);
    }

    // Se houver mídia, baixar e salvar localmente
    if (mediaUrl) {
      try {
        const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");
        const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
        
        // Determinar extensão do arquivo
        const contentTypeHeader = response.headers["content-type"];
        const mimeType =
          (typeof contentTypeHeader === "string"
            ? contentTypeHeader.split(";")[0].trim()
            : undefined) ||
          lookup(mediaUrl) ||
          "application/octet-stream";
        const ext = mimeExtension(mimeType) || "bin";
        const timestamp = new Date().getTime();
        
        savedMediaFilename = `${timestamp}_${messageId}.${ext}`;
        const filePath = path.join(publicFolder, savedMediaFilename);
        
        fs.writeFileSync(filePath, response.data);
        logger.info(`Gupshup webhook: Mídia baixada e salva: ${savedMediaFilename}`);
      } catch (error) {
        logger.error(`Erro ao baixar mídia do webhook Gupshup: ${error}`);
        Sentry.captureException(error);
      }
    }

    // Criar mensagem no banco
    const messageData = {
      id: messageId,
      ticketId: ticket.id,
      contactId: contact.id,
      body: bodyMessage,
      fromMe: false,
      mediaType: mediaType,
      mediaUrl: savedMediaFilename || null,
      read: false,
      ack: 0,
      remoteJid: `${cleanNumber}@s.whatsapp.net`,
      dataJson: JSON.stringify(payload)
    };

    await CreateMessageService({ messageData, companyId });

    // Atualizar última mensagem do ticket
    await ticket.update({ lastMessage: bodyMessage });

    // Se ticket estava fechado, reabrir
    if (ticket.status === "closed") {
      await ticket.update({ status: "pending", sessionStartedAt: new Date() });
    }

    logger.info(`Gupshup webhook: Mensagem processada - ID: ${messageId}, Contato: ${cleanNumber}`);
  } catch (error) {
    Sentry.captureException(error);
    logger.error(`Erro ao processar webhook Gupshup: ${error}`);
    throw error;
  }
};

