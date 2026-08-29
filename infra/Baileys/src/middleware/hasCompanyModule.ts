import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import HasCompanyModuleService from "../services/CompanyModuleServices/HasCompanyModuleService";

/**
 * Middleware que exige que a empresa do usuário tenha o módulo informado.
 */
const hasCompanyModule = (moduleName: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { companyId } = req.user;
    const hasModule = await HasCompanyModuleService(companyId, moduleName);
    if (!hasModule) {
      throw new AppError("ERR_MODULE_LANCHONETES_REQUIRED", 403);
    }
    next();
  };
};

export default hasCompanyModule;
