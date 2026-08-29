import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";
import UpdateTaskService from "../TaskServices/UpdateTaskService";
import { logger } from "../../utils/logger";

interface Request {
    appointmentId: string | number;
    title?: string;
    description?: string;
    startTime?: Date;
    endTime?: Date;
    assignedUserId?: number;
    status?: string;
    reminderMinutes?: number;
    skipTaskSync?: boolean; // Flag para evitar loop infinito
}

const UpdateService = async ({
    appointmentId,
    title,
    description,
    startTime,
    endTime,
    assignedUserId,
    status,
    reminderMinutes,
    skipTaskSync = false,
}: Request): Promise<UserAppointment> => {
    const appointment = await UserAppointment.findByPk(appointmentId);

    if (!appointment) {
        throw new AppError("ERR_NO_USER_APPOINTMENT_FOUND", 404);
    }

    // Validate that end time is after start time if both are provided
    const newStartTime = startTime || appointment.startTime;
    const newEndTime = endTime || appointment.endTime;

    if (new Date(newEndTime) <= new Date(newStartTime)) {
        throw new AppError("End time must be after start time", 400);
    }

    // Verificar se precisa sincronizar com tarefa vinculada
    const shouldSyncStatus = !skipTaskSync && 
                             appointment.taskId && 
                             status && 
                             (status === "completed" || status === "cancelled") &&
                             appointment.status !== status;

    const shouldSyncStartTime = !skipTaskSync && 
                                appointment.taskId && 
                                startTime && 
                                appointment.startTime.getTime() !== new Date(startTime).getTime();

    await appointment.update({
        title: title !== undefined ? title : appointment.title,
        description: description !== undefined ? description : appointment.description,
        startTime: startTime || appointment.startTime,
        endTime: endTime || appointment.endTime,
        assignedUserId: assignedUserId !== undefined ? assignedUserId : appointment.assignedUserId,
        status: status || appointment.status,
        reminderMinutes: reminderMinutes !== undefined ? reminderMinutes : appointment.reminderMinutes,
    });

    // Sincronizar com tarefa se necessário
    if (shouldSyncStatus || shouldSyncStartTime) {
        try {
            const taskUpdate: any = {};

            // Sincronizar status
            if (shouldSyncStatus) {
                taskUpdate.status = status;
                logger.info(`Sincronizando status do agendamento ${appointment.id} para tarefa ${appointment.taskId}: ${status}`);
            }

            // Sincronizar dueDate
            if (shouldSyncStartTime && startTime) {
                taskUpdate.dueDate = startTime;
                logger.info(`Sincronizando startTime do agendamento ${appointment.id} para tarefa ${appointment.taskId}`);
            }

            await UpdateTaskService({
                taskId: appointment.taskId.toString(),
                taskData: {
                    ...taskUpdate,
                    skipAppointmentSync: true // Evitar loop infinito
                },
                companyId: appointment.companyId
            });
        } catch (error: any) {
            logger.error(`Erro ao sincronizar tarefa ${appointment.taskId} do agendamento ${appointment.id}:`, error);
            // Não falhar a atualização do agendamento se a sincronização falhar
        }
    }

    await appointment.reload({
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
            { association: "task" },
        ],
    });

    return appointment;
};

export default UpdateService;
