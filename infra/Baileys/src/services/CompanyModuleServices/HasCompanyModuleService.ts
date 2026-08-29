import CompanyModule from "../../models/CompanyModule";
import Module from "../../models/Module";
import ListCompanyModulesService from "./ListCompanyModulesService";
import { appCache, CACHE_TTL } from "../../libs/appCache";

/** Slug do módulo de lanchonetes (mantido para compatibilidade) */
export const MODULE_LANCHONETES = "lanchonetes";

/**
 * Verifica se a empresa possui um módulo ativo.
 * @param companyId ID da empresa
 * @param moduleSlug Slug do módulo (ex: "lanchonetes") ou nome para fallback
 */
const HasCompanyModuleService = async (
  companyId: number,
  moduleSlug: string
): Promise<boolean> => {
  const cacheKey = appCache.buildKey("modules", companyId, `module:${moduleSlug}`);

  const { value } = await appCache.getOrSet(
    cacheKey,
    CACHE_TTL.modules,
    async () => {
      const module = await Module.findOne({
        where: { slug: moduleSlug, isActive: true }
      });
      if (!module) return false;

      const companyModule = await CompanyModule.findOne({
        where: { companyId, moduleId: module.id }
      });
      return !!companyModule;
    },
    "modules"
  );

  return value;
};

export default HasCompanyModuleService;
