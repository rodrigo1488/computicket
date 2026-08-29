import { Op, Filterable, Includeable } from "sequelize";
import Task from "../../models/Task";
import User from "../../models/User";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  userId?: number;
  searchParam?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignedToId?: number;
  showAll?: boolean;
  pageNumber?: string;
  limit?: string;
}

interface Response {
  tasks: Task[];
  count: number;
  hasMore: boolean;
}

const ListTasksService = async ({
  companyId,
  userId,
  searchParam = "",
  status,
  priority,
  category,
  assignedToId,
  showAll = false,
  pageNumber = "1",
  limit = "20"
}: Request): Promise<Response> => {
  // Validação de companyId
  if (!companyId || companyId === undefined || companyId === null) {
    throw new AppError("companyId é obrigatório e não pode ser undefined", 400);
  }

  const offset = parseInt(limit) * (parseInt(pageNumber) - 1);

  let whereCondition: Filterable["where"] = {
    companyId
  };

  // Se não for showAll, mostrar apenas as tarefas do usuário ou atribuídas a ele
  if (!showAll && userId) {
    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        { userId },
        { assignedToId: userId }
      ]
    };
  }

  // Filtro por status
  if (status) {
    whereCondition = {
      ...whereCondition,
      status
    };
  }

  // Filtro por prioridade
  if (priority) {
    whereCondition = {
      ...whereCondition,
      priority
    };
  }

  // Filtro por categoria
  if (category) {
    whereCondition = {
      ...whereCondition,
      category
    };
  }

  // Filtro por responsável
  if (assignedToId) {
    whereCondition = {
      ...whereCondition,
      assignedToId
    };
  }

  // Busca por texto
  if (searchParam) {
    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        { title: { [Op.like]: `%${searchParam}%` } },
        { description: { [Op.like]: `%${searchParam}%` } },
        { category: { [Op.like]: `%${searchParam}%` } }
      ]
    };
  }

  const includeCondition: Includeable[] = [
    {
      model: User,
      as: "user",
      attributes: ["id", "name", "email"]
    },
    {
      model: User,
      as: "assignedTo",
      attributes: ["id", "name", "email"]
    },
    {
      model: Contact,
      as: "contact",
      attributes: ["id", "name", "number"]
    },
    {
      model: Ticket,
      as: "ticket",
      attributes: ["id", "status"]
    }
  ];

  const { count, rows: tasks } = await Task.findAndCountAll({
    where: whereCondition,
    include: includeCondition,
    order: [
      ["status", "ASC"],
      ["priority", "DESC"],
      ["dueDate", "ASC"],
      ["createdAt", "DESC"]
    ],
    limit: parseInt(limit),
    offset
  });

  const hasMore = count > offset + tasks.length;

  return {
    tasks,
    count,
    hasMore
  };
};

export default ListTasksService;

