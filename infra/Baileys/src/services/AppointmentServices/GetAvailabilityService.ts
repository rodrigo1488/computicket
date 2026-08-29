import Form from "../../models/Form";
import Appointment from "../../models/Appointment";
import AppointmentService from "../../models/AppointmentService";
import Company from "../../models/Company";
import Setting from "../../models/Setting";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import { findPublicFormBySlug } from "../FormServices/FindPublicFormService";

/** Default business hours if not configured (8h-18h) */
const DEFAULT_START = 8;
const DEFAULT_END = 18;
const SLOT_INTERVAL_MINUTES = 30;

interface Request {
  formSlug: string;
  serviceId: number;
  userId: number;
  date: string; // YYYY-MM-DD
  /** When rescheduling, exclude this appointment from "existing" so its slot appears available */
  excludeAppointmentId?: number;
}

export interface Slot {
  start: string; // ISO
  end: string;
  startTime: string; // "09:00"
  endTime: string;
}

const GetAvailabilityService = async ({
  formSlug,
  serviceId,
  userId,
  date,
  excludeAppointmentId,
}: Request): Promise<{ slots: Slot[] }> => {
  const form = await findPublicFormBySlug(formSlug, {
    attributes: ["id", "companyId", "settings"],
  });

  const service = await AppointmentService.findOne({
    where: { id: serviceId, companyId: form.companyId, userId, isActive: true },
  });

  if (!service) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
  }

  const durationMinutes = service.durationMinutes || 60;
  const settings = (form.settings as any) || {};
  const agendamentoSettings = settings.agendamento || {};
  const scheduleByDay = agendamentoSettings.scheduleByDay as Record<number, { start: number; end: number } | null> | undefined;
  const dayOfWeek = new Date(date + "T12:00:00").getDay();

  // Verificar se deve usar horários da empresa
  const scheduleTypeSetting = await Setting.findOne({
    where: { companyId: form.companyId, key: "scheduleType" },
  });
  const scheduleType = scheduleTypeSetting?.value || "disabled";

  let startHour = agendamentoSettings.startHour ?? DEFAULT_START;
  let endHour = agendamentoSettings.endHour ?? DEFAULT_END;

  // Se scheduleType for "company", buscar horários da empresa
  if (scheduleType === "company") {
    const company = await Company.findByPk(form.companyId, {
      attributes: ["schedules"],
    });
    
    if (company?.schedules && Array.isArray(company.schedules)) {
      const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const currentWeekdayName = weekdayNames[dayOfWeek];
      
      const daySchedule = (company.schedules as any[]).find(
        (s: any) => s?.weekdayEn?.toLowerCase() === currentWeekdayName
      );
      
      if (daySchedule) {
        const schedule = daySchedule as any;
        if (!schedule.startTime || !schedule.endTime || schedule.startTime === "" || schedule.endTime === "") {
          // Dia fechado
          return { slots: [] };
        }
        // Se for 00:00, considerar fechado
        if (schedule.startTime === "00:00" && schedule.endTime === "00:00") {
          return { slots: [] };
        }
        const [startH, startM] = (schedule.startTime as string).split(":").map(Number);
        const [endH, endM] = (schedule.endTime as string).split(":").map(Number);
        startHour = startH + startM / 60;
        endHour = endH + endM / 60;
        // Se endHour for 0, considerar como 24h (meia-noite do dia seguinte)
        if (endH === 0 && endM === 0) {
          endHour = 24;
        }
      } else {
        // Dia não configurado, considerar fechado
        return { slots: [] };
      }
    }
  } else if (scheduleByDay && typeof scheduleByDay[dayOfWeek] === "object" && scheduleByDay[dayOfWeek] != null) {
    // Usar configuração do formulário
    const daySchedule = scheduleByDay[dayOfWeek];
    startHour = daySchedule!.start;
    endHour = daySchedule!.end;
  } else if (scheduleByDay && scheduleByDay[dayOfWeek] === null) {
    return { slots: [] };
  }
  
  const bufferMinutes = Math.max(0, Number(agendamentoSettings.bufferMinutes) || 0);

  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59");
  
  // Converter horas decimais para formato HH:MM
  const startHourInt = Math.floor(startHour);
  const startMinInt = Math.round((startHour - startHourInt) * 60);
  const endHourInt = Math.floor(endHour);
  const endMinInt = Math.round((endHour - endHourInt) * 60);
  
  const rangeStart = new Date(date + `T${String(startHourInt).padStart(2, "0")}:${String(startMinInt).padStart(2, "0")}:00`);
  let rangeEnd: Date;
  if (endHour >= 24) {
    // Se endHour for 24 ou mais, usar 23:59:59 do mesmo dia
    rangeEnd = new Date(date + "T23:59:59");
  } else {
    rangeEnd = new Date(date + `T${String(endHourInt).padStart(2, "0")}:${String(endMinInt).padStart(2, "0")}:00`);
  }

  const existingWhere: any = {
    companyId: form.companyId,
    assignedUserId: userId,
    status: { [Op.in]: ["pending", "confirmed"] },
    [Op.or]: [
      { startTime: { [Op.between]: [dayStart, dayEnd] } as any },
      { endTime: { [Op.between]: [dayStart, dayEnd] } as any },
    ],
  };
  if (excludeAppointmentId) {
    existingWhere.id = { [Op.ne]: excludeAppointmentId };
  }
  const existing = await Appointment.findAll({
    where: existingWhere,
    attributes: ["startTime", "endTime"],
  });

  const slots: Slot[] = [];
  let current = new Date(rangeStart);

  while (current < rangeEnd) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60 * 1000);
    if (slotEnd > rangeEnd) break;

    const overlaps = existing.some(
      (a) => {
        const s = new Date(a.startTime).getTime();
        const e = new Date(a.endTime).getTime() + bufferMinutes * 60 * 1000;
        const c = current.getTime();
        const se = slotEnd.getTime();
        return c < e && se > s;
      }
    );

    if (!overlaps) {
      const startIso = current.toISOString();
      const endIso = slotEnd.toISOString();
      slots.push({
        start: startIso,
        end: endIso,
        startTime: current.toTimeString().slice(0, 5),
        endTime: slotEnd.toTimeString().slice(0, 5),
      });
    }

    current = new Date(current.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);
  }

  return { slots };
};

export default GetAvailabilityService;
