import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";
import { parseMesaQrContent } from "../../helpers/mesaQrParse";
import { verifyMesaLinkOnly } from "../../helpers/MesaLinkSign";

interface Request {
  companyId: number;
  qrContent: string;
}

interface Response {
  mesaId: number;
  canRestore: boolean;
  alreadyExists: boolean;
}

const ValidateMesaRestoreQrService = async ({
  companyId,
  qrContent,
}: Request): Promise<Response> => {
  const parsed = parseMesaQrContent(qrContent);
  if (!parsed) {
    throw new AppError("ERR_MESA_QR_INVALID", 400);
  }

  if (!verifyMesaLinkOnly(companyId, parsed.mesaId, parsed.token)) {
    throw new AppError("ERR_MESA_QR_TOKEN_INVALID", 403);
  }

  const existing = await Mesa.findByPk(parsed.mesaId);
  if (existing) {
    if (existing.companyId !== companyId) {
      throw new AppError("ERR_MESA_QR_ID_UNAVAILABLE", 409);
    }
    return {
      mesaId: parsed.mesaId,
      canRestore: false,
      alreadyExists: true,
    };
  }

  return {
    mesaId: parsed.mesaId,
    canRestore: true,
    alreadyExists: false,
  };
};

export default ValidateMesaRestoreQrService;
