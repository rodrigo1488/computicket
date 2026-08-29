import AppError from "../../errors/AppError";
import UserAppointment from "../../models/UserAppointment";

const DeleteService = async (id: string | number): Promise<void> => {
    const appointment = await UserAppointment.findByPk(id);

    if (!appointment) {
        throw new AppError("ERR_NO_USER_APPOINTMENT_FOUND", 404);
    }

    await appointment.destroy();
};

export default DeleteService;
