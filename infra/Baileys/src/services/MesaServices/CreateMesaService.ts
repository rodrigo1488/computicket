import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  number: string;
  name?: string;
  companyId: number;
  type?: string;
  formId?: number;
  capacity?: number;
  section?: string;
  displayOrder?: number;
}

const CreateMesaService = async ({
  number,
  name,
  companyId,
  type = "mesa",
  formId,
  capacity,
  section,
  displayOrder = 0,
}: Request): Promise<Mesa> => {
  if (!number || number.trim() === "") {
    throw new AppError("ERR_MESA_NUMBER_REQUIRED", 400);
  }

  const normalizedType = (type === "comanda" ? "comanda" : "mesa") as string;

  const existing = await Mesa.findOne({
    where: { companyId, number: number.trim(), type: normalizedType },
  });

  if (existing) {
    throw new AppError("ERR_MESA_NUMBER_ALREADY_EXISTS", 400);
  }

  const mesa = await Mesa.create({
    number: number.trim(),
    name: name?.trim() || null,
    status: "livre",
    type: normalizedType,
    companyId,
    formId: formId || null,
    capacity: capacity || null,
    section: section?.trim() || null,
    displayOrder: displayOrder || 0,
  });

  return mesa;
};

export default CreateMesaService;
