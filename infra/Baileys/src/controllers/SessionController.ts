import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { getIO } from "../libs/socket";

import AuthUserService from "../services/UserServices/AuthUserService";
import { SendRefreshToken } from "../helpers/SendRefreshToken";
import { RefreshTokenService } from "../services/AuthServices/RefreshTokenService";
import FindUserFromToken from "../services/AuthServices/FindUserFromToken";
import User from "../models/User";

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { email, password } = req.body;

  const { token, serializedUser, refreshToken } = await AuthUserService({
    email,
    password
  });

  SendRefreshToken(res, refreshToken);

  try {
    const io = getIO();
    io.to(`user-${serializedUser.id}`).emit(`company-${serializedUser.companyId}-auth`, {
      action: "update",
      user: {
        id: serializedUser.id,
        email: serializedUser.email,
        companyId: serializedUser.companyId
      }
    });
  } catch (err) {
    // Não falhar o login se o Socket.IO não estiver inicializado ou emitir falhar
  }

  return res.status(200).json({
    token,
    refreshToken,
    user: serializedUser
  });
};

const readRefreshToken = (req: Request): string => {
  const cookieToken = typeof req.cookies?.jrt === "string" ? req.cookies.jrt : "";
  const bodyToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  const headerToken = typeof req.headers["x-refresh-token"] === "string"
    ? req.headers["x-refresh-token"]
    : "";
  return cookieToken || bodyToken || headerToken;
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {

  const token: string = readRefreshToken(req);

  if (!token) {
    throw new AppError("ERR_SESSION_EXPIRED", 401);
  }

  const { user, newToken, refreshToken } = await RefreshTokenService(
    res,
    token
  );

  SendRefreshToken(res, refreshToken);

  return res.json({ token: newToken, refreshToken, user });
};

export const me = async (req: Request, res: Response): Promise<Response> => {
  const token: string = req.cookies.jrt;
  const user = await FindUserFromToken(token);
  const { id, profile, super: superAdmin } = user;

  if (!token) {
    throw new AppError("ERR_SESSION_EXPIRED", 401);
  }

  return res.json({ id, profile, super: superAdmin });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.user;
  const user = await User.findByPk(id);
  await user.update({ online: false });

  res.clearCookie("jrt");

  return res.send();
};
