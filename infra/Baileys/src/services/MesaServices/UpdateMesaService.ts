import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  mesaId: number;
  companyId: number;
  number?: string;
  name?: string;
  type?: string;
  formId?: number;
  capacity?: number;
  section?: string;
  displayOrder?: number;
}

const UpdateMesaService = async ({
  mesaId,
  companyId,
  number,
  name,
  type,
  formId,
  capacity,
  section,
  displayOrder,
}: Request): Promise<Mesa> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (number !== undefined) {
    if (!number || number.trim() === "") {
      throw new AppError("ERR_MESA_NUMBER_REQUIRED", 400);
    }
    const currentType = (mesa as any).type || "mesa";
    const existing = await Mesa.findOne({
      where: { companyId, number: number.trim(), type: currentType },
    });
    if (existing && existing.id !== mesaId) {
      throw new AppError("ERR_MESA_NUMBER_ALREADY_EXISTS", 400);
    }
    mesa.number = number.trim();
  }

  if (name !== undefined) {
    mesa.name = name?.trim() || null;
  }

  if (type !== undefined) {
    (mesa as any).type = type === "comanda" ? "comanda" : "mesa";
  }

  if (formId !== undefined) {
    mesa.formId = formId || null;
  }

  if (capacity !== undefined) {
    mesa.capacity = capacity || null;
  }

  if (section !== undefined) {
    mesa.section = section?.trim() || null;
  }

  if (displayOrder !== undefined) {
    mesa.displayOrder = displayOrder ?? 0;
  }

  await mesa.save();

  return mesa;
};

export default UpdateMesaService;
