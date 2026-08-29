import { Transaction } from "sequelize";
import UserQuickButton from "../../models/UserQuickButton";
import AppError from "../../errors/AppError";
import database from "../../database";

interface ButtonOrder {
  id: number;
  order: number;
}

interface Request {
  companyId: number;
  userId: number;
  buttons: ButtonOrder[];
}

const ReorderUserQuickButtonsService = async ({
  companyId,
  userId,
  buttons,
}: Request): Promise<void> => {
  const transaction: Transaction = await database.transaction();

  try {
    // Validar que todos os botões pertencem ao usuário
    const buttonIds = buttons.map((b) => b.id);
    const existingButtons = await UserQuickButton.findAll({
      where: {
        id: buttonIds,
        companyId,
        userId,
      },
      transaction,
    });

    if (existingButtons.length !== buttons.length) {
      throw new AppError("Um ou mais botões não foram encontrados", 404);
    }

    // Atualizar ordem de cada botão
    const updatePromises = buttons.map(({ id, order }) =>
      UserQuickButton.update(
        { order },
        {
          where: { id, companyId, userId },
          transaction,
        }
      )
    );

    await Promise.all(updatePromises);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export default ReorderUserQuickButtonsService;
