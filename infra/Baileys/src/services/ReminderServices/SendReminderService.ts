import Contact from "../../models/Contact";
import UserAppointment from "../../models/UserAppointment";
import Task from "../../models/Task";
import { logger } from "../../utils/logger";
import SendWhatsAppReminderService from "./SendWhatsAppReminderService";
import SendInternalReminderService from "./SendInternalReminderService";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type ReminderType = "appointment" | "task";

const SendReminderService = async (
  type: ReminderType,
  item: UserAppointment | Task
): Promise<void> => {
  try {
    // Determinar o usuário alvo (quem receberá o lembrete)
    let targetUser;
    if (type === "appointment") {
      const appointment = item as UserAppointment;
      targetUser = appointment.assignedUser || appointment.user;
    } else {
      const task = item as Task;
      targetUser = task.assignedTo || task.user;
    }

    if (!targetUser) {
      logger.warn(
        `${type} ${item.id} não possui usuário atribuído ou criador`
      );
      return;
    }

    const companyId = item.companyId;

    // Buscar contato vinculado ao usuário
    const contact = await Contact.findOne({
      where: { userId: targetUser.id, companyId }
    });

    // Montar mensagem
    let message: string;
    if (type === "appointment") {
      const appointment = item as UserAppointment;
      const formattedDate = format(
        new Date(appointment.startTime),
        "dd/MM/yyyy 'às' HH:mm",
        { locale: ptBR }
      );
      message = `🔔 *Lembrete de Agendamento*\n\n📅 *${appointment.title}*\n⏰ ${formattedDate}`;
      if (appointment.description) {
        message += `\n📝 ${appointment.description}`;
      }
    } else {
      const task = item as Task;
      const formattedDate = format(
        new Date(task.dueDate!),
        "dd/MM/yyyy 'às' HH:mm",
        { locale: ptBR }
      );
      message = `🔔 *Lembrete de Tarefa*\n\n📋 *${task.title}*\n⏰ Vence em: ${formattedDate}`;
      if (task.description) {
        message += `\n📝 ${task.description}`;
      }
      message += `\n🎯 Prioridade: ${task.priority}`;
    }

    // Enviar lembrete
    if (contact) {
      // Enviar via WhatsApp
      logger.info(
        `Enviando lembrete de ${type} ${item.id} via WhatsApp para contato ${contact.id}`
      );
      await SendWhatsAppReminderService(contact, message, companyId);
    } else {
      // Enviar mensagem interna
      logger.info(
        `Enviando lembrete de ${type} ${item.id} via chat interno para usuário ${targetUser.id}`
      );
      await SendInternalReminderService(targetUser, message, companyId);
    }

    // Marcar como enviado
    await item.update({ notificationSent: true });
    logger.info(`Lembrete de ${type} ${item.id} enviado com sucesso`);
  } catch (error: any) {
    logger.error(`Erro ao enviar lembrete de ${type} ${item.id}:`, error);
    throw error;
  }
};

export default SendReminderService;
