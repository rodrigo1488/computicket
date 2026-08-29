import { Request, Response } from "express";
import * as Yup from "yup";
import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";
import ListService from "../services/AppointmentServiceServices/ListService";
import CreateService from "../services/AppointmentServiceServices/CreateService";
import UpdateService from "../services/AppointmentServiceServices/UpdateService";
import ShowService from "../services/AppointmentServiceServices/ShowService";
import DeleteService from "../services/AppointmentServiceServices/DeleteService";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { userId, isActive } = req.query;

  const list = await ListService({
    companyId,
    userId: userId != null ? Number(userId) : undefined,
    isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
  });

  return res.json(list);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    userId: Yup.number().required("Profissional é obrigatório"),
    name: Yup.string().required("Nome do serviço é obrigatório"),
    durationMinutes: Yup.number().required("Duração é obrigatória").min(1),
    value: Yup.number().nullable(),
    description: Yup.string().nullable(),
    isActive: Yup.boolean().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const service = await CreateService({
    companyId,
    userId: data.userId,
    name: data.name,
    durationMinutes: data.durationMinutes,
    value: data.value,
    description: data.description,
    isActive: data.isActive,
    displayOrder: data.displayOrder,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-appointment-service`, {
    action: "create",
    service,
  });

  return res.status(200).json(service);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;

  const service = await ShowService({
    appointmentServiceId: Number(id),
    companyId,
  });

  return res.json(service);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;
  const data = req.body;

  const schema = Yup.object().shape({
    userId: Yup.number().nullable(),
    name: Yup.string().nullable(),
    durationMinutes: Yup.number().min(1).nullable(),
    value: Yup.number().nullable(),
    description: Yup.string().nullable(),
    isActive: Yup.boolean().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const service = await UpdateService({
    appointmentServiceId: Number(id),
    companyId,
    ...data,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-appointment-service`, {
    action: "update",
    service,
  });

  return res.status(200).json(service);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;

  await DeleteService({
    appointmentServiceId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-appointment-service`, {
    action: "delete",
    appointmentServiceId: Number(id),
  });

  return res.status(200).json({ message: "Serviço removido com sucesso" });
};
