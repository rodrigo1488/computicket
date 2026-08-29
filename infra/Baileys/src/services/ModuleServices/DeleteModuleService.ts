import Module from "../../models/Module";
import CompanyModule from "../../models/CompanyModule";
import AppError from "../../errors/AppError";

const DeleteModuleService = async (moduleId: number): Promise<void> => {
  const module = await Module.findByPk(moduleId);
  if (!module) {
    throw new AppError("ERR_MODULE_NOT_FOUND", 404);
  }

  await CompanyModule.destroy({ where: { moduleId } });
  await module.destroy();
};

export default DeleteModuleService;
