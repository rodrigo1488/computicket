import Appointment from "../../models/Appointment";
import AppError from "../../errors/AppError";

interface Request {
  appointmentId: number;
  companyId: number;
  status?: string;
  startTime?: Date;
  endTime?: Date;
}

const UpdateAppointmentService = async ({
  appointmentId,
  companyId,
  status,
  startTime,
  endTime,
}: Request): Promise<Appointment> => {
  const appointment = await Appointment.findOne({
    where: { id: appointmentId, companyId },
  });

  if (!appointment) {
    throw new AppError("ERR_APPOINTMENT_NOT_FOUND", 404);
  }

  if (status !== undefined) appointment.status = status;
  if (startTime !== undefined) appointment.startTime = startTime;
  if (endTime !== undefined) appointment.endTime = endTime;

  await appointment.save();
  return appointment;
};

export default UpdateAppointmentService;
