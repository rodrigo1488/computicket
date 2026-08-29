import GetAppointmentByTokenService from "./GetAppointmentByTokenService";

/** Format date for iCal (UTC). */
function formatIcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const GenerateAppointmentIcalService = async (
  token: string,
  formSlug: string
): Promise<string> => {
  const { appointment } = await GetAppointmentByTokenService({ token, formSlug });

  const start = new Date((appointment as any).startTime);
  const end = new Date((appointment as any).endTime);
  const serviceName = (appointment as any).appointmentService?.name || "Agendamento";
  const professionalName = (appointment as any).assignedUser?.name || "";
  const summary = professionalName ? `${serviceName} - ${professionalName}` : serviceName;
  const description = professionalName ? `Serviço: ${serviceName}\nProfissional: ${professionalName}` : `Serviço: ${serviceName}`;

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CompuChat//Agendamento//PT",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `DTSTART:${formatIcalDate(start)}`,
    `DTEND:${formatIcalDate(end)}`,
    `SUMMARY:${summary.replace(/\n/g, "\\n").replace(/,/g, "\\,")}`,
    `DESCRIPTION:${description.replace(/\n/g, "\\n").replace(/,/g, "\\,")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return ical;
};

export default GenerateAppointmentIcalService;
