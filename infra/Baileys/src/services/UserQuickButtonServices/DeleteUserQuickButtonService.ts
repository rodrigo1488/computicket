import UserQuickButton from "../../models/UserQuickButton";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  userId: number;
  buttonId: number;
}

const DeleteUserQuickButtonService = async ({
  companyId,
  userId,
  buttonId,
}: Request): Promise<void> => {
  const button = await UserQuickButton.findOne({
    where: { id: buttonId, companyId, userId },
  });

  if (!button) {
    throw new AppError("Botão não encontrado", 404);
  }

  await button.destroy();
};

export default DeleteUserQuickButtonService;
