import { Op } from "sequelize";
import Appointment from "../../models/Appointment";
import Form from "../../models/Form";
import GetAppointmentByTokenService from "./GetAppointmentByTokenService";
import GetAvailabilityService from "./GetAvailabilityService";
import UpdateAppointmentService from "./UpdateAppointmentService";
import AppError from "../../errors/AppError";

interface Request {
  token: string;
  formSlug: string;
  startTime: string; // ISO
  endTime: string;   // ISO
}

const RescheduleAppointmentByTokenService = async ({
  token,
  formSlug,
  startTime,
  endTime,
}: Request): Promise<Appointment> => {
  const { appointment } = await GetAppointmentByTokenService({ token, formSlug });

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    throw new AppError("Data/horário inválido", 400);
  }

  const dateStr = start.toISOString().slice(0, 10);
  const { slots } = await GetAvailabilityService({
    formSlug,
    serviceId: (appointment as any).appointmentServiceId,
    userId: (appointment as any).assignedUserId,
    date: dateStr,
    excludeAppointmentId: appointment.id,
  });

  const startMs = start.getTime();
  const endMs = end.getTime();
  const slotMatch = slots.some((slot) => {
    const s = new Date(slot.start).getTime();
    const e = new Date(slot.end).getTime();
    return Math.abs(s - startMs) < 60000 && Math.abs(e - endMs) < 60000;
  });

  if (!slotMatch) {
    throw new AppError("O horário escolhido não está mais disponível. Escolha outro horário.", 400);
  }

  await UpdateAppointmentService({
    appointmentId: appointment.id,
    companyId: appointment.companyId,
    startTime: start,
    endTime: end,
  });

  return appointment.reload();
};

export default RescheduleAppointmentByTokenService;
