import { Op } from "sequelize";
import CompanyModule from "../../models/CompanyModule";
import Module from "../../models/Module";

/**
 * Define os módulos da empresa a partir de uma lista de slugs.
 * Remove vínculos anteriores e cria apenas os módulos ativos informados.
 */
const ApplyCompanyModulesBySlugsService = async (
  companyId: number,
  slugs: string[]
): Promise<void> => {
  if (!companyId || !Array.isArray(slugs) || slugs.length === 0) {
    return;
  }

  const uniqueSlugs = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))];
  if (uniqueSlugs.length === 0) return;

  const activeModules = await Module.findAll({
    where: { slug: { [Op.in]: uniqueSlugs }, isActive: true },
    attributes: ["id", "slug"],
  });

  await CompanyModule.destroy({ where: { companyId } });

  for (const mod of activeModules) {
    await CompanyModule.create({ companyId, moduleId: mod.id });
  }
};

export default ApplyCompanyModulesBySlugsService;
