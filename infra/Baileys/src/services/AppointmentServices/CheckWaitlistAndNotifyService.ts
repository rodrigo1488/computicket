import { Op } from "sequelize";
import AppointmentWaitlist from "../../models/AppointmentWaitlist";
import Form from "../../models/Form";
import Whatsapp from "../../models/Whatsapp";
import GetAvailabilityService from "./GetAvailabilityService";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FormatWaitlistAvailabilityMessage from "../FormServices/FormatWaitlistAvailabilityMessage";
import { logger } from "../../utils/logger";

const DAYS_TO_CHECK = 3;

const CheckWaitlistAndNotifyService = async (): Promise<void> => {
  const entries = await AppointmentWaitlist.findAll({
    where: { notifiedAt: null },
    include: [
      { association: "form", attributes: ["id", "slug", "companyId", "settings"] },
      { association: "appointmentService", attributes: ["id", "name", "durationMinutes", "userId"] },
      { association: "assignedUser", attributes: ["id", "name"] },
    ],
  });

  for (const entry of entries) {
    const form = entry.form as Form & { settings?: any };
    if (!form || (form.settings as any)?.formType !== "agendamento") continue;

    const slug = form.slug;
    const serviceId = entry.appointmentServiceId;
    const userId = entry.assignedUserId;
    const preferredDate = entry.preferredDate;

    let slotsFound: { date: string; slots: string } | null = null;
    for (let d = 0; d < DAYS_TO_CHECK; d++) {
      const dDate = new Date(preferredDate + "T12:00:00");
      dDate.setDate(dDate.getDate() + d);
      const dateStr = dDate.toISOString().slice(0, 10);
      try {
        const { slots } = await GetAvailabilityService({
          formSlug: slug,
          serviceId,
          userId,
          date: dateStr,
        });
        if (slots.length > 0) {
          const preview = slots.slice(0, 5).map((s) => s.startTime).join(", ") + (slots.length > 5 ? "..." : "");
          slotsFound = { date: dateStr, slots: preview };
          break;
        }
      } catch (_) {
        // skip day
      }
    }

    if (!slotsFound) continue;

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
        name: entry.responderName || "Cliente",
        number: entry.responderPhone,
        email: entry.responderEmail || undefined,
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

      const serviceName = (entry as any).appointmentService?.name || "Serviço";
      const professionalName = (entry as any).assignedUser?.name || "Profissional";
      const msg = FormatWaitlistAvailabilityMessage({
        serviceName,
        professionalName,
        customerName: entry.responderName || "Cliente",
        dateStr: slotsFound.date,
        slotsPreview: slotsFound.slots,
      });
      await SendWhatsAppMessage({ body: msg, ticket });
      await entry.update({ notifiedAt: new Date() });
      logger.info(`Waitlist notified: entry ${entry.id}`);
    } catch (err: any) {
      logger.error(`CheckWaitlistAndNotify: entry ${entry.id}:`, err?.message);
    }
  }
};

export default CheckWaitlistAndNotifyService;
