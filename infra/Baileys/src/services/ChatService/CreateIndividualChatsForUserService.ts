import { Op } from "sequelize";
import Chat from "../../models/Chat";
import ChatUser from "../../models/ChatUser";
import User from "../../models/User";

interface Data {
  userId: number;
  companyId: number;
}

const CreateIndividualChatsForUserService = async (data: Data): Promise<void> => {
  const { userId, companyId } = data;

  // Buscar todos os usuários da empresa (exceto o usuário atual)
  const companyUsers = await User.findAll({
    where: {
      companyId,
      id: { [Op.ne]: userId }
    },
    attributes: ["id", "name"]
  });

  // Para cada usuário da empresa, criar ou encontrar um chat individual
  for (const otherUser of companyUsers) {
    // Verificar se já existe um chat individual entre esses dois usuários
    // Buscar chats onde ambos os usuários estão presentes
    const chatUsersForCurrentUser = await ChatUser.findAll({
      where: { userId }
    });

    const chatIdsForCurrentUser = chatUsersForCurrentUser.map(cu => cu.chatId);

    const chatUsersForOtherUser = await ChatUser.findAll({
      where: {
        userId: otherUser.id,
        chatId: { [Op.in]: chatIdsForCurrentUser }
      }
    });

    const commonChatIds = chatUsersForOtherUser.map(cu => cu.chatId);

    if (commonChatIds.length > 0) {
      // Verificar se algum desses chats é individual (não é grupo)
      const existingChat = await Chat.findOne({
        where: {
          id: { [Op.in]: commonChatIds },
          isGroup: false,
          companyId
        }
      });

      if (existingChat) {
        // Verificar se ambos os usuários estão no chat
        const chatUsers = await ChatUser.findAll({
          where: { chatId: existingChat.id }
        });

        const userIdsInChat = chatUsers.map(cu => cu.userId);
        const bothUsersInChat = userIdsInChat.includes(userId) && userIdsInChat.includes(otherUser.id);

        if (!bothUsersInChat) {
          // Adicionar o usuário que falta
          if (!userIdsInChat.includes(userId)) {
            await ChatUser.create({
              chatId: existingChat.id,
              userId: userId,
              unreads: 0
            });
          }
          if (!userIdsInChat.includes(otherUser.id)) {
            await ChatUser.create({
              chatId: existingChat.id,
              userId: otherUser.id,
              unreads: 0
            });
          }
        }
        continue;
      }
    }

    // Garantir que sempre usamos o menor ID como ownerId para consistência
    const ownerId = userId < otherUser.id ? userId : otherUser.id;

    // Criar novo chat individual
    const chat = await Chat.create({
      ownerId: ownerId,
      companyId,
      title: otherUser.name, // Nome do outro usuário
      isGroup: false
    });

    // Adicionar ambos os usuários ao chat
    await ChatUser.create({
      chatId: chat.id,
      userId: userId,
      unreads: 0
    });

    await ChatUser.create({
      chatId: chat.id,
      userId: otherUser.id,
      unreads: 0
    });
  }
};

export default CreateIndividualChatsForUserService;
