import { Op } from "sequelize";
import Chat from "../../models/Chat";
import ChatUser from "../../models/ChatUser";
import User from "../../models/User";

interface Request {
  ownerId: number;
  pageNumber?: string;
  isGroup?: boolean;
}

interface Response {
  records: Chat[];
  count: number;
  hasMore: boolean;
}

const ListService = async ({
  ownerId,
  pageNumber = "1",
  isGroup
}: Request): Promise<Response> => {
  const chatUsers = await ChatUser.findAll({
    where: { userId: ownerId }
  });

  const chatIds = chatUsers.map(chat => chat.chatId);

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const whereCondition: any = {
    id: {
      [Op.in]: chatIds
    }
  };

  if (isGroup !== undefined) {
    whereCondition.isGroup = isGroup;
  }

  const { count, rows: records } = await Chat.findAndCountAll({
    where: whereCondition,
    include: [
      { model: User, as: "owner", attributes: ["id", "name", "avatar"] },
      { model: ChatUser, as: "users", include: [{ model: User, as: "user", attributes: ["id", "name", "avatar"] }] }
    ],
    limit,
    offset,
    order: [["createdAt", "DESC"]]
  });

  const hasMore = count > offset + records.length;

  return {
    records,
    count,
    hasMore
  };
};

export default ListService;
