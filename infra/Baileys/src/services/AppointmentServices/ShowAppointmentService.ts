import Appointment from "../../models/Appointment";
import AppError from "../../errors/AppError";

interface Request {
  appointmentId: number;
  companyId: number;
}

const ShowAppointmentService = async ({
  appointmentId,
  companyId,
}: Request): Promise<Appointment> => {
  const appointment = await Appointment.findOne({
    where: { id: appointmentId, companyId },
    include: [
      { association: "appointmentService", include: [{ association: "user", attributes: ["id", "name"] }] },
      { association: "assignedUser", attributes: ["id", "name"] },
      { association: "contact", attributes: ["id", "name", "number"] },
      { association: "form", attributes: ["id", "name", "slug"] },
    ],
  });

  if (!appointment) {
    throw new AppError("ERR_APPOINTMENT_NOT_FOUND", 404);
  }

  return appointment;
};

export default ShowAppointmentService;
