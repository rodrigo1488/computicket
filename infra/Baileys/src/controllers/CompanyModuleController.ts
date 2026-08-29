import { Request, Response } from "express";
import AppError from "../errors/AppError";
import Module from "../models/Module";
import ListCompanyModulesService from "../services/CompanyModuleServices/ListCompanyModulesService";
import AddCompanyModuleService from "../services/CompanyModuleServices/AddCompanyModuleService";
import RemoveCompanyModuleService from "../services/CompanyModuleServices/RemoveCompanyModuleService";

/**
 * GET /company/modules
 * Lista os módulos ativos da empresa do usuário logado.
 */
export const list = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const modules = await ListCompanyModulesService(companyId);
  return res.json({ modules });
};

/**
 * POST /company/modules/:moduleName
 * Adiciona um módulo à empresa pelo slug.
 */
export const add = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { moduleName } = req.params;

  if (!moduleName) {
    throw new AppError("ERR_MODULE_INVALID", 400);
  }

  const moduleExists = await Module.findOne({ where: { slug: moduleName, isActive: true } });
  if (!moduleExists) {
    throw new AppError("ERR_MODULE_INVALID", 400);
  }

  const modules = await AddCompanyModuleService(companyId, moduleName);
  return res.json({ modules });
};

/**
 * DELETE /company/modules/:moduleName
 * Remove um módulo da empresa.
 */
export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { moduleName } = req.params;

  if (!moduleName) {
    throw new AppError("ERR_MODULE_INVALID", 400);
  }

  const modules = await RemoveCompanyModuleService(companyId, moduleName);
  return res.json({ modules });
};

/**
 * GET /company/modules/available
 * Lista módulos disponíveis para contratação (da tabela Modules).
 */
export const available = async (req: Request, res: Response): Promise<Response> => {
  const modules = await Module.findAll({
    where: { isActive: true },
    order: [["name", "ASC"]],
  });
  return res.json({
    modules: modules.map((m) => ({
      id: m.slug,
      name: m.name,
      description: m.description,
      price: m.price,
    })),
  });
};
