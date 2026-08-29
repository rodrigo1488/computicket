import Contact from "../../models/Contact";
import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import ShowMesaService from "./ShowMesaService";

interface Request {
  mesaId: number;
  companyId: number;
  contactName: string;
}

const AtualizarNomeContatoMesaService = async ({
  mesaId,
  companyId,
  contactName,
}: Request): Promise<Mesa> => {
  const name = String(contactName || "").trim();
  if (!name) {
    throw new AppError("ERR_CONTACT_NAME_REQUIRED", 400);
  }

  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
    attributes: ["id", "companyId", "status", "contactId"],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (mesa.status !== "ocupada") {
    throw new AppError("ERR_MESA_NOT_OCCUPIED", 400);
  }

  if (!mesa.contactId) {
    throw new AppError("ERR_MESA_WITHOUT_CONTACT", 400);
  }

  const contact = await Contact.findOne({
    where: { id: mesa.contactId, companyId },
    attributes: ["id", "name", "companyId"],
  });

  if (!contact) {
    throw new AppError("ERR_CONTACT_NOT_FOUND", 404);
  }

  await contact.update({ name });
  void CacheInvalidationService.onContactChanged(companyId, contact.id);

  return ShowMesaService({ mesaId, companyId });
};

export default AtualizarNomeContatoMesaService;
