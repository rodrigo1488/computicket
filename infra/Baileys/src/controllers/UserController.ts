import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import CheckSettingsHelper from "../helpers/CheckSettings";
import AppError from "../errors/AppError";

import CreateUserService from "../services/UserServices/CreateUserService";
import ListUsersService from "../services/UserServices/ListUsersService";
import UpdateUserService from "../services/UserServices/UpdateUserService";
import ShowUserService from "../services/UserServices/ShowUserService";
import DeleteUserService from "../services/UserServices/DeleteUserService";
import SetUserActiveService from "../services/UserServices/SetUserActiveService";
import SimpleListService from "../services/UserServices/SimpleListService";
import ListContactsByUserService from "../services/ContactServices/ListContactsByUserService";
import User from "../models/User";
import SetLanguageCompanyService from "../services/UserServices/SetLanguageCompanyService";
import CacheInvalidationService from "../services/CacheServices/CacheInvalidationService";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

type ListQueryParams = {
  companyId: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;

  const { users, count, hasMore } = await ListUsersService({
    searchParam,
    pageNumber,
    companyId,
    profile
  });

  return res.json({ users, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const {
    email,
    password,
    name,
    profile,
    companyId: bodyCompanyId,
    queueIds,
    whatsappId,
    allTicket,
    defaultRoute,
    pageAccess,
  } = req.body;
  let userCompanyId: number | null = null;

  let requestUser: User = null;

  if (req.user !== undefined) {
    const { companyId: cId } = req.user;
    userCompanyId = cId;
    requestUser = await User.findByPk(req.user.id);
  }

  const newUserCompanyId = bodyCompanyId || userCompanyId;

  if (req.url === "/signup") {
    if (await CheckSettingsHelper("userCreation") === "disabled") {
      throw new AppError("ERR_USER_CREATION_DISABLED", 403);
    }
  } else if (req.user?.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  } else if (newUserCompanyId !== req.user?.companyId && !requestUser?.super) {
    throw new AppError("ERR_NO_SUPER", 403);
  }

  const user = await CreateUserService({
    email,
    password,
    name,
    profile,
    companyId: newUserCompanyId,
    queueIds,
    whatsappId,
    allTicket,
    defaultRoute,
    pageAccess,
  });

  const io = getIO();
  io.to(`company-${userCompanyId}-mainchannel`).emit(`company-${userCompanyId}-user`, {
    action: "create",
    user
  });

  return res.status(200).json(user);
};

export const pagePermissionsCatalog = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const {
    PAGE_DEFINITIONS,
    DEFAULT_USER_PAGE_KEYS,
    ADMIN_PAGE_KEYS
  } = await import("../constants/pagePermissions");

  return res.status(200).json({
    pages: PAGE_DEFINITIONS,
    defaultUserPages: DEFAULT_USER_PAGE_KEYS,
    adminPages: ADMIN_PAGE_KEYS
  });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;

  const user = await ShowUserService(userId);

  return res.status(200).json(user);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { id: requestUserId, companyId } = req.user;
  const { userId } = req.params;
  const userData = req.body;

  const user = await UpdateUserService({
    userData,
    userId,
    companyId,
    requestUserId: +requestUserId
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "update",
    user
  });

  return res.status(200).json(user);
};

export const setActive = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { userId } = req.params;
  const { companyId, id: requestUserId } = req.user;
  const { active } = req.body as { active?: boolean };

  if (typeof active !== "boolean") {
    throw new AppError("Campo active deve ser booleano", 400);
  }

  const user = await SetUserActiveService({
    userId,
    companyId,
    requestUserId: +requestUserId,
    active,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "update",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      profile: user.profile,
      companyId: user.companyId,
      active: user.active,
    },
  });

  return res.status(200).json({
    id: user.id,
    name: user.name,
    email: user.email,
    profile: user.profile,
    active: user.active,
  });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { userId } = req.params;
  const { companyId } = req.user;

  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  await DeleteUserService(userId, companyId);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "delete",
    userId
  });

  return res.status(200).json({ message: "User deleted" });
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.query;
  const { companyId: userCompanyId } = req.user;

  const users = await SimpleListService({
    companyId: companyId ? +companyId : userCompanyId
  });

  return res.status(200).json(users);
};

