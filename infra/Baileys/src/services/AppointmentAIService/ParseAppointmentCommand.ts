import AppError from "../../errors/AppError";
import CheckAvailabilityService from "./CheckAvailabilityService";
import MapProfessionalService from "./MapProfessionalService";
import CreateService from "../UserAppointmentService/CreateService";
import UpdateService from "../UserAppointmentService/UpdateService";
import UserAppointment from "../../models/UserAppointment";
import User from "../../models/User";
import { Op } from "sequelize";
import ExecuteAppointmentFunction from "./ExecuteAppointmentFunction";

interface ParseCommandRequest {
  command: string;
  companyId: number;
  contactId?: number;
  ticketId?: number;
  allowCreate: boolean;
}

interface ParseCommandResult {
  success: boolean;
  message?: string;
  appointmentId?: number;
  error?: string;
}

const ParseAppointmentCommand = async ({
  command,
  companyId,
  contactId,
  ticketId,
  allowCreate
}: ParseCommandRequest): Promise<ParseCommandResult> => {
  try {
    // Remover tags [AGENDAR] e [/AGENDAR]
    const cleanCommand = command
      .replace(/\[AGENDAR\]/gi, "")
      .replace(/\[\/AGENDAR\]/gi, "")
      .trim();

    // Tentar parsear como JSON
    let params: any;
    try {
      params = JSON.parse(cleanCommand);
    } catch (err) {
      // Se não for JSON, tentar extrair informações do texto
      return {
        success: false,
        error: "Formato de comando inválido. Use JSON dentro de [AGENDAR]...[/AGENDAR]"
      };
    }

    const action = params.action || params.tipo || params.type;

    switch (action?.toLowerCase()) {
      case "criar":
      case "create":
      case "agendar": {
        if (!allowCreate) {
          return {
            success: false,
            error: "Permissão negada: criar agendamentos não está habilitado para este prompt",
            message: "A funcionalidade de criar agendamentos não está habilitada."
          };
        }

        // Extrair parâmetros
        const professionalName = params.profissional || params.professional || params.medico || params.doctor;
        const date = params.data || params.date;
        const startTime = params.horarioInicio || params.startTime || params.horario;
        const endTime = params.horarioFim || params.endTime;
        const title = params.titulo || params.title || "Consulta";
        const description = params.descricao || params.description || "";

        if (!professionalName || !date || !startTime) {
          return {
            success: false,
            error: "Parâmetros obrigatórios: profissional, data, horarioInicio"
          };
        }

        // Mapear profissional
        const professionalMap = await MapProfessionalService({
          professionalName,
          companyId
        });

        if (!professionalMap.found) {
          return {
            success: false,
            error: `Profissional "${professionalName}" não encontrado`,
            message: professionalMap.suggestions && professionalMap.suggestions.length > 0
              ? `Profissional não encontrado. Profissionais disponíveis: ${professionalMap.suggestions.map(p => p.name).join(", ")}`
              : "Profissional não encontrado."
          };
        }

        // Calcular endTime se não fornecido (assumir 30 minutos)
        const finalEndTime = endTime || (() => {
          const [hours, minutes] = startTime.split(":").map(Number);
          const [year, month, day] = date.split("-").map(Number);
          const start = new Date(year, month - 1, day, hours, minutes, 0);
          start.setMinutes(start.getMinutes() + 30);
          return `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")}`;
        })();

        // Verificar disponibilidade
        const availability = await CheckAvailabilityService({
          professionalId: professionalMap.professionalId,
          companyId,
          date,
          startTime,
          endTime: finalEndTime
        });

        if (!availability.available) {
          // Buscar horários alternativos automaticamente
          let alternativeSlotsMessage = "";
          try {
            const slotsResult = await ExecuteAppointmentFunction({
              functionCall: {
                name: "list_available_slots",
                arguments: JSON.stringify({
                  professionalId: professionalMap.professionalId,
                  date: date
                })
              },
              companyId,
              contactId,
              ticketId,
              allowCreate: allowCreate
            });

            if (slotsResult.success && slotsResult.result?.formattedSlots?.length > 0) {
              const slots = slotsResult.result.formattedSlots.slice(0, 5); // Limitar a 5 sugestões
              alternativeSlotsMessage = ` Horários disponíveis alternativos: ${slots.join(", ")}`;
            }
          } catch (err) {
            // Ignorar erro ao buscar alternativas, não é crítico
          }

          return {
            success: false,
            error: availability.reason || "Horário não disponível",
            message: `${availability.reason || "Não há horário disponível para o profissional na data solicitada."}${alternativeSlotsMessage}`
          };
        }

        // Buscar usuário padrão
        const defaultUser = await User.findOne({
          where: { companyId },
          attributes: ["id"],
          order: [["id", "ASC"]]
        });

        if (!defaultUser) {
          return {
            success: false,
            error: "Nenhum usuário encontrado na empresa"
          };
        }

        // Criar agendamento usando timezone local
        const [year, month, day] = date.split("-").map(Number);
        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = finalEndTime.split(":").map(Number);
        const startDateTime = new Date(year, month - 1, day, startHour, startMinute, 0);
        const endDateTime = new Date(year, month - 1, day, endHour, endMinute, 0);

        const appointment = await CreateService({
          title,
          description,
          startTime: startDateTime,
          endTime: endDateTime,
          userId: defaultUser.id,
          assignedUserId: professionalMap.professionalId,
          companyId,
          status: "pending",
          reminderMinutes: 15
        });

        return {
          success: true,
          appointmentId: appointment.id,
          message: `Agendamento criado com sucesso para ${date} às ${startTime} com ${professionalMap.professionalName}`
        };
      }

      case "verificar":
      case "check":
      case "disponibilidade": {
        const professionalName = params.profissional || params.professional || params.medico || params.doctor;
        const date = params.data || params.date;
        const startTime = params.horarioInicio || params.startTime || params.horario;
        const endTime = params.horarioFim || params.endTime;

        if (!professionalName || !date || !startTime) {
          return {
            success: false,
            error: "Parâmetros obrigatórios: profissional, data, horarioInicio"
          };
        }

        const professionalMap = await MapProfessionalService({
          professionalName,
          companyId
        });

        if (!professionalMap.found) {
          return {
            success: false,
            error: `Profissional "${professionalName}" não encontrado`
          };
        }

        const finalEndTime = endTime || (() => {
          const [hours, minutes] = startTime.split(":").map(Number);
          const [year, month, day] = date.split("-").map(Number);
          const start = new Date(year, month - 1, day, hours, minutes, 0);
          start.setMinutes(start.getMinutes() + 30);
          return `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")}`;
        })();

        const availability = await CheckAvailabilityService({
          professionalId: professionalMap.professionalId,
          companyId,
          date,
          startTime,
          endTime: finalEndTime
        });

        if (availability.available) {
          return {
            success: true,
            message: `Horário disponível para ${professionalMap.professionalName} em ${date} às ${startTime}`
          };
        } else {
          // Buscar horários alternativos automaticamente
          let alternativeSlotsMessage = "";
          try {
            const slotsResult = await ExecuteAppointmentFunction({
              functionCall: {
                name: "list_available_slots",
                arguments: JSON.stringify({
                  professionalId: professionalMap.professionalId,
                  date: date
                })
              },
              companyId,
              contactId,
              ticketId,
              allowCreate: allowCreate
            });

            if (slotsResult.success && slotsResult.result?.formattedSlots?.length > 0) {
              const slots = slotsResult.result.formattedSlots.slice(0, 5); // Limitar a 5 sugestões
              alternativeSlotsMessage = ` Horários disponíveis alternativos: ${slots.join(", ")}`;
            }
          } catch (err) {
            // Ignorar erro ao buscar alternativas
          }

          return {
            success: false,
            error: availability.reason || "Horário não disponível",
            message: `Horário não disponível: ${availability.reason || "Conflito de agenda"}${alternativeSlotsMessage}`
          };
        }
      }

      case "listar":
      case "list":
      case "horarios":
      case "buscar_horarios": {
        const professionalName = params.profissional || params.professional || params.medico || params.doctor;
        const date = params.data || params.date;

        if (!professionalName || !date) {
          return {
            success: false,
            error: "Parâmetros obrigatórios: profissional, data"
          };
        }

        const professionalMap = await MapProfessionalService({
          professionalName,
          companyId
        });

        if (!professionalMap.found) {
          return {
            success: false,
            error: `Profissional "${professionalName}" não encontrado`
          };
        }

        // Usar ExecuteAppointmentFunction para buscar horários disponíveis
        try {
          const slotsResult = await ExecuteAppointmentFunction({
            functionCall: {
              name: "list_available_slots",
              arguments: JSON.stringify({
                professionalId: professionalMap.professionalId,
                date: date
              })
            },
            companyId,
            contactId,
            ticketId,
            allowCreate: allowCreate
          });

          if (slotsResult.success && slotsResult.result) {
            const result = slotsResult.result;
            if (result.formattedSlots && result.formattedSlots.length > 0) {
              return {
                success: true,
                message: `Horários disponíveis para ${professionalMap.professionalName} em ${date}: ${result.formattedSlots.join(", ")}`
              };
            } else {
              return {
                success: true,
                message: `Nenhum horário disponível em ${date} para ${professionalMap.professionalName}`
              };
            }
          } else {
            // Fallback: buscar agendamentos do dia
            const [year, month, day] = date.split("-").map(Number);
            const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
            const endOfDay = new Date(year, month - 1, day, 23, 59, 59);

            const appointments = await UserAppointment.findAll({
              where: {
                assignedUserId: professionalMap.professionalId,
                companyId,
                startTime: {
                  [Op.between]: [+startOfDay, +endOfDay]
                },
                status: {
                  [Op.ne]: "cancelled"
                }
              },
              order: [["startTime", "ASC"]]
            });

            const occupiedSlots = appointments.map(apt => {
              const start = new Date(apt.startTime);
              return `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")}`;
            });

            return {
              success: true,
              message: occupiedSlots.length > 0
                ? `Horários ocupados em ${date}: ${occupiedSlots.join(", ")}`
                : `Nenhum horário ocupado em ${date} para ${professionalMap.professionalName}`
            };
          }
        } catch (err: any) {
          return {
            success: false,
            error: `Erro ao buscar horários: ${err.message}`
          };
        }
      }

      default:
        return {
          success: false,
          error: `Ação desconhecida: ${action}. Use: criar, verificar ou listar`
        };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Erro ao processar comando de agendamento"
    };
  }
};

export default ParseAppointmentCommand;
