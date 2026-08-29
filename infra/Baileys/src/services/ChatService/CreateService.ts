import Chat from "../../models/Chat";
import ChatUser from "../../models/ChatUser";
import User from "../../models/User";

interface Data {
  ownerId: number;
  companyId: number;
  users: any[];
  title: string;
  isGroup?: boolean;
}

const CreateService = async (data: Data): Promise<Chat> => {
  const { ownerId, companyId, users, title, isGroup = false } = data;

  const record = await Chat.create({
    ownerId,
    companyId,
    title,
    isGroup
  });

  if (Array.isArray(users) && users.length > 0) {
    const participantIds = Array.from(
      new Set(
        [ownerId, ...users.map(user => Number(user.id))]
          .filter(id => Number.isInteger(id) && id > 0)
      )
    );

    for (const participantId of participantIds) {
      await ChatUser.create({ chatId: record.id, userId: participantId });
    }
  }

  await record.reload({
    include: [
      { model: ChatUser, as: "users", include: [{ model: User, as: "user" }] },
      { model: User, as: "owner" }
    ]
  });

  return record;
};

export default CreateService;