export const getContacts = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;
  const { companyId } = req.user;

  const { contacts, count } = await ListContactsByUserService({
    userId: +userId,
    companyId
  });

  return res.status(200).json({ contacts, count });
};

export const setLanguage = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const {newLanguage} = req.params;

  if( newLanguage !== "pt" && newLanguage !== "en" && newLanguage !== "es" )
    throw new AppError("ERR_INTERNAL_SERVER_ERROR", 500);

  await SetLanguageCompanyService( companyId, newLanguage );

  return res.status(200).json({message: "Language updated successfully"});
}

export const updateAvailabilitySettings = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;
  const { companyId, profile } = req.user;
  const { availabilitySettings } = req.body;

  // Apenas admin pode atualizar configurações de outros usuários
  if (Number(userId) !== Number(req.user.id) && profile !== "admin") {
    throw new AppError("Você não tem permissão para atualizar configurações de outros usuários", 403);
  }

  const user = await User.findOne({
    where: { id: userId, companyId },
  });

  if (!user) {
    throw new AppError("Usuário não encontrado", 404);
  }

  // Validar estrutura das configurações
  if (availabilitySettings) {
    if (typeof availabilitySettings.enabled !== "boolean") {
      throw new AppError("Campo 'enabled' deve ser um booleano", 400);
    }

    if (availabilitySettings.weekdays) {
      const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      for (const day of Object.keys(availabilitySettings.weekdays)) {
        if (!validDays.includes(day)) {
          throw new AppError(`Dia inválido: ${day}`, 400);
        }
        const dayConfig = availabilitySettings.weekdays[day];
        if (dayConfig.enabled && (!dayConfig.startTime || !dayConfig.endTime)) {
          throw new AppError(`Dia ${day} requer startTime e endTime quando enabled é true`, 400);
        }
        // Validar formato de horário (HH:MM)
        if (dayConfig.startTime && !/^\d{2}:\d{2}$/.test(dayConfig.startTime)) {
          throw new AppError(`Formato de horário inválido para ${day}.startTime. Use HH:MM`, 400);
        }
        if (dayConfig.endTime && !/^\d{2}:\d{2}$/.test(dayConfig.endTime)) {
          throw new AppError(`Formato de horário inválido para ${day}.endTime. Use HH:MM`, 400);
        }
      }
    }
  }

  await user.update({ availabilitySettings });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "update",
    user: user.toJSON(),
  });

  return res.status(200).json({ availabilitySettings: user.availabilitySettings });
};

export const getAvailabilitySettings = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;
  const { companyId, profile } = req.user;

  // Apenas admin pode ver configurações de outros usuários
  if (Number(userId) !== Number(req.user.id) && profile !== "admin") {
    throw new AppError("Você não tem permissão para ver configurações de outros usuários", 403);
  }

  const user = await User.findOne({
    where: { id: userId, companyId },
    attributes: ["id", "name", "email", "availabilitySettings"],
  });

  if (!user) {
    throw new AppError("Usuário não encontrado", 404);
  }

  return res.status(200).json({ availabilitySettings: user.availabilitySettings || null });
};

export const uploadAvatar = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;
  const { companyId, id: requestUserId } = req.user;
  
  // Debug: verificar o que está chegando
  console.log("Upload Avatar - req.file:", req.file);
  console.log("Upload Avatar - req.files:", req.files);
  console.log("Upload Avatar - req.body:", req.body);
  
  const file = req.file as Express.Multer.File;

  if (!file) {
    throw new AppError("ERR_NO_FILE", 400);
  }

  const user = await User.findByPk(userId);

  if (!user) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  // Verificar se o usuário pertence à mesma empresa ou se é o próprio usuário
  if (user.companyId !== companyId && +requestUserId !== user.id) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  // Permitir que o usuário atualize seu próprio avatar ou admin atualize qualquer usuário
  if (req.user.profile !== "admin" && +requestUserId !== user.id) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const avatarPath = `users/${file.filename}`;

  await user.update({ avatar: avatarPath });

  void CacheInvalidationService.onUserChanged(user.id, user.companyId);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "update",
    user: await user.reload()
  });

  return res.status(200).json({ avatar: avatarPath });
};