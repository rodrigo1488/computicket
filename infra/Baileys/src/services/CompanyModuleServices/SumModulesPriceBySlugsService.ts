import { Op } from "sequelize";
import Module from "../../models/Module";

/**
 * Soma o preço (mensal) dos módulos pelos slugs informados.
 * Usado para compor o valor da assinatura Asaas (plano + módulos).
 */
const SumModulesPriceBySlugsService = async (
  slugs: string[]
): Promise<number> => {
  if (!Array.isArray(slugs) || slugs.length === 0) return 0;

  const uniqueSlugs = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))];
  if (uniqueSlugs.length === 0) return 0;

  const mods = await Module.findAll({
    where: { slug: { [Op.in]: uniqueSlugs }, isActive: true },
    attributes: ["price"],
  });

  return mods.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
};

export default SumModulesPriceBySlugsService;
