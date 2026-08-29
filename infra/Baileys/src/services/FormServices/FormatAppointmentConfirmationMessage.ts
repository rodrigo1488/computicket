import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Request {
  serviceName: string;
  professionalName: string;
  startTime: Date;
  endTime: Date;
  customerName: string;
  cancelUrl?: string;
  rescheduleUrl?: string;
}

const FormatAppointmentConfirmationMessage = ({
  serviceName,
  professionalName,
  startTime,
  endTime,
  customerName,
  cancelUrl,
  rescheduleUrl,
}: Request): string => {
  const dateStr = format(new Date(startTime), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const timeStr = format(new Date(startTime), "HH:mm", { locale: ptBR });
  const endTimeStr = format(new Date(endTime), "HH:mm", { locale: ptBR });

  let footer = "Qualquer alteração, entre em contato conosco.";
  if (cancelUrl || rescheduleUrl) {
    footer = "";
    if (rescheduleUrl) footer += `🔄 Reagendar: ${rescheduleUrl}\n`;
    if (cancelUrl) footer += `❌ Cancelar: ${cancelUrl}\n`;
  }

  return (
    `✅ *Agendamento confirmado!*\n\n` +
    `Olá ${customerName},\n\n` +
    `Seu agendamento foi realizado com sucesso:\n\n` +
    `📋 *Serviço:* ${serviceName}\n` +
    `👤 *Profissional:* ${professionalName}\n` +
    `📅 *Data:* ${dateStr}\n` +
    `🕐 *Horário:* ${timeStr} às ${endTimeStr}\n\n` +
    (footer || "Qualquer alteração, entre em contato conosco.")
  );
};

export default FormatAppointmentConfirmationMessage;
