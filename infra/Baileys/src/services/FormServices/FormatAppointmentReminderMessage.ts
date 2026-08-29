import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Request {
  serviceName: string;
  professionalName: string;
  startTime: Date;
  endTime: Date;
  customerName: string;
  hoursBefore: number;
  cancelUrl?: string;
  rescheduleUrl?: string;
}

const FormatAppointmentReminderMessage = ({
  serviceName,
  professionalName,
  startTime,
  endTime,
  customerName,
  hoursBefore,
  cancelUrl,
  rescheduleUrl,
}: Request): string => {
  const dateStr = format(new Date(startTime), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const timeStr = format(new Date(startTime), "HH:mm", { locale: ptBR });
  const endTimeStr = format(new Date(endTime), "HH:mm", { locale: ptBR });
  const when =
    hoursBefore >= 24
      ? `em ${Math.floor(hoursBefore / 24)} dia(s)`
      : hoursBefore === 1
      ? "em 1 hora"
      : `em ${hoursBefore} horas`;

  let footer = "Qualquer alteração, entre em contato conosco.";
  if (cancelUrl || rescheduleUrl) {
    footer = "";
    if (rescheduleUrl) footer += `🔄 Reagendar: ${rescheduleUrl}\n`;
    if (cancelUrl) footer += `❌ Cancelar: ${cancelUrl}\n`;
  }

  return (
    `🔔 *Lembrete de agendamento*\n\n` +
    `Olá ${customerName},\n\n` +
    `Seu agendamento está agendado ${when}:\n\n` +
    `📋 *Serviço:* ${serviceName}\n` +
    `👤 *Profissional:* ${professionalName}\n` +
    `📅 *Data:* ${dateStr}\n` +
    `🕐 *Horário:* ${timeStr} às ${endTimeStr}\n\n` +
    (footer || "Qualquer alteração, entre em contato conosco.")
  );
};

export default FormatAppointmentReminderMessage;
