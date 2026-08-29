import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
}

const DeleteMesaService = async ({
  mesaId,
  companyId,
}: Request): Promise<void> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  await mesa.destroy();
};

export default DeleteMesaService;
