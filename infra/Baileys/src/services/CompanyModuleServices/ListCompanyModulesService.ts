import CompanyModule from "../../models/CompanyModule";
import Module from "../../models/Module";
import { appCache, CACHE_TTL } from "../../libs/appCache";

/**
 * Lista os slugs dos módulos ativos da empresa.
 */
const ListCompanyModulesService = async (
  companyId: number
): Promise<string[]> => {
  const cacheKey = appCache.buildKey("modules", companyId, "list");

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.modules,
    async () => {
      const companyModules = await CompanyModule.findAll({
        where: { companyId },
        include: [
          {
            model: Module,
            as: "module",
            where: { isActive: true },
            required: true
          }
        ]
      });

      return companyModules
        .map(cm => (cm.module as Module)?.slug)
        .filter(Boolean);
    },
    "modules"
  );

  return value;
};

export default ListCompanyModulesService;
