import { Op } from "sequelize";
import Chat from "../../models/Chat";
import ChatUser from "../../models/ChatUser";
import User from "../../models/User";

interface Data {
  userId: number;
  companyId: number;
}

const CreateOrFindUserChatService = async (data: Data): Promise<Chat> => {
  const { userId, companyId } = data;

  // Verificar se já existe um chat individual para este usuário
  const existingChat = await Chat.findOne({
    where: {
      companyId,
      isGroup: false,
      ownerId: userId
    },
    include: [
      { model: ChatUser, as: "users", include: [{ model: User, as: "user" }] },
      { model: User, as: "owner" }
    ]
  });

  if (existingChat) {
    return existingChat;
  }

  // Buscar o usuário para obter o nome
  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error("User not found");
  }

  // Criar novo chat individual
  const chat = await Chat.create({
    ownerId: userId,
    companyId,
    title: user.name,
    isGroup: false
  });

  // Adicionar o usuário ao chat
  await ChatUser.create({
    chatId: chat.id,
    userId: userId,
    unreads: 0
  });

  await chat.reload({
    include: [
      { model: ChatUser, as: "users", include: [{ model: User, as: "user" }] },
      { model: User, as: "owner" }
    ]
  });

  return chat;
};

export default CreateOrFindUserChatService;
