import Module from "../../models/Module";
import AppError from "../../errors/AppError";

interface Request {
  moduleId: number;
  name?: string;
  slug?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
}

const UpdateModuleService = async ({
  moduleId,
  name,
  slug,
  description,
  price,
  isActive,
}: Request): Promise<Module> => {
  const module = await Module.findByPk(moduleId);
  if (!module) {
    throw new AppError("ERR_MODULE_NOT_FOUND", 404);
  }

  if (slug !== undefined) {
    const normalized = slug
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const existing = await Module.findOne({
      where: { slug: normalized },
    });
    if (existing && existing.id !== moduleId) {
      throw new AppError("ERR_MODULE_SLUG_EXISTS", 400);
    }
    module.slug = normalized;
  }

  if (name !== undefined) module.name = name;
  if (description !== undefined) module.description = description;
  if (price !== undefined) module.price = price;
  if (isActive !== undefined) module.isActive = isActive;

  await module.save();
  return module;
};

export default UpdateModuleService;
