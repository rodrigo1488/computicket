import { Op } from "sequelize";
import Appointment from "../../models/Appointment";
import Form from "../../models/Form";
import Whatsapp from "../../models/Whatsapp";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FormatAppointmentReminderMessage from "../FormServices/FormatAppointmentReminderMessage";
import { createAppointmentToken } from "../../helpers/MesaLinkSign";
import { logger } from "../../utils/logger";

/** Lembretes configuráveis por form (settings.agendamento.reminderHours, ex: [24, 1]). */
const CheckAgendamentoRemindersService = async (): Promise<void> => {
  const now = new Date();

  const appointments = await Appointment.findAll({
    where: {
      status: { [Op.in]: ["pending", "confirmed"] },
      startTime: { [Op.gt]: now },
    },
    include: [
      { association: "form", attributes: ["id", "companyId", "settings"] },
      { association: "appointmentService", attributes: ["id", "name"] },
      { association: "assignedUser", attributes: ["id", "name"] },
    ],
  });

  for (const apt of appointments) {
    const form = apt.form as Form & { settings?: any };
    if (!form || (form.settings as any)?.formType !== "agendamento") continue;

    const agendamento = (form.settings as any)?.agendamento || {};
    const reminderHours = Array.isArray(agendamento.reminderHours)
      ? agendamento.reminderHours.filter((h: unknown) => typeof h === "number" && h > 0)
      : [24, 1];
    if (reminderHours.length === 0) continue;

    const meta = (apt.metadata as any) || {};
    const sent = Array.isArray(meta.reminderSentHours) ? meta.reminderSentHours : [];

    const startTime = new Date(apt.startTime);
    const responderPhone = (apt as any).responderPhone?.trim();
    if (!responderPhone) continue;

    for (const hours of reminderHours) {
      if (sent.includes(hours)) continue;
      const reminderAt = new Date(startTime.getTime() - hours * 60 * 60 * 1000);
      if (now < reminderAt) continue;

      try {
        const selectedWhatsappId = (form.settings as any)?.whatsappId;
        let whatsappToUse = selectedWhatsappId
          ? await Whatsapp.findOne({
              where: { id: selectedWhatsappId, companyId: form.companyId, status: "CONNECTED" },
            })
          : null;
        if (!whatsappToUse) whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        if (!whatsappToUse) continue;

        const contact = await CreateOrUpdateContactService({
          name: (apt as any).responderName || "Cliente",
          number: responderPhone,
          email: undefined,
          isGroup: false,
          companyId: form.companyId,
        });
        if (!contact) continue;

        const ticket = await FindOrCreateTicketService(
          contact,
          whatsappToUse.id,
          0,
          form.companyId
        );
        const serviceName = (apt as any).appointmentService?.name || "Serviço";
        const professionalName = (apt as any).assignedUser?.name || "Profissional";
        const baseUrl = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "";
        const token = createAppointmentToken(apt.id);
        const cancelUrl = baseUrl ? `${baseUrl}/f/${(form as any).slug}/cancelar?token=${token}` : undefined;
        const rescheduleUrl = baseUrl ? `${baseUrl}/f/${(form as any).slug}/reagendar?token=${token}` : undefined;
        const msg = FormatAppointmentReminderMessage({
          serviceName,
          professionalName,
          startTime: apt.startTime,
          endTime: apt.endTime,
          customerName: (apt as any).responderName || "Cliente",
          hoursBefore: hours,
          cancelUrl,
          rescheduleUrl,
        });
        await SendWhatsAppMessage({ body: msg, ticket });
        const newSent = [...sent, hours];
        await apt.update({
          metadata: { ...meta, reminderSentHours: newSent },
        });
        logger.info(`Agendamento reminder sent: appointment ${apt.id}, ${hours}h before`);
      } catch (err: any) {
        logger.error(`CheckAgendamentoReminders: appointment ${apt.id}, ${hours}h:`, err?.message);
      }
    }
  }
};

export default CheckAgendamentoRemindersService;
