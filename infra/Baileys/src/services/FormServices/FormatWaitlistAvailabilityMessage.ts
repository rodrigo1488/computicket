import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Request {
  serviceName: string;
  professionalName: string;
  customerName: string;
  dateStr: string;
  slotsPreview: string;
}

const FormatWaitlistAvailabilityMessage = ({
  serviceName,
  professionalName,
  customerName,
  dateStr,
  slotsPreview,
}: Request): string => {
  const dateFormatted = format(new Date(dateStr + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    `📅 *Vaga disponível na lista de espera!*\n\n` +
    `Olá ${customerName},\n\n` +
    `Há horários disponíveis para o serviço *${serviceName}* com ${professionalName}:\n\n` +
    `📅 *Data:* ${dateFormatted}\n` +
    `🕐 *Horários:* ${slotsPreview}\n\n` +
    `Acesse o link do agendamento para garantir seu horário.`
  );
};

export default FormatWaitlistAvailabilityMessage;
