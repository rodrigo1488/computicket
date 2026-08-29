import Task from "../../models/Task";
import AppError from "../../errors/AppError";
import ShowTaskService from "./ShowTaskService";
import UpdateUserAppointmentService from "../UserAppointmentService/UpdateService";
import { logger } from "../../utils/logger";

interface TaskData {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: Date | null;
  completedAt?: Date | null;
  category?: string;
  assignedToId?: number | null;
  contactId?: number | null;
  ticketId?: number | null;
  skipAppointmentSync?: boolean; // Flag para evitar loop infinito
}

interface Request {
  taskId: number | string;
  taskData: TaskData;
  companyId: number;
}

const UpdateTaskService = async ({
  taskId,
  taskData,
  companyId
}: Request): Promise<Task> => {
  const task = await ShowTaskService(taskId, companyId);
  const { skipAppointmentSync, ...updateFields } = taskData;

  // Se status mudou para "completed", definir completedAt
  if (updateFields.status === "completed" && task.status !== "completed") {
    updateFields.completedAt = new Date();
  }

  // Se status mudou de "completed" para outro, limpar completedAt
  if (task.status === "completed" && updateFields.status && updateFields.status !== "completed") {
    updateFields.completedAt = null;
  }

  // Verificar se precisa sincronizar com agendamento vinculado
  const shouldSyncStatus = !skipAppointmentSync && 
                           task.appointmentId && 
                           updateFields.status && 
                           (updateFields.status === "completed" || updateFields.status === "cancelled") &&
                           task.status !== updateFields.status;

  const shouldSyncDueDate = !skipAppointmentSync && 
                            task.appointmentId && 
                            updateFields.dueDate && 
                            task.dueDate?.getTime() !== new Date(updateFields.dueDate).getTime();

  await task.update(updateFields);

  // Sincronizar com agendamento se necessário
  if (shouldSyncStatus || shouldSyncDueDate) {
    try {
      const appointmentUpdate: any = {};

      // Sincronizar status
      if (shouldSyncStatus) {
        appointmentUpdate.status = updateFields.status;
        logger.info(`Sincronizando status da tarefa ${task.id} para agendamento ${task.appointmentId}: ${updateFields.status}`);
      }

      // Sincronizar datas
      if (shouldSyncDueDate && updateFields.dueDate) {
        const newStartTime = new Date(updateFields.dueDate);
        
        // Se a hora for meia-noite, usar 09:00 como padrão
        if (newStartTime.getHours() === 0 && newStartTime.getMinutes() === 0) {
          newStartTime.setHours(9, 0, 0, 0);
        }
        
        const newEndTime = new Date(newStartTime);
        newEndTime.setHours(newEndTime.getHours() + 1);

        appointmentUpdate.startTime = newStartTime;
        appointmentUpdate.endTime = newEndTime;
        logger.info(`Sincronizando dueDate da tarefa ${task.id} para agendamento ${task.appointmentId}`);
      }

      await UpdateUserAppointmentService({
        appointmentId: task.appointmentId.toString(),
        ...appointmentUpdate,
        skipTaskSync: true // Evitar loop infinito
      });
    } catch (error: any) {
      logger.error(`Erro ao sincronizar agendamento ${task.appointmentId} da tarefa ${task.id}:`, error);
      // Não falhar a atualização da tarefa se a sincronização falhar
    }
  }

  await task.reload({
    include: ["appointment", "user", "assignedTo", "contact", "ticket"]
  });

  return task;
};

export default UpdateTaskService;

