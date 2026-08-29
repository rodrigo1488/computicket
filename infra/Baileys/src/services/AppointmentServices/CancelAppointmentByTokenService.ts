import Appointment from "../../models/Appointment";
import GetAppointmentByTokenService from "./GetAppointmentByTokenService";
import UpdateAppointmentService from "./UpdateAppointmentService";
import CheckCancellationPolicyService from "./CheckCancellationPolicyService";
import AppError from "../../errors/AppError";

interface Request {
  token: string;
  formSlug: string;
}

const CancelAppointmentByTokenService = async ({
  token,
  formSlug,
}: Request): Promise<Appointment> => {
  const { appointment } = await GetAppointmentByTokenService({ token, formSlug });

  const policy = await CheckCancellationPolicyService({
    appointmentId: appointment.id,
    companyId: appointment.companyId,
  });
  if (!policy.allowed) {
    throw new AppError(policy.message, 400);
  }

  await UpdateAppointmentService({
    appointmentId: appointment.id,
    companyId: appointment.companyId,
    status: "cancelled",
  });

  return appointment.reload();
};

export default CancelAppointmentByTokenService;
