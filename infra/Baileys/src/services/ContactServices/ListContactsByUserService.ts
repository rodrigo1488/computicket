import Contact from "../../models/Contact";

interface Request {
  userId: number;
  companyId: number;
  pageNumber?: string;
}

interface Response {
  contacts: Contact[];
  count: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;

const ListContactsByUserService = async ({
  userId,
  companyId,
  pageNumber = "1"
}: Request): Promise<Response> => {
  const limit = DEFAULT_LIMIT;
  const offset = limit * (Math.max(1, +pageNumber || 1) - 1);

  const { count, rows: contacts } = await Contact.findAndCountAll({
    where: {
      userId,
      companyId
    },
    attributes: ["id", "name", "number", "email", "profilePicUrl"],
    order: [["name", "ASC"]],
    limit,
    offset
  });

  return {
    contacts,
    count,
    hasMore: count > offset + contacts.length
  };
};

export default ListContactsByUserService;
