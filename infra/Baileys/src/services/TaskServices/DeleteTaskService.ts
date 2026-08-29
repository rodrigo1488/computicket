import Task from "../../models/Task";
import AppError from "../../errors/AppError";

const DeleteTaskService = async (id: number | string, companyId: number): Promise<void> => {
  const task = await Task.findOne({
    where: { id, companyId }
  });

  if (!task) {
    throw new AppError("ERR_NO_TASK_FOUND", 404);
  }

  await task.destroy();
};

export default DeleteTaskService;

