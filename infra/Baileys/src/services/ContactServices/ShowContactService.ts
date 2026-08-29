import Contact from "../../models/Contact";
import AppError from "../../errors/AppError";

const ShowContactService = async (
  id: string | number,
  companyId: number
): Promise<Contact> => {
  const contact = await Contact.findByPk(id, { include: ["extraInfo", "whatsapp", "user"] });

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  if (contact.companyId !== companyId) {
    throw new AppError("Não é possível acessar registro de outra empresa");
  }

  return contact;
};

export default ShowContactService;
