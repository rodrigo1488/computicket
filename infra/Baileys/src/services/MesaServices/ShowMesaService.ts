import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
}

const ShowMesaService = async ({
  mesaId,
  companyId,
}: Request): Promise<Mesa> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
    include: [
      { association: "contact", attributes: ["id", "name", "number"] },
      { association: "ticket", attributes: ["id", "status"] },
    ],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  return mesa;
};

export default ShowMesaService;
