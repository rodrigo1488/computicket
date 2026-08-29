import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  count: number;
  prefix?: string;
  suffix?: string;
  startFrom?: number;
  formId?: number | null;
  type?: "mesa" | "comanda";
}

const CreateBulkMesasService = async ({
  companyId,
  count,
  prefix,
  suffix = "",
  startFrom = 1,
  formId = null,
  type: rawType = "mesa",
}: Request): Promise<Mesa[]> => {
  if (count < 1 || count > 50) {
    throw new AppError("ERR_MESA_BULK_COUNT_INVALID", 400);
  }

  const type = rawType === "comanda" ? "comanda" : "mesa";
  const defaultPrefix = type === "comanda" ? "Comanda" : "Mesa";
  const resolvedPrefix = prefix !== undefined && prefix !== null ? prefix : defaultPrefix;

  const mesas: Mesa[] = [];
  const existingNumbers = new Set(
    (await Mesa.findAll({ where: { companyId, type }, attributes: ["number"] })).map(
      (m) => m.number
    )
  );

  for (let i = 0; i < count; i++) {
    const num = startFrom + i;
    const number = `${resolvedPrefix}${resolvedPrefix ? " " : ""}${num}${suffix ? " " : ""}${suffix}`.trim();
    if (existingNumbers.has(number)) {
      continue;
    }
    existingNumbers.add(number);
    const mesa = await Mesa.create({
      number,
      name: null,
      status: "livre",
      type,
      companyId,
      displayOrder: num,
      formId: formId || null,
    });
    mesas.push(mesa);
  }

  return mesas;
};

export default CreateBulkMesasService;
