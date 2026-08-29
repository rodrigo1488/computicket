import * as Yup from "yup";
import { Request, Response } from "express";
import { Op } from "sequelize";
// import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";
import Company from "../models/Company";
import authConfig from "../config/auth";

import ListCompaniesService from "../services/CompanyService/ListCompaniesService";
import CreateCompanyService from "../services/CompanyService/CreateCompanyService";
import UpdateCompanyService from "../services/CompanyService/UpdateCompanyService";
import ShowCompanyService from "../services/CompanyService/ShowCompanyService";
import UpdateSchedulesService from "../services/CompanyService/UpdateSchedulesService";
import DeleteCompanyService from "../services/CompanyService/DeleteCompanyService";
import FindAllCompaniesService from "../services/CompanyService/FindAllCompaniesService";
import { verify } from "jsonwebtoken";
import User from "../models/User";
import ShowPlanCompanyService from "../services/CompanyService/ShowPlanCompanyService";
import ListCompaniesPlanService from "../services/CompanyService/ListCompaniesPlanService";
import { logger } from "../utils/logger";
import Plan from "../models/Plan";
import { hash } from "bcryptjs";
import moment from "moment";
import ListCompanyModulesService from "../services/CompanyModuleServices/ListCompanyModulesService";
import CompanyModule from "../models/CompanyModule";
import Module from "../models/Module";
import ApplyCompanyModulesBySlugsService from "../services/CompanyModuleServices/ApplyCompanyModulesBySlugsService";
import fs from "fs";
import path from "path";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

interface TokenPayload {
  id: string;
  username: string;
  profile: string;
  companyId: number;
  iat: number;
  exp: number;
}

type CompanyData = {
  name: string;
  id?: number;
  phone?: string;
  email?: string;
  status?: boolean;
  planId?: number;
  campaignsEnabled?: boolean;
  dueDate?: string;
  recurrence?: string;
  password: string;
};

type SchedulesData = {
  schedules: [];
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const { companies, count, hasMore } = await ListCompaniesService({
    searchParam,
    pageNumber
  });

  return res.json({ companies, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const newCompany: CompanyData = req.body;

  const schema = Yup.object().shape({
    name: Yup.string().required()
  });

  try {
    await schema.validate(newCompany);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const company = await CreateCompanyService(newCompany);

  return res.status(200).json(company);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const company = await ShowCompanyService(id);

  return res.status(200).json(company);
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const companies: Company[] = await FindAllCompaniesService();

  return res.status(200).json(companies);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyData: CompanyData = req.body;

  const schema = Yup.object().shape({
    name: Yup.string()
  });

  try {
    await schema.validate(companyData);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { id } = req.params;

  const company = await UpdateCompanyService({ id, ...companyData });

  return res.status(200).json(company);
};

export const updateSchedules = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { schedules }: SchedulesData = req.body;
  const { id } = req.params;

  const company = await UpdateSchedulesService({
    id,
    schedules
  });

  return res.status(200).json(company);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  const company = await DeleteCompanyService(id);

  return res.status(200).json(company);
};

let listPlanRequestCount = 0;
const LIST_PLAN_LOG = path.join(process.cwd(), "listPlan-requests.log");

export const listPlan = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  listPlanRequestCount += 1;
  const entry = {
    ts: new Date().toISOString(),
    companyId: id,
    requestNumber: listPlanRequestCount,
  };
  logger.warn({ msg: "listPlan request", ...entry });
  try {
    fs.appendFileSync(LIST_PLAN_LOG, JSON.stringify(entry) + "\n");
  } catch (_) {}

  const authHeader = req.headers.authorization;
  const [, token] = authHeader.split(" ");
  const decoded = verify(token, authConfig.secret);
  const { id: requestUserId, profile, companyId } = decoded as TokenPayload;
  const requestUser = await User.findByPk(requestUserId);

  if (requestUser.super === true) {
    const company = await ShowPlanCompanyService(id);
    return res.status(200).json(company);
  } else if (companyId.toString() !== id) {
    return res.status(400).json({ error: "Você não possui permissão para acessar este recurso!" });
  } else {
    const company = await ShowPlanCompanyService(id);
    return res.status(200).json(company);
  }

};

export const indexPlan = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const authHeader = req.headers.authorization;
  const [, token] = authHeader.split(" ");
  const decoded = verify(token, authConfig.secret);
  const { id, profile, companyId } = decoded as TokenPayload;
  // const company = await Company.findByPk(companyId);
  const requestUser = await User.findByPk(id);

  if (requestUser.super === true) {
    const companies = await ListCompaniesPlanService();
    return res.json({ companies });
  } else {
    return res.status(400).json({ error: "Você não possui permissão para acessar este recurso!" });
  }

};

export const createFreeAccount = async (req: Request, res: Response): Promise<Response> => {
  logger.info("=== createFreeAccount chamado ===");
  logger.info("Body recebido:", {
    companyName: req.body.name,
    companyEmail: req.body.email,
    planId: req.body.planId,
  });

  const schema = Yup.object().shape({
    name: Yup.string().required("Nome da empresa é obrigatório"),
    email: Yup.string().email("Email inválido").required("Email é obrigatório"),
    phone: Yup.string().required("Telefone é obrigatório"),
    password: Yup.string().required("Senha é obrigatória"),
    planId: Yup.number().required("Plano é obrigatório"),
    modules: Yup.array().of(Yup.string()).optional(),
  });

  try {
    await schema.validate(req.body, { abortEarly: false });
    logger.info("✓ Validação do schema passou");
  } catch (err: any) {
    logger.error("✗ Erro na validação do schema:", {
      error: err.message,
      errors: err.inner,
    });

    if (err.inner && err.inner.length > 0) {
      const errors = err.inner.map((e: any) => `${e.path}: ${e.message}`).join(", ");
      logger.error("Erros detalhados:", errors);
      throw new AppError(`Erro de validação: ${errors}`, 400);
    }

    throw new AppError(err.message || "Erro de validação", 400);
  }

  try {
    // Buscar plano (pode ser qualquer plano - pago ou gratuito)
    // No fluxo gratuito, o usuário seleciona o plano que deseja usar após o período de teste
    const plan = await Plan.findByPk(req.body.planId);
    if (!plan) {
      throw new AppError("Plano não encontrado", 404);
    }

    // Criar empresa diretamente sem pagamento (período de teste de 7 dias)
    // O plano selecionado será associado à conta e será ativado após o período de teste
    const company = await CreateCompanyService({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      password: req.body.password,
      planId: req.body.planId,
      status: true, // Ativar imediatamente para período de teste
      dueDate: moment().add(7, "days").format(), // 7 dias grátis de teste
      recurrence: "MENSAL",
    });

    const moduleSlugs = Array.isArray(req.body.modules)
      ? req.body.modules.map((s: any) => String(s).trim()).filter(Boolean)
      : [];
    if (moduleSlugs.length > 0) {
      await ApplyCompanyModulesBySlugsService(company.id, moduleSlugs);
    }

    logger.info("✓ Conta gratuita criada com sucesso:", {
      companyId: company.id,
      companyName: company.name,
    });

    return res.status(200).json({
      success: true,
      company: {
        id: company.id,
        name: company.name,
        email: company.email,
      },
      message: "Conta criada com sucesso! Você pode fazer login agora.",
    });
  } catch (error: any) {
    logger.error("✗ Erro ao criar conta gratuita:", {
      error: error.message,
      companyName: req.body?.name,
      companyEmail: req.body?.email,
    });

    if (error instanceof AppError) {
      throw error;
    }

    const errorMessage = error.message || "Erro ao criar conta. Por favor, tente novamente.";
    throw new AppError(errorMessage, error.statusCode || 400);
  }
};

export const updateCompanyAutoRenew = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const schema = Yup.object().shape({
    autoRenew: Yup.boolean().required("autoRenew é obrigatório"),
  });

  try {
    await schema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    if (err.inner && err.inner.length > 0) {
      const errors = err.inner.map((e: any) => `${e.path}: ${e.message}`).join(", ");
      throw new AppError(`Erro de validação: ${errors}`, 400);
    }
    throw new AppError(err.message || "Erro de validação", 400);
  }

  try {
    const company = await Company.findByPk(id);

    if (!company) {
      throw new AppError("Empresa não encontrada", 404);
    }

    await company.update({
      autoRenew: req.body.autoRenew,
    });

    logger.info(`AutoRenew atualizado para empresa ${id}: ${req.body.autoRenew}`);

    return res.status(200).json({
      success: true,
      autoRenew: company.autoRenew,
      message: `Renovação automática ${req.body.autoRenew ? "ativada" : "desativada"} com sucesso`,
    });
  } catch (error: any) {
    logger.error("Erro ao atualizar autoRenew:", error);

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Erro ao atualizar renovação automática", 400);
  }
};

