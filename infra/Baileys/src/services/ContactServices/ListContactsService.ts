import { Sequelize, Op } from "sequelize";
import Contact from "../../models/Contact";
import User from "../../models/User";
import { appCache, CACHE_TTL } from "../../libs/appCache";
import { sanitizeContactProfilePicUrl } from "../../helpers/contactProfilePic";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  companyId: number;
}

interface Response {
  contacts: Contact[];
  count: number;
  hasMore: boolean;
}

const fetchContacts = async ({
  searchParam = "",
  pageNumber = "1",
  companyId
}: Request): Promise<Response> => {
  const whereCondition: any = {
    companyId: {
      [Op.eq]: companyId
    }
  };

  if (searchParam && searchParam.trim()) {
    whereCondition[Op.or] = [
      {
        name: Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("Contact.name")),
          "LIKE",
          `%${searchParam.toLowerCase().trim()}%`
        )
      },
      { number: { [Op.like]: `%${searchParam.toLowerCase().trim()}%` } }
    ];
  }

  const limit = 30;
  const offset = limit * (+pageNumber - 1);

  try {
    const { count, rows: contacts } = await Contact.findAndCountAll({
      where: whereCondition,
      limit,
      offset,
      order: [[Sequelize.col("Contact.name"), "ASC"]],
      include: [
        {
          model: User,
          as: "user",
          required: false,
          attributes: ["id", "name", "email"]
        }
      ]
    });

    return {
      contacts: contacts.map(c => {
        const json = c.toJSON() as Contact;
        json.profilePicUrl = sanitizeContactProfilePicUrl(json.profilePicUrl);
        return json;
      }),
      count,
      hasMore: count > offset + contacts.length
    };
  } catch (error: any) {
    console.error("Erro ao listar contatos com include de user:", error.message);
    const { count, rows: contacts } = await Contact.findAndCountAll({
      where: whereCondition,
      limit,
      offset,
      order: [[Sequelize.col("Contact.name"), "ASC"]]
    });

    return {
      contacts: contacts.map(c => {
        const json = c.toJSON() as Contact;
        json.profilePicUrl = sanitizeContactProfilePicUrl(json.profilePicUrl);
        return json;
      }),
      count,
      hasMore: count > offset + contacts.length
    };
  }
};

const ListContactsService = async (request: Request): Promise<Response> => {
  const { searchParam = "", pageNumber = "1", companyId } = request;
  const trimmedSearch = searchParam.trim();
  const ttl = trimmedSearch ? 30 : CACHE_TTL.list;

  const cacheKey = appCache.buildKey("contacts", companyId, "list", {
    searchParam: trimmedSearch,
    pageNumber
  });

  const { value } = await appCache.getOrSet(
    cacheKey,
    ttl,
    async () => fetchContacts(request),
    "contacts"
  );

  return value;
};

export default ListContactsService;
