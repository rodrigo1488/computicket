import ChatUser from "../../models/ChatUser";

const UnreadCountService = async (userId: number): Promise<number> => {
  const rows = await ChatUser.findAll({
    where: { userId },
    attributes: ["unreads"]
  });

  return rows.reduce((sum, row) => sum + (Number(row.unreads) || 0), 0);
};

export default UnreadCountService;
