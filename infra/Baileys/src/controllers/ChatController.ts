import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";

import CreateService from "../services/ChatService/CreateService";
import ListService from "../services/ChatService/ListService";
import ShowFromUuidService from "../services/ChatService/ShowFromUuidService";
import DeleteService from "../services/ChatService/DeleteService";
import FindMessages from "../services/ChatService/FindMessages";
import UpdateService from "../services/ChatService/UpdateService";
import CreateIndividualChatsForUserService from "../services/ChatService/CreateIndividualChatsForUserService";
import UnreadCountService from "../services/ChatService/UnreadCountService";

import Chat from "../models/Chat";
import ChatMessage from "../models/ChatMessage";
import CreateMessageService from "../services/ChatService/CreateMessageService";
import User from "../models/User";
import ChatUser from "../models/ChatUser";
import { notifyComputicketInternalChat } from "../helpers/notifyComputicketInternalChat";

const chatWithUsersInclude = [
  { model: User, as: "owner", attributes: ["id", "name", "avatar"] },
  {
    model: ChatUser,
    as: "users",
    include: [{ model: User, as: "user", attributes: ["id", "name", "avatar"] }]
  }
];

type IndexQuery = {
  pageNumber: string;
  pageSize?: string;
  companyId: string | number;
  ownerId?: number;
};

type StoreData = {
  users: any[];
  title: string;
  isGroup?: boolean;
};

type FindParams = {
  companyId: number;
  ownerId?: number;
};

const chatMessageIncludes = [
  { model: User, as: "sender", attributes: ["id", "name", "avatar"] },
  {
    model: ChatMessage,
    as: "quotedMsg",
    required: false,
    include: [{ model: User, as: "sender", attributes: ["id", "name", "avatar"] }]
  }
];

function parseQuotedMsgId(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "object" && raw && "id" in raw) {
    const id = Number((raw as { id?: unknown }).id);
    return Number.isFinite(id) && id > 0 ? id : undefined;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function emitChatMessage(
  companyId: number,
  chat: Chat | null,
  newMessage: ChatMessage,
  action: "new-message" | "update-message" | "delete-message"
) {
  const chatId = chat?.id || newMessage.chatId;
  const io = getIO();
  const payload = { action, newMessage, chat };
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-chat-${chatId}`, payload);
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-chat`, payload);
  (chat?.users || []).forEach(user => {
    io.to(`user-${user.userId}`).emit(`company-${companyId}-chat-user-${user.userId}`, payload);
  });
}

async function assertUserInChat(chatId: number, userId: number) {
  const userInChat = await ChatUser.count({ where: { chatId, userId } });
  if (userInChat === 0) {
    throw new AppError("UNAUTHORIZED", 403);
  }
}

async function loadChatMessage(chatId: number, messageId: number) {
  const message = await ChatMessage.findOne({
    where: { id: messageId, chatId },
    include: chatMessageIncludes
  });
  if (!message) {
    throw new AppError("Mensagem não encontrada", 404);
  }
  return message;
}

async function refreshChatLastMessage(chat: Chat, message: ChatMessage, senderName: string) {
  const latest = await ChatMessage.findOne({
    where: { chatId: chat.id },
    order: [["id", "DESC"]]
  });
  if (!latest || latest.id !== message.id) return;
  const text = message.isDeleted
    ? `${senderName}: Mensagem apagada`
    : message.mediaName
      ? `${senderName}: 📎 ${message.mediaName}`
      : `${senderName}: ${message.message}`;
  await chat.update({ lastMessage: text });
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { pageNumber, pageSize, isGroup } = req.query as unknown as IndexQuery & { isGroup?: string };
  const ownerId = +req.user.id;
  const { companyId } = req.user;

  // Se estamos buscando chats individuais (isGroup === false ou não especificado)
  const isGroupFilter = isGroup === "true" ? true : isGroup === "false" ? false : undefined;
  
  if (isGroupFilter === false || isGroupFilter === undefined) {
    // Criar ou atualizar chats individuais com todos os usuários da empresa
    await CreateIndividualChatsForUserService({
      userId: ownerId,
      companyId
    });
  }

  const { records, count, hasMore } = await ListService({
    ownerId,
    pageNumber,
    pageSize,
    isGroup: isGroupFilter
  });

  return res.json({ records, count, hasMore });
};

