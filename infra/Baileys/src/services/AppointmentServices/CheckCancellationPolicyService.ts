import Appointment from "../../models/Appointment";
import Form from "../../models/Form";
import AppError from "../../errors/AppError";

interface Request {
  appointmentId: number;
  companyId: number;
}

export interface CancellationPolicyResult {
  allowed: boolean;
  message: string;
  cancellationPolicyHours?: number;
  cancellationFee?: number;
}

const CheckCancellationPolicyService = async ({
  appointmentId,
  companyId,
}: Request): Promise<CancellationPolicyResult> => {
  const appointment = await Appointment.findOne({
    where: { id: appointmentId, companyId },
    include: [{ association: "form", attributes: ["id", "settings"] }],
  });

  if (!appointment) {
    throw new AppError("ERR_APPOINTMENT_NOT_FOUND", 404);
  }

  const form = appointment.form as Form & { settings?: any };
  const agendamento = (form?.settings as any)?.agendamento || {};
  const policyHours = Math.max(0, Number(agendamento.cancellationPolicyHours) ?? 24);
  const fee = Math.max(0, Number(agendamento.cancellationFee) ?? 0);

  const startTime = new Date((appointment as any).startTime).getTime();
  const deadline = startTime - policyHours * 60 * 60 * 1000;
  const now = Date.now();

  if (now <= deadline) {
    return {
      allowed: true,
      message: "Cancelamento permitido.",
      cancellationPolicyHours: policyHours,
      cancellationFee: fee,
    };
  }

  const feeMsg = fee > 0 ? ` Há taxa de R$ ${fee.toFixed(2)}.` : "";
  return {
    allowed: false,
    message: `Cancelamento gratuito apenas até ${policyHours} hora(s) antes do horário. Entre em contato para cancelar.${feeMsg}`,
    cancellationPolicyHours: policyHours,
    cancellationFee: fee,
  };
};

export default CheckCancellationPolicyService;
