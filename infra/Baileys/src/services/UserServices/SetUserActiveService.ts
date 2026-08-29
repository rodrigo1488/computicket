import { Op, Transaction } from "sequelize";

import User from "../../models/User";
import Chat from "../../models/Chat";
import ChatUser from "../../models/ChatUser";
import AppError from "../../errors/AppError";
import database from "../../database";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

interface Request {
  userId: string | number;
  companyId: number;
  requestUserId: number;
  active: boolean;
}

const SetUserActiveService = async ({
  userId,
  companyId,
  requestUserId,
  active,
}: Request): Promise<User> => {
  const user = await User.findOne({
    where: { id: userId, companyId },
  });

  if (!user) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  if (active === false) {
    if (Number(user.id) === Number(requestUserId)) {
      throw new AppError("ERR_CANNOT_DEACTIVATE_SELF", 400);
    }

    if (user.profile === "admin") {
      const otherActiveAdmins = await User.count({
        where: {
          companyId,
          profile: "admin",
          active: true,
          id: { [Op.ne]: user.id },
        },
      });
      if (otherActiveAdmins === 0) {
        throw new AppError("ERR_LAST_ACTIVE_ADMIN", 400);
      }
    }

    const transaction: Transaction = await database.transaction();

    try {
      await user.update(
        {
          active: false,
          tokenVersion: user.tokenVersion + 1,
          online: false,
        },
        { transaction }
      );

      const relatedChatUsers = await ChatUser.findAll({
        where: { userId: user.id },
        attributes: ["chatId"],
        transaction,
      });

      const relatedChatIds = relatedChatUsers.map(chatUser => chatUser.chatId);

      if (relatedChatIds.length > 0) {
        const individualChats = await Chat.findAll({
          where: {
            id: { [Op.in]: relatedChatIds },
            companyId,
            isGroup: false,
          },
          attributes: ["id"],
          transaction,
        });

        const individualChatIds = individualChats.map(chat => chat.id);

        if (individualChatIds.length > 0) {
          await Chat.destroy({
            where: {
              id: { [Op.in]: individualChatIds },
            },
            transaction,
          });
        }

        await ChatUser.destroy({
          where: {
            userId: user.id,
            chatId: { [Op.in]: relatedChatIds },
          },
          transaction,
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } else {
    await user.update({ active: true });
  }

  await user.reload();

  void CacheInvalidationService.onUserChanged(user.id, companyId);

  return user;
};

export default SetUserActiveService;
