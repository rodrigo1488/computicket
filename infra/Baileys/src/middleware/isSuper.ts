import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import User from "../models/User";
import { appCache, CACHE_TTL } from "../libs/appCache";

const isSuper = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const cacheKey = appCache.buildKey("users", null, `super:${req.user.id}`);

  const { value: isSuperUser } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.super,
    async () => {
      const user = await User.findByPk(req.user.id, { attributes: ["super"] });
      return !!user?.super;
    },
    "users"
  );

  if (!isSuperUser) {
    throw new AppError("Acesso não permitido", 401);
  }

  return next();
};

export default isSuper;
