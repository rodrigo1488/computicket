import { Op } from "sequelize";

import User from "../../models/User";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Task from "../../models/Task";
import UpdateDeletedUserOpenTicketsStatus from "../../helpers/UpdateDeletedUserOpenTicketsStatus";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

const DeleteUserService = async (
  id: string | number,
  companyId: number
): Promise<void> => {
  const user = await User.findOne({
    where: { id, companyId },
  });

  if (!user) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  if (user.profile === "admin") {
    const otherAdmins = await User.count({
      where: {
        companyId,
        profile: "admin",
        id: { [Op.ne]: user.id },
      },
    });
    if (otherAdmins === 0) {
      throw new AppError("ERR_LAST_ACTIVE_ADMIN", 400);
    }
  }

  const userOpenTickets: Ticket[] = await user.$get("tickets", {
    where: { status: "open" }
  });

  if (userOpenTickets.length > 0) {
    UpdateDeletedUserOpenTicketsStatus(userOpenTickets, companyId);
  }

  const userTasksCount = await Task.count({
    where: {
      userId: user.id,
      companyId
    }
  });

  if (userTasksCount > 0) {
    throw new AppError(
      "Não é possível excluir este usuário porque existem tarefas vinculadas. Reatribua/exclua as tarefas ou inative o usuário.",
      400
    );
  }

  const deletedUserId = user.id;
  await user.destroy();

  void CacheInvalidationService.onUserChanged(deletedUserId, companyId);
};

export default DeleteUserService;
