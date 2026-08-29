import { Request, Response } from "express";
import AppError from "../errors/AppError";

import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Queue from "../models/Queue";
import Ticket from "../models/Ticket";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import formatBody from "../helpers/Mustache";

import ListMessagesService from "../services/MessageServices/ListMessagesService";
import SearchMessagesService from "../services/MessageServices/SearchMessagesService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import DeleteWhatsAppMessage from "../services/WbotServices/DeleteWhatsAppMessage";
import EditWhatsAppMessage from "../services/WbotServices/EditWhatsAppMessage";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import SendWhatsAppReaction from "../services/WbotServices/SendWhatsAppReaction";
import ForwardWhatsAppMessage from "../services/WbotServices/ForwardWhatsAppMessage";
import CreateMessageService from "../services/MessageServices/CreateMessageService";
import { verifyMessage } from "../services/WbotServices/wbotMessageListener";
import CheckContactNumber from "../services/WbotServices/CheckNumber";
import CheckIsValidContact from "../services/WbotServices/CheckIsValidContact";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import { logger } from "../utils/logger";
import canUserAccessTicket, {
  canUserSendOnTicket
} from "../helpers/CanUserAccessTicketQueue";
type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
  mentions?: string[];
  number?: string;
  closeTicket?: true;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;

  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    const ticket = await ShowTicketService(ticketId, companyId);
    if (!canUserAccessTicket(ticket, user)) {
      throw new AppError("ERR_ACCESS_DENIED_TICKET", 403);
    }
  }

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId,
    companyId,
    queues: []
  });

  SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const search = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { query } = req.query as { query?: string };
  const { companyId, profile } = req.user;

  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    const ticket = await ShowTicketService(ticketId, companyId);
    if (!canUserAccessTicket(ticket, user)) {
      throw new AppError("ERR_ACCESS_DENIED_TICKET", 403);
    }
  }

  const { messages } = await SearchMessagesService({
    ticketId,
    companyId,
    query: query || "",
    queues: []
  });

  return res.json({ messages });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg, mentions, isInternal }: MessageData & {
    isInternal?: boolean | string;
  } = req.body;
  const medias = req.files as Express.Multer.File[];
  const { companyId, profile } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);

  const isInternalMessage =
    isInternal === true ||
    (typeof isInternal === "string" && isInternal.toLowerCase() === "true");

  if (ticket.status === "closed" && !isInternalMessage) {
    throw new AppError("ERR_TICKET_CLOSED_CANNOT_SEND", 400);
  }

  if (!isInternalMessage && profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    if (!canUserSendOnTicket(ticket, user)) {
      if (ticket.status === "pending") {
        throw new AppError("ERR_TICKET_PENDING_MUST_ACCEPT", 400);
      }
      throw new AppError("ERR_ACCESS_DENIED_TICKET", 403);
    }
  }

  SetTicketMessagesAsRead(ticket);

  // Se for mensagem interna, apenas salvar no banco sem enviar via WhatsApp
  if (isInternalMessage) {
    // Criar mensagem interna diretamente no banco
    const messageData = {
      id: `${ticketId}-${Date.now()}`,
      body: body || "",
      ticketId: parseInt(ticketId),
      contactId: ticket.contactId,
      companyId: companyId,
      fromMe: true,
      read: true,
      isInternal: true,
      mediaType: "conversation"
    };

    await CreateMessageService({ messageData, companyId });
    return res.send();
  }

  // Mensagem normal - enviar via WhatsApp
  if (medias) {
    await Promise.all(
      medias.map(async (media: Express.Multer.File, index) => {
        await SendWhatsAppMedia({ media, ticket, body: Array.isArray(body) ? body[index] : body });
      })
    );
  } else {
    // Enfileirar envio para responder rápido ao frontend (otimização de UX).
    // O frontend já exibe a mensagem via atualização otimista; o job persiste e emite socket ao concluir.
    const queues = req.app.get("queues") as { messageQueue?: { add: (name: string, data: any, opts?: any) => Promise<unknown> } };
    if (queues?.messageQueue) {
      const quotedMsgId = quotedMsg && typeof quotedMsg === "object" && "id" in quotedMsg ? (quotedMsg as { id: string }).id : undefined;
      await queues.messageQueue.add(
        "SendTicketMessage",
        {
          ticketId: ticket.id,
          body: body || "",
          quotedMsgId,
          mentions,
          companyId
        },
        { removeOnComplete: true, attempts: 3 }
      );
      return res.send();
    }
    // Fallback: envio síncrono se fila não estiver disponível
    try {
      const sentMessage = await SendWhatsAppMessage({ body, ticket, quotedMsg, mentions });
      if (sentMessage && sentMessage.key) {
        await verifyMessage(sentMessage, ticket, ticket.contact);
      }
    } catch (error: any) {
      logger.error({
        msg: "MessageController.store: Erro ao enviar mensagem via WhatsApp",
        ticketId: ticket.id,
        companyId,
        error: error?.message || error
      });
      const errorMessageData = {
        id: `${ticket.id}-${Date.now()}-error`,
        ticketId: ticket.id,
        contactId: ticket.contactId,
        body: body || "",
        fromMe: true,
        read: true,
        mediaType: "conversation",
        ack: -1,
        companyId,
        dataJson: JSON.stringify({ error: error?.message || "Erro desconhecido", originalBody: body })
      };
      try {
        await CreateMessageService({ messageData: errorMessageData, companyId });
      } catch (saveError) {
        logger.error({ msg: "MessageController.store: Erro ao salvar mensagem de erro no banco", ticketId: ticket.id, error: saveError });
      }
      throw error;
    }
  }

  return res.send();
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { messageId } = req.params;
  const { companyId } = req.user;

  const message = await DeleteWhatsAppMessage(messageId);

  const io = getIO();
  io.to(message.ticketId.toString()).emit(`company-${companyId}-appMessage`, {
    action: "update",
    message
  });

  return res.send();
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { messageId } = req.params;
  const { body } = req.body as { body?: string };
  const { companyId } = req.user;

  const message = await EditWhatsAppMessage({ messageId, body: body || "" });

  const io = getIO();
  io.to(message.ticketId.toString()).emit(`company-${companyId}-appMessage`, {
    action: "update",
    message
  });

  return res.json(message);
};

