import AppointmentService from "../../models/AppointmentService";
import AppError from "../../errors/AppError";

interface Request {
  appointmentServiceId: number;
  companyId: number;
}

const ShowService = async ({
  appointmentServiceId,
  companyId,
}: Request): Promise<AppointmentService> => {
  const service = await AppointmentService.findOne({
    where: { id: appointmentServiceId, companyId },
    include: [{ association: "user", attributes: ["id", "name"] }],
  });

  if (!service) {
    throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
  }

  return service;
};

export default ShowService;
