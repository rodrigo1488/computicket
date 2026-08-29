import { Request, Response } from "express";
import * as Yup from "yup";
import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";
import Form from "../models/Form";
import AppointmentService from "../models/AppointmentService";
import ListAppointmentsService from "../services/AppointmentServices/ListAppointmentsService";
import ShowAppointmentService from "../services/AppointmentServices/ShowAppointmentService";
import UpdateAppointmentService from "../services/AppointmentServices/UpdateAppointmentService";
import GetAvailabilityService from "../services/AppointmentServices/GetAvailabilityService";
import AddToWaitlistService from "../services/AppointmentServices/AddToWaitlistService";
import GetAppointmentByTokenService from "../services/AppointmentServices/GetAppointmentByTokenService";
import CheckCancellationPolicyService from "../services/AppointmentServices/CheckCancellationPolicyService";
import CancelAppointmentByTokenService from "../services/AppointmentServices/CancelAppointmentByTokenService";
import RescheduleAppointmentByTokenService from "../services/AppointmentServices/RescheduleAppointmentByTokenService";
import GenerateAppointmentIcalService from "../services/AppointmentServices/GenerateAppointmentIcalService";
import { findPublicFormBySlug } from "../services/FormServices/FindPublicFormService";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { formId, assignedUserId, dateFrom, dateTo, status } = req.query;

  const list = await ListAppointmentsService({
    companyId,
    formId: formId != null ? Number(formId) : undefined,
    assignedUserId: assignedUserId != null ? Number(assignedUserId) : undefined,
    dateFrom: dateFrom ? new Date(String(dateFrom)) : undefined,
    dateTo: dateTo ? new Date(String(dateTo)) : undefined,
    status: status as string,
  });

  return res.json(list);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;

  const appointment = await ShowAppointmentService({
    appointmentId: Number(id),
    companyId,
  });

  return res.json(appointment);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;
  const data = req.body;

  const schema = Yup.object().shape({
    status: Yup.string().oneOf(["pending", "confirmed", "cancelled", "completed"]).nullable(),
    startTime: Yup.date().nullable(),
    endTime: Yup.date().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  if (data.status === "cancelled") {
    const policy = await CheckCancellationPolicyService({
      appointmentId: Number(id),
      companyId,
    });
    if (!policy.allowed) {
      throw new AppError(policy.message, 400);
    }
  }

  const appointment = await UpdateAppointmentService({
    appointmentId: Number(id),
    companyId,
    status: data.status,
    startTime: data.startTime,
    endTime: data.endTime,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-appointment`, {
    action: "update",
    appointment,
  });

  return res.status(200).json(appointment);
};

/** Public: list appointment services for a form (by slug). Used by public agendamento form. */
export const getPublicAppointmentServices = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;

  const form = await findPublicFormBySlug(publicId, {
    attributes: ["id", "companyId", "settings"],
  });

  const formSettings = form.settings as any;
  if (formSettings?.formType !== "agendamento") {
    throw new AppError("ERR_FORM_NOT_AGENDAMENTO", 400);
  }

  const services = await AppointmentService.findAll({
    where: { companyId: form.companyId, isActive: true },
    include: [{ association: "user", attributes: ["id", "name", "avatar"] }],
    order: [
      ["displayOrder", "ASC"],
      ["name", "ASC"],
    ],
    attributes: ["id", "name", "durationMinutes", "value", "description", "userId"],
  });

  return res.json({ services });
};

/** Public: get available slots for a service and professional on a date. */
export const getAvailability = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const { serviceId, userId, date } = req.query;

  if (!serviceId || !userId || !date || typeof date !== "string") {
    throw new AppError("serviceId, userId and date are required", 400);
  }

  const result = await GetAvailabilityService({
    formSlug: publicId,
    serviceId: Number(serviceId),
    userId: Number(userId),
    date: String(date),
  });

  return res.json(result);
};

/** Public: add to waitlist (service + professional + preferred date + contact). */
export const addToWaitlist = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const { appointmentServiceId, assignedUserId, preferredDate, responderName, responderPhone, responderEmail } = req.body;

  if (!appointmentServiceId || !assignedUserId || !preferredDate || !responderPhone) {
    throw new AppError("appointmentServiceId, assignedUserId, preferredDate and responderPhone are required", 400);
  }

  const entry = await AddToWaitlistService({
    slug: publicId,
    appointmentServiceId: Number(appointmentServiceId),
    assignedUserId: Number(assignedUserId),
    preferredDate: String(preferredDate),
    responderName,
    responderPhone: String(responderPhone),
    responderEmail,
  });

  return res.status(201).json({ success: true, message: "Você foi adicionado à lista de espera. Avisaremos quando houver vaga.", id: entry.id });
};

/** Public: get appointment by token (for cancel/reschedule pages). Slug must match appointment form. */
export const getByToken = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    throw new AppError("Token é obrigatório", 400);
  }
  const { appointment, form } = await GetAppointmentByTokenService({ token, formSlug: publicId });
  const agendamento = (form.settings as any)?.agendamento || {};
  return res.json({
    appointment: {
      id: appointment.id,
      startTime: (appointment as any).startTime,
      endTime: (appointment as any).endTime,
      status: (appointment as any).status,
      responderName: (appointment as any).responderName,
      appointmentService: (appointment as any).appointmentService,
      assignedUser: (appointment as any).assignedUser,
    },
    form: {
      slug: form.slug,
      name: form.name,
      cancellationPolicyHours: agendamento.cancellationPolicyHours ?? 24,
      cancellationFee: agendamento.cancellationFee ?? 0,
    },
  });
};

/** Public: cancel appointment by token. */
export const cancelByToken = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    throw new AppError("Token é obrigatório", 400);
  }
  await CancelAppointmentByTokenService({ token, formSlug: publicId });
  return res.json({ success: true, message: "Agendamento cancelado com sucesso." });
};

/** Public: reschedule appointment by token. */
export const rescheduleByToken = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const { token, startTime, endTime } = req.body;
  if (!token || typeof token !== "string" || !startTime || !endTime) {
    throw new AppError("Token, startTime e endTime são obrigatórios", 400);
  }
  const appointment = await RescheduleAppointmentByTokenService({
    token,
    formSlug: publicId,
    startTime: String(startTime),
    endTime: String(endTime),
  });
  return res.json({ success: true, message: "Agendamento reagendado com sucesso.", appointment });
};

/** Public: get iCal file for appointment (add to calendar). */
export const getIcalByToken = async (req: Request, res: Response): Promise<void> => {
  const { publicId } = req.params as any;
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    res.status(400).send("Token é obrigatório");
    return;
  }
  const ical = await GenerateAppointmentIcalService(token, publicId);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="agendamento.ics"');
  res.send(ical);
};
