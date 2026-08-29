import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import ContactCustomField from "../../models/ContactCustomField";
import { Op } from "sequelize";

interface ExtraInfo {
  id?: number;
  name: string;
  value: string;
}
interface ContactData {
  email?: string;
  number?: string;
  name?: string;
  extraInfo?: ExtraInfo[];
  userId?: number;
}

interface Request {
  contactData: ContactData;
  contactId: string;
  companyId: number;
}

const UpdateContactService = async ({
  contactData,
  contactId,
  companyId
}: Request): Promise<Contact> => {
  const { email, name, number, extraInfo, userId } = contactData;

  const contact = await Contact.findOne({
    where: { id: contactId },
    attributes: ["id", "name", "number", "email", "companyId", "profilePicUrl"],
    include: ["extraInfo"]
  });

  if (contact?.companyId !== companyId) {
    throw new AppError("Não é possível alterar registros de outra empresa");
  }

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  // Verificar se o número já existe para outro contato na mesma empresa
  if (number && number !== contact.number) {
    const existingContact = await Contact.findOne({
      where: {
        number,
        companyId,
        id: { [Op.ne]: contactId } // Excluir o contato atual
      }
    });

    if (existingContact) {
      throw new AppError(
        `Já existe um contato com o número ${number} nesta empresa`,
        400
      );
    }
  }

  if (extraInfo) {
    await Promise.all(
      extraInfo.map(async (info: any) => {
        await ContactCustomField.upsert({ ...info, contactId: contact.id });
      })
    );

    await Promise.all(
      contact.extraInfo.map(async oldInfo => {
        const stillExists = extraInfo.findIndex(info => info.id === oldInfo.id);

        if (stillExists === -1) {
          await ContactCustomField.destroy({ where: { id: oldInfo.id } });
        }
      })
    );
  }

  await contact.update({
    name,
    number,
    email,
    userId: userId !== undefined ? (userId === null ? null : userId) : contact.userId
  });

  await contact.reload({
    attributes: ["id", "name", "number", "email", "profilePicUrl"],
    include: ["extraInfo", "user"]
  });

  void CacheInvalidationService.onContactChanged(companyId, contact.id);

  return contact;
};

export default UpdateContactService;
