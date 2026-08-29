import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";
import { parseMesaQrContent } from "../../helpers/mesaQrParse";
import { verifyMesaLinkOnly } from "../../helpers/MesaLinkSign";
import ValidateMesaRestoreQrService from "./ValidateMesaRestoreQrService";

interface Request {
  companyId: number;
  qrContent: string;
  number: string;
  name?: string | null;
  type?: "mesa" | "comanda";
  formId?: number | null;
  capacity?: number | null;
  section?: string | null;
  displayOrder?: number;
}

const bumpMesasIdSequence = async (): Promise<void> => {
  await sequelize.query(
    `SELECT setval(
      pg_get_serial_sequence('"Mesas"', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM "Mesas"), 1)
    )`,
    { type: QueryTypes.SELECT }
  );
};

const RestoreMesaFromQrService = async ({
  companyId,
  qrContent,
  number,
  name,
  type = "mesa",
  formId = null,
  capacity = null,
  section = null,
  displayOrder = 0,
}: Request): Promise<Mesa> => {
  const validation = await ValidateMesaRestoreQrService({ companyId, qrContent });
  if (!validation.canRestore) {
    throw new AppError("ERR_MESA_RESTORE_ALREADY_EXISTS", 409);
  }

  const parsed = parseMesaQrContent(qrContent);
  if (!parsed || !verifyMesaLinkOnly(companyId, parsed.mesaId, parsed.token)) {
    throw new AppError("ERR_MESA_QR_TOKEN_INVALID", 403);
  }

  if (!number || !number.trim()) {
    throw new AppError("ERR_MESA_NUMBER_REQUIRED", 400);
  }

  const normalizedType = type === "comanda" ? "comanda" : "mesa";
  const trimmedNumber = number.trim();

  const duplicateNumber = await Mesa.findOne({
    where: { companyId, number: trimmedNumber, type: normalizedType },
  });
  if (duplicateNumber) {
    throw new AppError("ERR_MESA_NUMBER_ALREADY_EXISTS", 400);
  }

  const mesa = await sequelize.transaction(async (transaction) =>
    Mesa.create(
      {
        id: parsed.mesaId,
        number: trimmedNumber,
        name: name?.trim() || null,
        status: "livre",
        type: normalizedType,
        companyId,
        formId: formId || null,
        capacity: capacity || null,
        section: section?.trim() || null,
        displayOrder: displayOrder || 0,
      },
      { transaction }
    )
  );

  await bumpMesasIdSequence();

  return mesa;
};

export default RestoreMesaFromQrService;
