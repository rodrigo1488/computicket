import * as Yup from "yup";

import AppError from "../../errors/AppError";
import { SerializeUser } from "../../helpers/SerializeUser";
import { sanitizePageAccess } from "../../constants/pagePermissions";
import ListCompanyModulesService from "../CompanyModuleServices/ListCompanyModulesService";
import {
  filterPageAccessForModules,
  getModuleFlagsFromSlugs
} from "../../helpers/pagePermissionModules";
import User from "../../models/User";
import Plan from "../../models/Plan";
import Company from "../../models/Company";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

interface Request {
  email: string;
  password: string;
  name: string;
  queueIds?: number[];
  companyId?: number;
  profile?: string;
  whatsappId?: number;
  allTicket?: string;
  defaultRoute?: string | null;
  pageAccess?: { granted?: string[]; denied?: string[] } | null;
}

interface Response {
  email: string;
  name: string;
  id: number;
  profile: string;
}

const CreateUserService = async ({
  email,
  password,
  name,
  queueIds = [],
  companyId,
  profile = "admin",
  whatsappId,
  allTicket,
  defaultRoute,
  pageAccess: pageAccessInput,
}: Request): Promise<Response> => {
  if (companyId !== undefined) {
    const company = await Company.findOne({
      where: {
        id: companyId
      },
      include: [{ model: Plan, as: "plan" }]
    });

    if (company !== null) {
      const usersCount = await User.count({
        where: {
          companyId,
          active: true,
        },
      });

      if (usersCount >= company.plan.users) {
        throw new AppError(
          `Número máximo de usuários já alcançado: ${usersCount}`
        );
      }
    }
  }

  const schema = Yup.object().shape({
    name: Yup.string().required().min(2),
    email: Yup.string()
      .email()
      .required()
      .test(
        "Check-email",
        "An user with this email already exists.",
        async value => {
          if (!value) return false;
          const emailExists = await User.findOne({
            where: { email: value }
          });
          return !emailExists;
        }
      ),
    password: Yup.string().required().min(5)
  });

  try {
    await schema.validate({ email, password, name });
  } catch (err) {
    throw new AppError(err.message);
  }

  let resolvedPageAccess = null;
  if (profile !== "admin" && companyId !== undefined) {
    const companyModules = await ListCompanyModulesService(companyId);
    const moduleFlags = getModuleFlagsFromSlugs(companyModules);
    resolvedPageAccess = filterPageAccessForModules(
      sanitizePageAccess(pageAccessInput),
      moduleFlags
    );
  }

  const user = await User.create(
    {
      email,
      password,
      name,
      companyId,
      profile,
      whatsappId: whatsappId || null,
      allTicket,
      defaultRoute: defaultRoute || null,
      pageAccess: profile === "admin" ? null : resolvedPageAccess,
    },
    { include: ["queues", "company"] }
  );

  await user.$set("queues", queueIds);

  await user.reload();

  if (companyId !== undefined) {
    void CacheInvalidationService.onUserChanged(user.id, companyId);
  }

  const serializedUser = SerializeUser(user);

  return serializedUser;
};

export default CreateUserService;
