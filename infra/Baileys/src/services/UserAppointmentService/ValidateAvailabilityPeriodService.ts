import AppError from "../../errors/AppError";
import User from "../../models/User";
import { logger } from "../../utils/logger";

interface Request {
    userId: number;
    assignedUserId?: number;
    startTime: Date;
    endTime: Date;
    companyId: number;
}

interface Response {
    valid: boolean;
    reason?: string;
}

const ValidateAvailabilityPeriodService = async ({
    userId,
    assignedUserId,
    startTime,
    endTime,
    companyId,
}: Request): Promise<Response> => {
    // Se não há assignedUserId, validar para o userId
    const targetUserId = assignedUserId || userId;

    // Buscar o usuário
    const user = await User.findOne({
        where: { id: targetUserId, companyId },
    });

    if (!user) {
        throw new AppError("Usuário não encontrado", 404);
    }

    // Se não há configurações de disponibilidade, permitir qualquer horário
    const settings = user.availabilitySettings;
    if (!settings || !settings.enabled) {
        return { valid: true };
    }

    // Obter dia da semana (0 = domingo, 1 = segunda, etc)
    const dayOfWeek = startTime.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    // Verificar se o dia da semana está configurado
    const daySettings = settings.weekdays?.[dayName];
    if (!daySettings || !daySettings.enabled) {
        return {
            valid: false,
            reason: `Agendamentos não são permitidos aos ${dayName === 'sunday' ? 'domingos' : dayName === 'monday' ? 'segundas-feiras' : dayName === 'tuesday' ? 'terças-feiras' : dayName === 'wednesday' ? 'quartas-feiras' : dayName === 'thursday' ? 'quintas-feiras' : dayName === 'friday' ? 'sextas-feiras' : 'sábados'}`
        };
    }

    // Extrair hora e minuto do startTime e endTime
    const startHour = startTime.getHours();
    const startMinute = startTime.getMinutes();
    const endHour = endTime.getHours();
    const endMinute = endTime.getMinutes();

    // Converter horários permitidos para minutos do dia
    const parseTime = (timeStr: string): number => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    };

    const allowedStart = parseTime(daySettings.startTime);
    const allowedEnd = parseTime(daySettings.endTime);
    const requestedStart = startHour * 60 + startMinute;
    const requestedEnd = endHour * 60 + endMinute;

    // Verificar se o horário solicitado está dentro do período permitido
    if (requestedStart < allowedStart) {
        return {
            valid: false,
            reason: `O horário de início deve ser a partir das ${daySettings.startTime}`
        };
    }

    if (requestedEnd > allowedEnd) {
        return {
            valid: false,
            reason: `O horário de término deve ser até ${daySettings.endTime}`
        };
    }

    return { valid: true };
};

export default ValidateAvailabilityPeriodService;
