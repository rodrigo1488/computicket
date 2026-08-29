import AppointmentService from "../../models/AppointmentService";
import AppError from "../../errors/AppError";

interface Request {
  appointmentServiceId: number;
  companyId: number;
  userId?: number;
  name?: string;
  durationMinutes?: number;
  value?: number;
  description?: string;
  isActive?: boolean;
  displayOrder?: number;
}

const UpdateService = async ({
  appointmentServiceId,
  companyId,
  userId,
  name,
  durationMinutes,
  value,
  description,
  isActive,
  displayOrder,
}: Request): Promise<AppointmentService> => {
  const service = await AppointmentService.findOne({
    where: { id: appointmentServiceId, companyId },
  });

  if (!service) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
  }

  if (name !== undefined) service.name = name.trim();
  if (userId !== undefined) service.userId = userId;
  if (durationMinutes !== undefined) service.durationMinutes = Number(durationMinutes);
  if (value !== undefined) service.value = value != null ? Number(value) : null;
  if (description !== undefined) service.description = description?.trim() || null;
  if (isActive !== undefined) service.isActive = !!isActive;
  if (displayOrder !== undefined) service.displayOrder = displayOrder;

  await service.save();
  return service;
};

export default UpdateService;
