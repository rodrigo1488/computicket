import { Sequelize, Op } from "sequelize";
import Queue from "../../models/Queue";
import Company from "../../models/Company";
import User from "../../models/User";
import { appCache, CACHE_TTL } from "../../libs/appCache";

interface Request {
  searchParam?: string;
  pageNumber?: string | number;
  profile?: string;
  companyId?: number;
}

interface Response {
  users: User[];
  count: number;
  hasMore: boolean;
}

const fetchUsers = async ({
  searchParam = "",
  pageNumber = "1",
  companyId
}: Request): Promise<Response> => {
  const trimmedSearch = searchParam.trim();

  const whereCondition = {
    [Op.or]: [
      {
        "$User.name$": Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("User.name")),
          "LIKE",
          `%${trimmedSearch.toLowerCase()}%`
        )
      },
      { email: { [Op.like]: `%${trimmedSearch.toLowerCase()}%` } }
    ],
    companyId: {
      [Op.eq]: companyId
    }
  };

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: users } = await User.findAndCountAll({
    where: whereCondition,
    attributes: [
      "name",
      "id",
      "email",
      "companyId",
      "profile",
      "createdAt",
      "active"
    ],
    limit,
    offset,
    order: [["createdAt", "DESC"]],
    include: [
      { model: Queue, as: "queues", attributes: ["id", "name", "color"] },
      { model: Company, as: "company", attributes: ["id", "name"] }
    ]
  });

  const hasMore = count > offset + users.length;

  return {
    users: users.map(u => u.get({ plain: true })) as User[],
    count,
    hasMore
  };
};

const ListUsersService = async (request: Request): Promise<Response> => {
  const { searchParam = "", pageNumber = "1", companyId } = request;

  if (companyId === undefined) {
    return fetchUsers(request);
  }

  const trimmedSearch = searchParam.trim();
  const ttl = trimmedSearch ? 30 : CACHE_TTL.list;

  const cacheKey = appCache.buildKey("users", companyId, "list", {
    searchParam: trimmedSearch,
    pageNumber
  });

  const { value } = await appCache.getOrSet(
    cacheKey,
    ttl,
    async () => fetchUsers(request),
    "users"
  );

  return value;
};

export default ListUsersService;
