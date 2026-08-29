import UserQuickButton from "../../models/UserQuickButton";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  userId: number;
  buttonId: number;
  label?: string;
  route?: string;
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

const UpdateUserQuickButtonService = async ({
  companyId,
  userId,
  buttonId,
  label,
  route,
  icon,
  color,
  order,
  isVisible,
}: Request): Promise<Response> => {
  const button = await UserQuickButton.findOne({
    where: { id: buttonId, companyId, userId },
  });

  if (!button) {
    throw new AppError("Botão não encontrado", 404);
  }

  // Validar rota se fornecida
  if (route && !VALID_ROUTES.includes(route)) {
    throw new AppError("Rota inválida", 400);
  }

  // Validar label se fornecido
  if (label !== undefined && (!label || label.trim().length === 0)) {
    throw new AppError("Label não pode ser vazio", 400);
  }

  // Atualizar campos fornecidos
  if (label !== undefined) {
    button.label = label.trim();
  }
  if (route !== undefined) {
    button.route = route;
  }
  if (icon !== undefined) {
    button.icon = icon || null;
  }
  if (color !== undefined) {
    button.color = color;
  }
  if (order !== undefined) {
    button.order = order;
  }
  if (isVisible !== undefined) {
    button.isVisible = isVisible;
  }

  await button.save();

  return { button };
};

export default UpdateUserQuickButtonService;