export const react = async (req: Request, res: Response): Promise<Response> => {
  const { messageId } = req.params;
  const { emoji } = req.body as { emoji?: string };
  const { companyId } = req.user;

  const message = await Message.findByPk(messageId, {
    include: [{ model: Ticket, as: "ticket", attributes: ["companyId"] }]
  });

  if (!message) {
    return res.status(404).json({ error: "Mensagem não encontrada" });
  }

  if (message.mediaType === "reactionMessage") {
    return res.status(400).json({ error: "Não é possível reagir a uma reação" });
  }

  const ticket = (message as any).ticket;
  if (!ticket || ticket.companyId !== companyId) {
    return res.status(403).json({ error: "Acesso negado" });
  }

  await SendWhatsAppReaction({
    messageId,
    emoji: emoji || "👍"
  });

  return res.send();
};

export const forward = async (req: Request, res: Response): Promise<Response> => {
  const { messageId } = req.params;
  const { targetTicketId } = req.body as { targetTicketId?: number };
  const { companyId } = req.user;

  if (!targetTicketId) {
    return res.status(400).json({ error: "Conversa de destino é obrigatória" });
  }

  await ForwardWhatsAppMessage({
    messageId,
    targetTicketId,
    companyId
  });

  return res.send();
};

export const sendMessageByPhone = async (req: Request, res: Response): Promise<Response> => {
  const messageData: MessageData & { number: string } = req.body;
  const { companyId } = req.user;

  try {
    if (!messageData.number) {
      throw new Error("O número é obrigatório");
    }

    if (!messageData.body) {
      throw new Error("A mensagem é obrigatória");
    }

    // Buscar WhatsApp padrão da empresa
    const defaultWhatsapp = await Whatsapp.findOne({
      where: { isDefault: true, companyId, status: 'CONNECTED' }
    }) || await Whatsapp.findOne({
      where: { companyId, status: 'CONNECTED' }
    });

    if (!defaultWhatsapp) {
      throw new Error("Nenhuma conexão WhatsApp disponível");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
    const number = CheckValidNumber.jid.replace(/\D/g, "");
    const profilePicUrl = await GetProfilePicUrl(
      number,
      companyId
    );
    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: false,
      companyId
    };

    const contact = await CreateOrUpdateContactService(contactData);

    const ticket = await FindOrCreateTicketService(contact, defaultWhatsapp.id!, 0, companyId);

    await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });

    await ticket.update({
      lastMessage: body,
    });

    SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};

