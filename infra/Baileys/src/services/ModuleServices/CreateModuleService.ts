import Module from "../../models/Module";
import AppError from "../../errors/AppError";

interface Request {
  name: string;
  slug: string;
  description?: string;
  price?: number;
  isActive?: boolean;
}

const CreateModuleService = async (data: Request): Promise<Module> => {
  const slug = (data.slug || data.name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const existing = await Module.findOne({ where: { slug } });
  if (existing) {
    throw new AppError("ERR_MODULE_SLUG_EXISTS", 400);
  }

  return Module.create({
    name: data.name,
    slug,
    description: data.description || "",
    price: data.price ?? 0,
    isActive: data.isActive !== false,
  });
};

export default CreateModuleService;
