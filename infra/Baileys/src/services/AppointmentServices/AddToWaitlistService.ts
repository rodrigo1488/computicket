import Form from "../../models/Form";
import AppointmentService from "../../models/AppointmentService";
import AppointmentWaitlist from "../../models/AppointmentWaitlist";
import AppError from "../../errors/AppError";
import { findPublicFormBySlug } from "../FormServices/FindPublicFormService";

interface Request {
  slug: string;
  appointmentServiceId: number;
  assignedUserId: number;
  preferredDate: string; // YYYY-MM-DD
  responderName?: string;
  responderPhone: string;
  responderEmail?: string;
}

const AddToWaitlistService = async ({
  slug,
  appointmentServiceId,
  assignedUserId,
  preferredDate,
  responderName,
  responderPhone,
  responderEmail,
}: Request): Promise<AppointmentWaitlist> => {
  const form = await findPublicFormBySlug(slug, {
    attributes: ["id", "companyId", "settings"],
  });

  const formSettings = form.settings as any;
  if (formSettings?.formType !== "agendamento") {
    throw new AppError("ERR_FORM_NOT_AGENDAMENTO", 400);
  }

  const service = await AppointmentService.findOne({
    where: {
      id: appointmentServiceId,
      companyId: form.companyId,
      userId: assignedUserId,
      isActive: true,
    },
  });

  if (!service) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
  }

  const phone = String(responderPhone || "").trim().replace(/\D/g, "");
  if (phone.length < 10) {
    throw new AppError("Telefone é obrigatório e deve ser válido", 400);
  }

  const entry = await AppointmentWaitlist.create({
    companyId: form.companyId,
    formId: form.id,
    appointmentServiceId,
    assignedUserId,
    preferredDate,
    responderName: responderName?.trim() || "Cliente",
    responderPhone: responderPhone.trim(),
    responderEmail: responderEmail?.trim() || null,
  });

  return entry;
};

export default AddToWaitlistService;
