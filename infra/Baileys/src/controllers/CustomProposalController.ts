import * as Yup from "yup";
import { Request, Response } from "express";
import CustomProposal from "../models/CustomProposal";
import AppError from "../errors/AppError";

interface StoreCustomProposalData {
  name: string;
  company: string;
  email: string;
  phone: string;
  users: number;
  collaborators: number;
  features: string[];
  message?: string;
  planId?: number;
}

const storeSchema = Yup.object().shape({
  name: Yup.string().required("Nome é obrigatório"),
  company: Yup.string().required("Empresa é obrigatória"),
  email: Yup.string().email("Email inválido").required("Email é obrigatório"),
  phone: Yup.string().required("Telefone é obrigatório"),
  users: Yup.number().min(1, "Quantidade de usuários deve ser maior que zero").required("Quantidade de usuários é obrigatória"),
  collaborators: Yup.number().min(1, "Quantidade de colaboradores deve ser maior que zero").required("Quantidade de colaboradores é obrigatória"),
  features: Yup.array().of(Yup.string()),
  message: Yup.string(),
  planId: Yup.number().nullable(),
});

export const store = async (req: Request, res: Response): Promise<Response> => {
  try {
    const data: StoreCustomProposalData = req.body;

    await storeSchema.validate(data, {
      abortEarly: false,
    });

    const customProposal = await CustomProposal.create({
      name: data.name,
      company: data.company,
      email: data.email,
      phone: data.phone,
      users: data.users,
      collaborators: data.collaborators,
      features: data.features || [],
      message: data.message || "",
      planId: data.planId || null,
    });

    return res.status(201).json(customProposal);
  } catch (err: any) {
    if (err instanceof Yup.ValidationError) {
      const errors = err.errors.map((error) => error);
      throw new AppError(errors.join(", "), 400);
    }
    throw new AppError(err.message || "Erro ao criar proposta personalizada", 500);
  }
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  // Esta rota pode ser protegida no futuro para admin ver todas as propostas
  const proposals = await CustomProposal.findAll({
    order: [["createdAt", "DESC"]],
  });

  return res.json(proposals);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const proposal = await CustomProposal.findByPk(id);

  if (!proposal) {
    throw new AppError("ERR_CUSTOM_PROPOSAL_NOT_FOUND", 404);
  }

  return res.json(proposal);
};
