import User from "../../models/User";
import AppError from "../../errors/AppError";
import Queue from "../../models/Queue";
import { appCache, CACHE_TTL } from "../../libs/appCache";

interface Params {
  companyId: string | number;
}

const fetchSimpleUsers = async (companyId: string | number): Promise<User[]> => {
  const users = await User.findAll({
    where: {
      companyId,
      active: true
    },
    attributes: ["name", "id", "email"],
    include: [{ model: Queue, as: "queues" }],
    order: [["id", "ASC"]]
  });

  if (!users) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  return users.map(u => u.get({ plain: true })) as User[];
};

const SimpleListService = async ({ companyId }: Params): Promise<User[]> => {
  const cacheKey = appCache.buildKey("users", companyId, "simple");

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.list,
    async () => fetchSimpleUsers(companyId),
    "users"
  );

  return value;
};

export default SimpleListService;
