import AppointmentService from "../../models/AppointmentService";
import AppError from "../../errors/AppError";

interface Request {
  appointmentServiceId: number;
  companyId: number;
}

const DeleteService = async ({
  appointmentServiceId,
  companyId,
}: Request): Promise<void> => {
  const service = await AppointmentService.findOne({
    where: { id: appointmentServiceId, companyId },
  });

  if (!service) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
  }

  await service.destroy();
};

export default DeleteService;
