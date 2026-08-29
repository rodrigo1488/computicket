import AppError from "../../errors/AppError";
import CheckAvailabilityService from "./CheckAvailabilityService";
import MapProfessionalService from "./MapProfessionalService";
import CreateService from "../UserAppointmentService/CreateService";
import UpdateService from "../UserAppointmentService/UpdateService";
import UserAppointment from "../../models/UserAppointment";
import User from "../../models/User";
import { Op } from "sequelize";

interface FunctionCall {
  name: string;
  arguments: string; // JSON string
}

interface ExecuteFunctionRequest {
  functionCall: FunctionCall;
  companyId: number;
  contactId?: number;
  ticketId?: number;
  allowCreate: boolean; // permitirCriarAgendamentos do prompt
}

interface ExecuteFunctionResult {
  success: boolean;
  result?: any;
  error?: string;
  requiresUserInput?: boolean;
  message?: string;
}

const ExecuteAppointmentFunction = async ({
  functionCall,
  companyId,
  contactId,
  ticketId,
  allowCreate
}: ExecuteFunctionRequest): Promise<ExecuteFunctionResult> => {
  try {
    let parsedArgs: any;
    try {
      parsedArgs = JSON.parse(functionCall.arguments);
    } catch (err) {
      return {
        success: false,
        error: "Argumentos inválidos: JSON malformado"
      };
    }

    switch (functionCall.name) {
      case "check_appointment_availability": {
        // Validar parâmetros obrigatórios
        if (!parsedArgs.professionalId || !parsedArgs.date || !parsedArgs.startTime || !parsedArgs.endTime) {
          return {
            success: false,
            error: "Parâmetros obrigatórios: professionalId, date, startTime, endTime"
          };
        }

        const availability = await CheckAvailabilityService({
          professionalId: parsedArgs.professionalId,
          companyId,
          date: parsedArgs.date,
          startTime: parsedArgs.startTime,
          endTime: parsedArgs.endTime
        });

        return {
          success: true,
          result: {
            available: availability.available,
            reason: availability.reason,
            conflictingCount: availability.conflictingAppointments?.length || 0
          }
        };
      }

      case "create_appointment": {
        // Verificar permissão
        if (!allowCreate) {
          return {
            success: false,
            error: "Permissão negada: criar agendamentos não está habilitado para este prompt",
            requiresUserInput: true,
            message: "A funcionalidade de criar agendamentos não está habilitada. Entre em contato com o suporte."
          };
        }

        // Validar parâmetros obrigatórios
        if (!parsedArgs.title || !parsedArgs.professionalId || !parsedArgs.date || !parsedArgs.startTime || !parsedArgs.endTime) {
          return {
            success: false,
            error: "Parâmetros obrigatórios: title, professionalId, date, startTime, endTime"
          };
        }

        // Verificar disponibilidade antes de criar
        const availability = await CheckAvailabilityService({
          professionalId: parsedArgs.professionalId,
          companyId,
          date: parsedArgs.date,
          startTime: parsedArgs.startTime,
          endTime: parsedArgs.endTime
        });

        if (!availability.available) {
          return {
            success: false,
            error: availability.reason || "Horário não disponível",
            requiresUserInput: true,
            message: availability.reason || "Não há horário disponível para o profissional na data solicitada."
          };
        }

        // Construir objetos Date usando timezone local
        const [year, month, day] = parsedArgs.date.split("-").map(Number);
        const [startHour, startMinute] = parsedArgs.startTime.split(":").map(Number);
        const [endHour, endMinute] = parsedArgs.endTime.split(":").map(Number);
        const startDateTime = new Date(year, month - 1, day, startHour, startMinute, 0);
        const endDateTime = new Date(year, month - 1, day, endHour, endMinute, 0);

        // Buscar um usuário padrão da empresa para usar como userId
        // Se não houver usuário, usar o próprio profissional como userId
        const defaultUser = await User.findOne({
          where: { companyId },
          attributes: ["id"],
          order: [["id", "ASC"]]
        });

        if (!defaultUser) {
          return {
            success: false,
            error: "Nenhum usuário encontrado na empresa",
            requiresUserInput: true,
            message: "Não foi possível criar o agendamento. Entre em contato com o suporte."
          };
        }

        // Criar agendamento
        const appointment = await CreateService({
          title: parsedArgs.title,
          description: parsedArgs.description || "",
          startTime: startDateTime,
          endTime: endDateTime,
          userId: defaultUser.id,
          assignedUserId: parsedArgs.professionalId,
          companyId,
          status: "pending",
          reminderMinutes: 15
        });

        return {
          success: true,
          result: {
            appointmentId: appointment.id,
            title: appointment.title,
            professionalName: appointment.assignedUser?.name,
            date: parsedArgs.date,
            startTime: parsedArgs.startTime,
            endTime: parsedArgs.endTime,
            status: appointment.status
          }
        };
      }

      case "update_appointment": {
        // Verificar permissão
        if (!allowCreate) {
          return {
            success: false,
            error: "Permissão negada: atualizar agendamentos não está habilitado para este prompt",
            requiresUserInput: true,
            message: "A funcionalidade de atualizar agendamentos não está habilitada."
          };
        }

        if (!parsedArgs.appointmentId) {
          return {
            success: false,
            error: "Parâmetro obrigatório: appointmentId"
          };
        }

        // Buscar agendamento e verificar se pertence à empresa
        const appointment = await UserAppointment.findOne({
          where: {
            id: parsedArgs.appointmentId,
            companyId
          }
        });

        if (!appointment) {
          return {
            success: false,
            error: "Agendamento não encontrado ou não pertence a esta empresa"
          };
        }

        // Se está atualizando horário, verificar disponibilidade
        if (parsedArgs.startTime || parsedArgs.endTime) {
          const appointmentDate = new Date(appointment.startTime);
          const dateStr = appointmentDate.toISOString().split("T")[0];
          const newStartTime = parsedArgs.startTime || appointmentDate.toTimeString().substring(0, 5);
          const newEndTime = parsedArgs.endTime || new Date(appointment.endTime).toTimeString().substring(0, 5);

          const availability = await CheckAvailabilityService({
            professionalId: appointment.assignedUserId || 0,
            companyId,
            date: dateStr,
            startTime: newStartTime,
            endTime: newEndTime
          });

          if (!availability.available) {
            // Se o conflito é com o próprio agendamento, permitir
            const isSelfConflict = availability.conflictingAppointments?.some(
              a => a.id === appointment.id
            );

            if (!isSelfConflict) {
              return {
                success: false,
                error: availability.reason || "Horário não disponível",
                requiresUserInput: true,
                message: availability.reason || "Não há horário disponível para o profissional na data solicitada."
              };
            }
          }
        }

        // Preparar dados para atualização
        const updateData: any = {};
        if (parsedArgs.status) updateData.status = parsedArgs.status;
        if (parsedArgs.startTime) {
          const appointmentDate = new Date(appointment.startTime);
          const dateStr = appointmentDate.toISOString().split("T")[0];
          updateData.startTime = new Date(`${dateStr}T${parsedArgs.startTime}:00`);
        }
        if (parsedArgs.endTime) {
          const appointmentDate = new Date(appointment.startTime);
          const dateStr = appointmentDate.toISOString().split("T")[0];
          updateData.endTime = new Date(`${dateStr}T${parsedArgs.endTime}:00`);
        }

        const updatedAppointment = await UpdateService({
          appointmentId: appointment.id,
          ...updateData
        });

        return {
          success: true,
          result: {
            appointmentId: updatedAppointment.id,
            status: updatedAppointment.status,
            startTime: updatedAppointment.startTime,
            endTime: updatedAppointment.endTime
          }
        };
      }

      case "list_available_slots": {
        if (!parsedArgs.professionalId || !parsedArgs.date) {
          return {
            success: false,
            error: "Parâmetros obrigatórios: professionalId, date"
          };
        }

        // Construir datas no timezone local
        const [year, month, day] = parsedArgs.date.split("-").map(Number);
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
        const now = new Date();
        const marginMinutes = 5;
        const minAllowedTime = new Date(now.getTime() + marginMinutes * 60 * 1000);

        // Buscar todos os agendamentos do profissional no dia
        const appointments = await UserAppointment.findAll({
          where: {
            assignedUserId: parsedArgs.professionalId,
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

        // Gerar slots disponíveis (assumindo intervalos de 30 minutos, das 8h às 18h)
        const slots: Array<{ startTime: string; endTime: string; available: boolean }> = [];
        const startHour = 8;
        const endHour = 18;
        const intervalMinutes = 30;

        for (let hour = startHour; hour < endHour; hour++) {
          for (let minute = 0; minute < 60; minute += intervalMinutes) {
            const slotStart = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
            const slotEndMinute = minute + intervalMinutes;
            const slotEndHour = slotEndMinute >= 60 ? hour + 1 : hour;
            const slotEnd = `${slotEndHour.toString().padStart(2, "0")}:${(slotEndMinute % 60).toString().padStart(2, "0")}`;

            // Criar datas no timezone local para verificação
            const slotStartDate = new Date(year, month - 1, day, hour, minute, 0);
            const slotEndDate = new Date(year, month - 1, day, slotEndHour, slotEndMinute % 60, 0);

            // Verificar se o slot está no passado
            if (slotStartDate < minAllowedTime) {
              continue; // Pular slots no passado
            }

            // Verificar se há conflito
            const hasConflict = appointments.some(apt => {
              const aptStart = new Date(apt.startTime);
              const aptEnd = new Date(apt.endTime);
              return (
                (slotStartDate >= aptStart && slotStartDate < aptEnd) ||
                (slotEndDate > aptStart && slotEndDate <= aptEnd) ||
                (slotStartDate <= aptStart && slotEndDate >= aptEnd)
              );
            });

            slots.push({
              startTime: slotStart,
              endTime: slotEnd,
              available: !hasConflict
            });
          }
        }

        const availableSlots = slots.filter(s => s.available);
        const formattedSlots = availableSlots.slice(0, 20).map(s => `${s.startTime}-${s.endTime}`);

        return {
          success: true,
          result: {
            date: parsedArgs.date,
            totalSlots: slots.length,
            availableSlots: availableSlots.length,
            slots: availableSlots.slice(0, 20), // Aumentar para 20 slots
            formattedSlots: formattedSlots, // Adicionar formato legível
            slotsText: formattedSlots.length > 0 
              ? `Horários disponíveis: ${formattedSlots.join(", ")}`
              : "Nenhum horário disponível neste dia"
          }
        };
      }

      default:
        return {
          success: false,
          error: `Função desconhecida: ${functionCall.name}`
        };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Erro ao executar função"
    };
  }
};

export default ExecuteAppointmentFunction;