export const unreadCount = async (req: Request, res: Response): Promise<Response> => {
  const ownerId = +req.user.id;
  const count = await UnreadCountService(ownerId);
  return res.json({ count });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const ownerId = +req.user.id;
  const data = req.body as StoreData;

  const record = await CreateService({
    ...data,
    ownerId,
    companyId,
    isGroup: data.isGroup !== undefined ? data.isGroup : (data.users && data.users.length > 0)
  });

  const io = getIO();

  record.users.forEach(user => {
    io.to(`user-${user.userId}`).emit(`company-${companyId}-chat-user-${user.userId}`, {
      action: "create",
      record
    });
  });

  return res.status(200).json(record);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body;
  const { id } = req.params;

  const record = await UpdateService({
    ...data,
    id: +id
  });

  const io = getIO();

  record.users.forEach(user => {
    io.to(`user-${user.userId}`).emit(`company-${companyId}-chat-user-${user.userId}`, {
      action: "update",
      record
    });
  });

  return res.status(200).json(record);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const record = await ShowFromUuidService(id);

  return res.status(200).json(record);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteService(id);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-chat`, {
    action: "delete",
    id
  });

  return res.status(200).json({ message: "Chat deleted" });
};

export const saveMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { message } = req.body;
  const { id } = req.params;
  const senderId = +req.user.id;
  const chatId = +id;
  const file = req.file as Express.Multer.File;
  const quotedMsgId = parseQuotedMsgId(req.body.quotedMsgId || req.body.quotedMsg);

  await assertUserInChat(chatId, senderId);

  if (quotedMsgId) {
    const quoted = await ChatMessage.findOne({ where: { id: quotedMsgId, chatId } });
    if (!quoted || quoted.isDeleted) {
      throw new AppError("Mensagem citada não encontrada", 400);
    }
  }

  let mediaPath = null;
  let mediaName = null;

  if (file) {
    mediaPath = `chat-media/${file.filename}`;
    mediaName = file.originalname;
  }

  // Se há arquivo mas não há mensagem, envia string vazia
  // Se há arquivo e mensagem, envia a mensagem normalmente
  const messageText = file && !message ? "" : (message || "");

  const newMessage = await CreateMessageService({
    chatId,
    senderId,
    message: messageText,
    mediaPath,
    mediaName,
    quotedMsgId
  });

  const chat = await Chat.findByPk(chatId, {
    include: chatWithUsersInclude
  });

  emitChatMessage(companyId, chat, newMessage, "new-message");

  void notifyComputicketInternalChat({
    id: newMessage.id,
    chatId,
    senderEngineUserId: senderId,
    senderName: newMessage.sender?.name,
    body: messageText,
    mediaName,
    isGroup: !!chat?.isGroup,
    chatTitle: chat?.title,
    recipientEngineUserIds: (chat?.users || []).map(user => user.userId)
  });

  return res.json(newMessage);
};

export const updateMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const senderId = +req.user.id;
  const chatId = +req.params.id;
  const messageId = +req.params.messageId;
  const body = String((req.body as { message?: string; body?: string }).message
    ?? (req.body as { message?: string; body?: string }).body
    ?? "").trim();

  await assertUserInChat(chatId, senderId);
  const message = await loadChatMessage(chatId, messageId);

  if (message.senderId !== senderId) {
    throw new AppError("ERR_CANNOT_EDIT_OTHER_MESSAGE", 403);
  }
  if (message.isDeleted) {
    throw new AppError("Não é possível editar uma mensagem apagada", 400);
  }
  if (message.mediaPath) {
    throw new AppError("ERR_CANNOT_EDIT_MEDIA", 400);
  }
  if (!body) {
    throw new AppError("ERR_MESSAGE_BODY_REQUIRED", 400);
  }

  await message.update({ message: body, isEdited: true });
  await message.reload({ include: chatMessageIncludes });

  const chat = await Chat.findByPk(chatId, { include: chatWithUsersInclude });
  if (chat) {
    await refreshChatLastMessage(chat, message, message.sender?.name || "Colaborador");
    await chat.reload({ include: chatWithUsersInclude });
  }

  emitChatMessage(companyId, chat, message, "update-message");
  return res.json(message);
};

export const deleteMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const senderId = +req.user.id;
  const chatId = +req.params.id;
  const messageId = +req.params.messageId;

  await assertUserInChat(chatId, senderId);
  const message = await loadChatMessage(chatId, messageId);

  if (message.senderId !== senderId) {
    throw new AppError("ERR_CANNOT_DELETE_OTHER_MESSAGE", 403);
  }
  if (!message.isDeleted) {
    await message.update({ isDeleted: true });
    await message.reload({ include: chatMessageIncludes });
  }

  const chat = await Chat.findByPk(chatId, { include: chatWithUsersInclude });
  if (chat) {
    await refreshChatLastMessage(chat, message, message.sender?.name || "Colaborador");
    await chat.reload({ include: chatWithUsersInclude });
  }

  emitChatMessage(companyId, chat, message, "delete-message");
  return res.json(message);
};

export const checkAsRead = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { userId } = req.body;
  const { id } = req.params;

  const chatUser = await ChatUser.findOne({ where: { chatId: id, userId } });
  await chatUser.update({ unreads: 0 });

  const chat = await Chat.findByPk(id, {
    include: chatWithUsersInclude
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-chat-${id}`, {
    action: "update",
    chat
  });

  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-chat`, {
    action: "update",
    chat
  });

  return res.json(chat);
};

export const messages = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { pageNumber } = req.query as unknown as IndexQuery;
  const { id: chatId } = req.params;
  const ownerId = +req.user.id;

  const { records, count, hasMore } = await FindMessages({
    chatId,
    ownerId,
    pageNumber
  });

  return res.json({ records, count, hasMore });
};
