import AppointmentService from "../../models/AppointmentService";
import { Op } from "sequelize";

interface Request {
  companyId: number;
  userId?: number;
  isActive?: boolean;
}

const ListService = async ({
  companyId,
  userId,
  isActive,
}: Request): Promise<AppointmentService[]> => {
  const whereCondition: any = { companyId };

  if (userId != null) {
    whereCondition.userId = userId;
  }

  if (isActive !== undefined) {
    whereCondition.isActive = isActive;
  }

  const list = await AppointmentService.findAll({
    where: whereCondition,
    include: [{ association: "user", attributes: ["id", "name"] }],
    order: [
      ["displayOrder", "ASC"],
      ["name", "ASC"],
    ],
  });

  return list;
};

export default ListService;