export const getCompanyByEmail = async (req: Request, res: Response): Promise<Response> => {
  const { email } = req.query;

  if (!email || typeof email !== "string") {
    throw new AppError("Email é obrigatório", 400);
  }

  try {
    const company = await Company.findOne({
      where: {
        email: email,
      },
      attributes: ["id", "name", "email", "status", "dueDate"],
    });

    if (!company) {
      return res.status(200).json({
        exists: false,
        message: "Empresa não encontrada",
      });
    }

    return res.status(200).json({
      exists: true,
      company: {
        id: company.id,
        name: company.name,
        email: company.email,
        status: company.status,
        dueDate: company.dueDate,
      },
    });
  } catch (error: any) {
    logger.error("Erro ao buscar empresa por email:", error);

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Erro ao buscar empresa", 400);
  }
};

/** GET /companies/:id/modules - Super admin: listar módulos da empresa */
export const getCompanyModules = async (req: Request, res: Response): Promise<Response> => {
  const companyId = Number(req.params.id);
  if (!companyId || isNaN(companyId)) {
    throw new AppError("ID da empresa inválido", 400);
  }
  const modules = await ListCompanyModulesService(companyId);
  return res.json({ modules });
};

/** PUT /companies/:id/modules - Super admin: definir módulos da empresa (slugs) */
export const updateCompanyModules = async (req: Request, res: Response): Promise<Response> => {
  const companyId = Number(req.params.id);
  const { modules } = req.body as { modules?: string[] };

  if (!companyId || isNaN(companyId)) {
    throw new AppError("ID da empresa inválido", 400);
  }

  const company = await Company.findByPk(companyId);
  if (!company) {
    throw new AppError("Empresa não encontrada", 404);
  }

  const slugs = Array.isArray(modules) ? modules : [];
  const activeModules = await Module.findAll({
    where: { slug: slugs, isActive: true },
    attributes: ["id", "slug"],
  });

  await CompanyModule.destroy({ where: { companyId } });

  for (const mod of activeModules) {
    await CompanyModule.create({ companyId, moduleId: mod.id });
  }

  const result = await ListCompanyModulesService(companyId);
  return res.json({ modules: result });
};