/** Envia arquivo (ex.: PDF do recibo) para um número via WhatsApp padrão da empresa (fila SendMessage). */
export const sendMediaByPhone = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const file = req.file as Express.Multer.File | undefined;

  if (!file?.path) {
    throw new AppError("Arquivo é obrigatório", 400);
  }

  const numberRaw = req.body?.number;
  const caption = typeof req.body?.body === "string" ? req.body.body : "Recibo";

  if (!numberRaw || typeof numberRaw !== "string") {
    throw new AppError("O número é obrigatório", 400);
  }

  const defaultWhatsapp =
    (await Whatsapp.findOne({
      where: { isDefault: true, companyId, status: "CONNECTED" }
    })) ||
    (await Whatsapp.findOne({
      where: { companyId, status: "CONNECTED" }
    }));

  if (!defaultWhatsapp) {
    throw new AppError("Nenhuma conexão WhatsApp disponível", 400);
  }

  const queues = req.app.get("queues") as
    | { messageQueue?: { add: (name: string, data: unknown, opts?: unknown) => Promise<unknown> } }
    | undefined;
  if (!queues?.messageQueue) {
    throw new AppError("Fila de mensagens indisponível", 503);
  }

  try {
    const CheckValidNumber = await CheckContactNumber(numberRaw, companyId);
    const number = CheckValidNumber.jid.replace(/\D/g, "");

    await queues.messageQueue.add(
      "SendMessage",
      {
        whatsappId: defaultWhatsapp.id,
        data: {
          number,
          body: caption || "Recibo",
          mediaPath: file.path,
          fileName: file.originalname || "recibo.pdf"
        }
      },
      { removeOnComplete: true, attempts: 3 }
    );

    return res.status(200).send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (!err || Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes",
        500
      );
    }
    throw new AppError(err.message || "Erro ao enviar mídia", 400);
  }
};

export const send = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;

    const companyId = whatsapp.companyId;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
    const number = CheckValidNumber.jid.replace(/\D/g, "");
    const profilePicUrl = await GetProfilePicUrl(
      number,
      companyId
    );
    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: false,
      companyId
    };

    const contact = await CreateOrUpdateContactService(contactData);

    const ticket = await FindOrCreateTicketService(contact, whatsapp.id!, 0, companyId);

    if (medias) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number,
                body: body ? formatBody(body, contact) : media.originalname,
                mediaPath: media.path,
                fileName: media.originalname
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {
      await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });

      await ticket.update({
        lastMessage: body,
      });

    }

    if (messageData.closeTicket) {
      setTimeout(async () => {
        await UpdateTicketService({
          ticketId: ticket.id,
          ticketData: { status: "closed" },
          companyId
        });
      }, 1000);
    }

    SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};

export const sendMessageFlow = async (
  whatsappId: number,
  body: any,
  req: Request,
  files?: Express.Multer.File[]
): Promise<String> => {
  const messageData = body;
  const medias = files;

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;

    const companyId = messageData.companyId;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
    const number = numberToTest.replace(/\D/g, "");

    if (medias) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number,
                body: media.originalname,
                mediaPath: media.path
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {
      req.app.get("queues").messageQueue.add(
        "SendMessage",
        {
          whatsappId,
          data: {
            number,
            body
          }
        },

        { removeOnComplete: false, attempts: 3 }
      );
    }

    return "Mensagem enviada";
  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};
