import UserQuickButton from "../../models/UserQuickButton";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  userId: number;
  label: string;
  route: string;
  icon?: string;
  color?: string;
  order?: number;
  isVisible?: boolean;
}

interface Response {
  button: UserQuickButton;
}

// Lista de rotas válidas do sistema
const VALID_ROUTES = [
  "/dashboard",
  "/tickets",
  "/contacts",
  "/todolist",
  "/kanban",
  "/queues",
  "/users",
  "/settings",
  "/prompts",
  "/files",
  "/tags",
  "/schedules",
  "/quick-messages",
  "/connections",
  "/chats",
  "/helps",
  "/messages-api",
  "/queue-integration",
  "/financeiro",
  "/announcements",
  "/subscription",
  "/contact-lists",
  "/campaigns",
  "/campaigns-config",
  "/phrase-lists",
  "/flowbuilders",
  "/forms",
];

const CreateUserQuickButtonService = async ({
  companyId,
  userId,
  label,
  route,
  icon,
  color = "#1976d2",
  order,
  isVisible = true,
}: Request): Promise<Response> => {
  // Validar rota
  if (!VALID_ROUTES.includes(route)) {
    throw new AppError("Rota inválida", 400);
  }

  // Validar label
  if (!label || label.trim().length === 0) {
    throw new AppError("Label é obrigatório", 400);
  }

  // Verificar limite de botões (máximo 12)
  const existingButtons = await UserQuickButton.count({
    where: { companyId, userId },
  });

  if (existingButtons >= 12) {
    throw new AppError("Limite máximo de 12 botões atingido", 400);
  }

  // Se order não foi fornecido, usar o próximo disponível
  let finalOrder = order;
  if (finalOrder === undefined || finalOrder === null) {
    const maxOrder = await UserQuickButton.max("order", {
      where: { companyId, userId },
    });
    finalOrder = (Number(maxOrder) || 0) + 1;
  }

  const button = await UserQuickButton.create({
    companyId,
    userId,
    label: label.trim(),
    route,
    icon: icon || null,
    color,
    order: finalOrder,
    isVisible,
  });

  return { button };
};

export default CreateUserQuickButtonService;
