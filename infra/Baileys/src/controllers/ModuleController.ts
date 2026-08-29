import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import ListModulesService from "../services/ModuleServices/ListModulesService";
import CreateModuleService from "../services/ModuleServices/CreateModuleService";
import UpdateModuleService from "../services/ModuleServices/UpdateModuleService";
import DeleteModuleService from "../services/ModuleServices/DeleteModuleService";
import Module from "../models/Module";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const result = await ListModulesService();
  return res.json(result);
};

export const available = async (req: Request, res: Response): Promise<Response> => {
  const modules = await Module.findAll({
    where: { isActive: true },
    order: [["name", "ASC"]],
    attributes: ["id", "name", "slug", "description", "price"],
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

export const store = async (req: Request, res: Response): Promise<Response> => {
  const schema = Yup.object().shape({
    name: Yup.string().required("Nome é obrigatório"),
    slug: Yup.string(),
    description: Yup.string(),
    price: Yup.number().min(0),
    isActive: Yup.boolean(),
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const module = await CreateModuleService(req.body);
  return res.status(201).json(module);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const moduleId = Number(req.params.id);
  if (!moduleId || isNaN(moduleId)) {
    throw new AppError("ID inválido", 400);
  }

  const schema = Yup.object().shape({
    name: Yup.string(),
    slug: Yup.string(),
    description: Yup.string(),
    price: Yup.number().min(0),
    isActive: Yup.boolean(),
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const module = await UpdateModuleService({ moduleId, ...req.body });
  return res.json(module);
};

export const destroy = async (req: Request, res: Response): Promise<Response> => {
  const moduleId = Number(req.params.id);
  if (!moduleId || isNaN(moduleId)) {
    throw new AppError("ID inválido", 400);
  }

  await DeleteModuleService(moduleId);
  return res.json({ message: "Módulo excluído com sucesso" });
};
