import Contact from "../../models/Contact";
import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";

/** Sessão Baileys / tokens não devem ir na API — incham a resposta e causam 502 no proxy. */
const WHATSAPP_PUBLIC_ATTRS = {
  exclude: [
    "session",
    "qrcode",
    "facebookUserToken",
    "tokenStore",
    "gupshupApiKey"
  ]
};

const ShowContactService = async (
  id: string | number,
  companyId: number
): Promise<Contact> => {
  const contact = await Contact.findByPk(id, {
    include: [
      "extraInfo",
      {
        model: Whatsapp,
        as: "whatsapp",
        attributes: WHATSAPP_PUBLIC_ATTRS
      },
      {
        model: User,
        as: "user",
        attributes: ["id", "name", "email"]
      }
    ]
  });

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  if (contact.companyId !== companyId) {
    throw new AppError("Não é possível acessar registro de outra empresa");
  }

  return contact;
};

export default ShowContactService;
