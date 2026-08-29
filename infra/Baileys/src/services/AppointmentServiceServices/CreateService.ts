import AppointmentService from "../../models/AppointmentService";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  userId: number;
  name: string;
  durationMinutes: number;
  value?: number;
  description?: string;
  isActive?: boolean;
  displayOrder?: number;
}

const CreateService = async ({
  companyId,
  userId,
  name,
  durationMinutes,
  value,
  description,
  isActive = true,
  displayOrder = 0,
}: Request): Promise<AppointmentService> => {
  if (!name || name.trim() === "") {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NAME_REQUIRED", 400);
  }
  if (!durationMinutes || durationMinutes < 1) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_DURATION_REQUIRED", 400);
  }

  const service = await AppointmentService.create({
    companyId,
    userId,
    name: name.trim(),
    durationMinutes: Number(durationMinutes),
    value: value != null ? Number(value) : null,
    description: description?.trim() || null,
    isActive: !!isActive,
    displayOrder: displayOrder ?? 0,
  });

  return service;
};

export default CreateService;
