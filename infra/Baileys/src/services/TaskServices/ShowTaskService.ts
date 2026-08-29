import Task from "../../models/Task";
import User from "../../models/User";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";

const ShowTaskService = async (id: number | string, companyId: number): Promise<Task> => {
  const task = await Task.findOne({
    where: { id, companyId },
    include: [
      {
        model: User,
        as: "user",
        attributes: ["id", "name", "email"]
      },
      {
        model: User,
        as: "assignedTo",
        attributes: ["id", "name", "email"]
      },
      {
        model: Contact,
        as: "contact",
        attributes: ["id", "name", "number"]
      },
      {
        model: Ticket,
        as: "ticket",
        attributes: ["id", "status"]
      }
    ]
  });

  if (!task) {
    throw new AppError("ERR_NO_TASK_FOUND", 404);
  }

  return task;
};

export default ShowTaskService;

