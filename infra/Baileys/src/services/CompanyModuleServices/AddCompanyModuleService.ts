import CompanyModule from "../../models/CompanyModule";
import Module from "../../models/Module";
import ListCompanyModulesService from "./ListCompanyModulesService";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

/**
 * Adiciona um módulo à empresa pelo slug.
 */
const AddCompanyModuleService = async (
  companyId: number,
  moduleSlug: string
): Promise<string[]> => {
  const module = await Module.findOne({
    where: { slug: moduleSlug, isActive: true },
  });
  if (!module) return ListCompanyModulesService(companyId);

  const existing = await CompanyModule.findOne({
    where: { companyId, moduleId: module.id },
  });
  if (existing) return ListCompanyModulesService(companyId);

  await CompanyModule.create({ companyId, moduleId: module.id });
  void CacheInvalidationService.onModuleChanged(companyId);
  return ListCompanyModulesService(companyId);
};

export default AddCompanyModuleService;
