import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import ContactCustomField from "../../models/ContactCustomField";

interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  userId?: number;
}

const CreateContactService = async ({
  name,
  number,
  email = "",
  companyId,
  extraInfo = [],
  userId
}: Request): Promise<Contact> => {
  const numberExists = await Contact.findOne({
    where: { number, companyId }
  });

  if (numberExists) {
    throw new AppError("ERR_DUPLICATED_CONTACT");
  }

  const contact = await Contact.create(
    {
      name,
      number,
      email,
      extraInfo,
      companyId,
      userId: userId || null
    },
    {
      include: ["extraInfo"]
    }
  );

  void CacheInvalidationService.onContactChanged(companyId, contact.id);

  return contact;
};

export default CreateContactService;
