import AppError from "../../errors/AppError";
import ChatMessage from "../../models/ChatMessage";
import ChatUser from "../../models/ChatUser";
import User from "../../models/User";

import { sortBy } from "lodash";

interface Request {
  chatId: string;
  ownerId: number;
  pageNumber?: string;
}

interface Response {
  records: ChatMessage[];
  count: number;
  hasMore: boolean;
}

const FindMessages = async ({
  chatId,
  ownerId,
  pageNumber = "1"
}: Request): Promise<Response> => {
  const userInChat = await ChatUser.count({
    where: { chatId, userId: ownerId }
  });

  if (userInChat === 0) {
    throw new AppError("UNAUTHORIZED", 400);
  }

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  // Para a primeira página, buscar as mensagens mais recentes
  // Para páginas seguintes, buscar mensagens mais antigas (scroll infinito)
  const isFirstPage = pageNumber === "1";
  
  const { count, rows: records } = await ChatMessage.findAndCountAll({
    where: {
      chatId
    },
    include: [{ model: User, as: "sender", attributes: ["id", "name", "avatar"] }],
    limit,
    offset,
    order: isFirstPage 
      ? [["createdAt", "DESC"], ["id", "DESC"]] // Primeira página: mais recentes primeiro
      : [["createdAt", "ASC"], ["id", "ASC"]]   // Páginas seguintes: mais antigas primeiro
  });

  const hasMore = count > offset + records.length;

  // Se é a primeira página, reverter a ordem para mostrar mais antigas primeiro, mais recentes por último
  const sortedRecords = isFirstPage ? records.reverse() : records;

  return {
    records: sortedRecords,
    count,
    hasMore
  };
};

export default FindMessages;
