import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";

const ShowService = async (id: string | number): Promise<UserAppointment> => {
    const appointment = await UserAppointment.findByPk(id, {
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
            { association: "company", attributes: ["id", "name"] },
        ],
    });

    if (!appointment) {
        throw new AppError("ERR_NO_USER_APPOINTMENT_FOUND", 404);
    }

    return appointment;
};

export default ShowService;
