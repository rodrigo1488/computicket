import CompanyModule from "../../models/CompanyModule";
import Module from "../../models/Module";
import ListCompanyModulesService from "./ListCompanyModulesService";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

/**
 * Remove um módulo da empresa pelo slug.
 */
const RemoveCompanyModuleService = async (
  companyId: number,
  moduleSlug: string
): Promise<string[]> => {
  const module = await Module.findOne({
    where: { slug: moduleSlug },
  });
  if (!module) return ListCompanyModulesService(companyId);

  await CompanyModule.destroy({
    where: { companyId, moduleId: module.id },
  });
  void CacheInvalidationService.onModuleChanged(companyId);
  return ListCompanyModulesService(companyId);
};

export default RemoveCompanyModuleService;
