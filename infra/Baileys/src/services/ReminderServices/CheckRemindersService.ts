import { Op, Sequelize } from "sequelize";
import UserAppointment from "../../models/UserAppointment";
import Task from "../../models/Task";
import { logger } from "../../utils/logger";
import SendReminderService from "./SendReminderService";

const CheckRemindersService = async (): Promise<void> => {
  try {
    const now = new Date();

    // 1. Agendamentos na janela de lembrete (filtro no SQL, não em memória)
    const appointments = await UserAppointment.findAll({
      where: {
        notificationSent: false,
        status: {
          [Op.notIn]: ["cancelled", "completed"]
        },
        startTime: {
          [Op.gt]: now
        },
        [Op.and]: [
          Sequelize.where(
            Sequelize.literal(
              `"startTime" - (COALESCE("reminderMinutes", 0) * interval '1 minute')`
            ),
            { [Op.lte]: now }
          )
        ]
      },
      include: [
        {
          association: "user",
          attributes: ["id", "name", "email"]
        },
        {
          association: "assignedUser",
          attributes: ["id", "name", "email"]
        }
      ]
    });

    // 2. Buscar tarefas que precisam de lembrete (15 minutos antes do vencimento)
    const fifteenMinutesFromNow = new Date();
    fifteenMinutesFromNow.setMinutes(fifteenMinutesFromNow.getMinutes() + 15);

    const tasks = await Task.findAll({
      where: {
        notificationSent: false,
        status: {
          [Op.notIn]: ["cancelled", "completed"]
        },
        dueDate: {
          [Op.and]: [
            // dueDate deve estar no futuro
            { [Op.gt]: new Date() },
            // dueDate deve estar dentro dos próximos 15 minutos
            { [Op.lte]: fifteenMinutesFromNow }
          ]
        }
      },
      include: [
        {
          association: "user",
          attributes: ["id", "name", "email"]
        },
        {
          association: "assignedTo",
          attributes: ["id", "name", "email"]
        }
      ]
    });

    // Log removido para reduzir ruído - usar logger.debug se necessário

    // 3. Processar lembretes de agendamentos
    for (const appointment of appointments) {
      try {
        await SendReminderService("appointment", appointment);
      } catch (error: any) {
        logger.error(
          `Erro ao enviar lembrete do agendamento ${appointment.id}:`,
          error
        );
      }
    }

    // 4. Processar lembretes de tarefas
    for (const task of tasks) {
      try {
        await SendReminderService("task", task);
      } catch (error: any) {
        logger.error(`Erro ao enviar lembrete da tarefa ${task.id}:`, error);
      }
    }
  } catch (error: any) {
    logger.error("Erro ao verificar lembretes:", error);
    throw error;
  }
};

export default CheckRemindersService;
