import { Op } from "sequelize";
import UserAppointment from "../../models/UserAppointment";

interface Request {
    companyId: number;
    userId?: number;
    userProfile?: string; // Profile do usuário (admin, user, etc)
    filterType?: "all" | "myAppointments" | "assignedToMe";
    searchParam?: string;
    pageNumber?: string;
}

interface Response {
    appointments: UserAppointment[];
    count: number;
    hasMore: boolean;
}

const ListService = async ({
    companyId,
    userId,
    userProfile,
    filterType = "all",
    searchParam,
    pageNumber = "1",
}: Request): Promise<Response> => {
    const conditions: any[] = [
        { companyId }
    ];

    // Se o usuário não for admin, só pode ver seus próprios agendamentos
    // (criados por ele ou atribuídos a ele)
    if (userProfile !== "admin" && userId) {
        conditions.push({
            [Op.or]: [
                { userId: userId },
                { assignedUserId: userId }
            ]
        });
    } else {
        // Admin pode ver todos, mas ainda respeita o filterType se especificado
        if (filterType === "myAppointments" && userId) {
            conditions.push({ userId: userId });
        } else if (filterType === "assignedToMe" && userId) {
            conditions.push({ assignedUserId: userId });
        }
    }

    // Apply search filter
    if (searchParam) {
        conditions.push({
            [Op.or]: [
                { title: { [Op.like]: `%${searchParam}%` } },
                { description: { [Op.like]: `%${searchParam}%` } },
            ]
        });
    }

    const whereCondition = conditions.length > 1 
        ? { [Op.and]: conditions }
        : conditions[0];

    const limit = 20;
    const offset = limit * (+pageNumber - 1);

    const { count, rows: appointments } = await UserAppointment.findAndCountAll({
        where: whereCondition,
        limit,
        offset,
        order: [["startTime", "ASC"]],
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
        ],
    });

    const hasMore = count > offset + appointments.length;

    return {
        appointments,
        count,
        hasMore,
    };
};

export default ListService;
