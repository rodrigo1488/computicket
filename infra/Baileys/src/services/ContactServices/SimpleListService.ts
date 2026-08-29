import Contact from "../../models/Contact";
import AppError from "../../errors/AppError";
import { FindOptions, Op } from "sequelize";

export interface SearchContactParams {
  companyId: string | number;
  name?: string;
}

const SIMPLE_LIST_LIMIT = 50;

const SimpleListService = async ({
  name,
  companyId
}: SearchContactParams): Promise<Contact[]> => {
  const options: FindOptions = {
    order: [["name", "ASC"]],
    limit: SIMPLE_LIST_LIMIT,
    where: { companyId }
  };

  if (name) {
    options.where = {
      companyId,
      name: {
        [Op.like]: `%${name}%`
      }
    };
  }

  const contacts = await Contact.findAll(options);

  if (!contacts) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  return contacts;
};

export default SimpleListService;
