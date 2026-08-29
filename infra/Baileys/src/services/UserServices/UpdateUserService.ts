import * as Yup from "yup";

import AppError from "../../errors/AppError";
import Company from "../../models/Company";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";
import User from "../../models/User";
import Queue from "../../models/Queue";
import { sanitizePageAccess } from "../../constants/pagePermissions";
import ListCompanyModulesService from "../CompanyModuleServices/ListCompanyModulesService";
import {
  filterPageAccessForModules,
  getModuleFlagsFromSlugs
} from "../../helpers/pagePermissionModules";

interface UserData {
  email?: string;
  password?: string;
  name?: string;
  profile?: string;
  companyId?: number;
  queueIds?: number[];
  whatsappId?: number;
  allTicket?: string;
  avatar?: string;
  defaultRoute?: string | null;
  pageAccess?: { granted?: string[]; denied?: string[] } | null;
}

interface Request {
  userData: UserData;
  userId: string | number;
  companyId: number;
  requestUserId: number;
}

interface Response {
  id: number;
  name: string;
  email: string;
  profile: string;
}

const UpdateUserService = async ({
  userData,
  userId,
  companyId,
  requestUserId
}: Request): Promise<Response | undefined> => {
  // ShowUserService devolve objeto plano (cache) — para mutação precisamos do Model.
  const user = await User.findByPk(userId, {
    include: [
      { model: Queue, as: "queues", attributes: ["id", "name", "color"] },
      { model: Company, as: "company" }
    ]
  });

  if (!user) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  const requestUser = await User.findByPk(requestUserId);

  if (!requestUser) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  if (!requestUser.super) {
    if (Number(user.companyId) !== Number(companyId)) {
      throw new AppError("O usuário não pertence à esta empresa");
    }
    if (
      userData.companyId !== undefined &&
      userData.companyId !== null &&
      Number(userData.companyId) !== Number(companyId)
    ) {
      throw new AppError("O usuário não pertence à esta empresa");
    }
  }

  const schema = Yup.object().shape({
    name: Yup.string().min(2),
    email: Yup.string().email(),
    profile: Yup.string(),
    password: Yup.string(),
    allTicket: Yup.string(),
    defaultRoute: Yup.string().nullable()
  });

  const {
    email,
    password,
    profile,
    name,
    queueIds,
    whatsappId,
    allTicket,
    avatar,
    defaultRoute,
    pageAccess: pageAccessInput
  } = userData;

  try {
    await schema.validate({ email, password, profile, name, allTicket });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const nextProfile = profile !== undefined ? profile : user.profile;
  const companyModules = await ListCompanyModulesService(
    Number(user.companyId) || companyId
  );
  const moduleFlags = getModuleFlagsFromSlugs(companyModules);

  const sanitizePageAccessForCompany = (
    input: { granted?: string[]; denied?: string[] } | null | undefined
  ) => filterPageAccessForModules(sanitizePageAccess(input), moduleFlags);

  const updateData: Record<string, unknown> = {};

  if (email !== undefined) updateData.email = email;
  if (password) updateData.password = password;
  if (profile !== undefined) updateData.profile = profile;
  if (name !== undefined) updateData.name = name;
  if (whatsappId !== undefined) {
    updateData.whatsappId = whatsappId || null;
  }
  if (allTicket !== undefined) updateData.allTicket = allTicket;
  if (avatar !== undefined) updateData.avatar = avatar;
  if (defaultRoute !== undefined) {
    updateData.defaultRoute = defaultRoute || null;
  }

  if (pageAccessInput !== undefined) {
    updateData.pageAccess =
      nextProfile === "admin"
        ? null
        : sanitizePageAccessForCompany(pageAccessInput);
  } else if (profile === "admin") {
    updateData.pageAccess = null;
  }

  await user.update(updateData);

  if (Array.isArray(queueIds)) {
    await user.$set("queues", queueIds);
  }

  await user.reload({
    include: [
      { model: Queue, as: "queues", attributes: ["id", "name", "color"] },
      { model: Company, as: "company" }
    ]
  });

  const serializedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    profile: user.profile,
    companyId: user.companyId,
    company: user.company,
    queues: user.queues,
    avatar: user.avatar,
    defaultRoute: user.defaultRoute ?? null,
    pageAccess: user.pageAccess ?? null
  };

  void CacheInvalidationService.onUserChanged(user.id, user.companyId);

  return serializedUser;
};

export default UpdateUserService;
