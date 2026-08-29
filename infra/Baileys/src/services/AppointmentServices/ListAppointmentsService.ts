import Appointment from "../../models/Appointment";
import { Op } from "sequelize";

interface Request {
  companyId: number;
  formId?: number;
  assignedUserId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
}

const ListAppointmentsService = async ({
  companyId,
  formId,
  assignedUserId,
  dateFrom,
  dateTo,
  status,
}: Request): Promise<Appointment[]> => {
  const whereCondition: any = { companyId };

  if (formId != null) {
    whereCondition.formId = formId;
  }
  if (assignedUserId != null) {
    whereCondition.assignedUserId = assignedUserId;
  }
  if (status) {
    whereCondition.status = status;
  }
  if (dateFrom || dateTo) {
    whereCondition.startTime = {};
    if (dateFrom) (whereCondition.startTime as any)[Op.gte] = dateFrom;
    if (dateTo) (whereCondition.startTime as any)[Op.lte] = dateTo;
  }

  const list = await Appointment.findAll({
    where: whereCondition,
    include: [
      { association: "appointmentService", attributes: ["id", "name", "durationMinutes", "value"] },
      { association: "assignedUser", attributes: ["id", "name"] },
      { association: "contact", attributes: ["id", "name", "number"], required: false },
      { association: "form", attributes: ["id", "name", "slug"] },
    ],
    order: [["startTime", "ASC"]],
  });

  return list;
};

export default ListAppointmentsService;
