import User from "../../models/User";
import AppError from "../../errors/AppError";
import Queue from "../../models/Queue";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import { appCache, CACHE_TTL } from "../../libs/appCache";

const fetchUserFromDb = async (id: string | number): Promise<User> => {
  const user = await User.findByPk(id, {
    attributes: [
      "name",
      "id",
      "email",
      "companyId",
      "profile",
      "super",
      "tokenVersion",
      "whatsappId",
      "allTicket",
      "avatar",
      "defaultRoute",
      "active",
      "pageAccess"
    ],
    include: [
      { model: Queue, as: "queues", attributes: ["id", "name", "color"] },
      {
        model: Company,
        as: "company",
        attributes: [
          "id",
          "name",
          "dueDate",
          "planId",
          "language",
          "status",
          "asaasCustomerId"
        ],
        include: [
          {
            model: Plan,
            as: "plan",
            attributes: ["id", "name"],
            required: false
          }
        ]
      }
    ]
  });

  if (!user) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  return user;
};

const ShowUserService = async (id: string | number): Promise<User> => {
  const userForVersion = await User.findByPk(id, {
    attributes: ["id", "tokenVersion"]
  });

  if (!userForVersion) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  const cacheKey = appCache.buildUserKey(
    userForVersion.id,
    userForVersion.tokenVersion,
    "profile"
  );

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.user,
    async () => {
      const user = await fetchUserFromDb(id);
      return user.get({ plain: true });
    },
    "users"
  );

  return value as unknown as User;
};

export default ShowUserService;
