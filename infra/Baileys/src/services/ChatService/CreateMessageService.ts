import { Op } from "sequelize";
import Chat from "../../models/Chat";
import ChatMessage from "../../models/ChatMessage";
import ChatUser from "../../models/ChatUser";
import User from "../../models/User";

export interface ChatMessageData {
  senderId: number;
  chatId: number;
  message: string;
  mediaPath?: string;
  mediaName?: string;
}

export default async function CreateMessageService({
  senderId,
  chatId,
  message,
  mediaPath,
  mediaName
}: ChatMessageData) {
  const newMessage = await ChatMessage.create({
    senderId,
    chatId,
    message,
    mediaPath: mediaPath || null,
    mediaName: mediaName || null
  });

  await newMessage.reload({
    include: [
      { model: User, as: "sender", attributes: ["id", "name", "avatar"] },
      {
        model: Chat,
        as: "chat",
        include: [{ model: ChatUser, as: "users" }]
      }
    ]
  });

  const sender = await User.findByPk(senderId);

  const lastMessageText = mediaName 
    ? `${sender.name}: 📎 ${mediaName}` 
    : `${sender.name}: ${message}`;
  await newMessage.chat.update({ lastMessage: lastMessageText });

  const chatUsers = await ChatUser.findAll({
    where: { chatId }
  });

  for (let chatUser of chatUsers) {
    if (chatUser.userId === senderId) {
      await chatUser.update({ unreads: 0 });
    } else {
      await chatUser.update({ unreads: chatUser.unreads + 1 });
    }
  }

  return newMessage;
}
