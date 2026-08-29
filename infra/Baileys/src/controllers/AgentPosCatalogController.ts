import { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrintDeviceAuthRequest } from "../middleware/isPrintDeviceAuth";
import BuildPosCatalogService from "../services/UniplusServices/BuildPosCatalogService";
import OcuparMesaService from "../services/MesaServices/OcuparMesaService";
import LiberarMesaService from "../services/MesaServices/LiberarMesaService";
import Mesa from "../models/Mesa";
import Contact from "../models/Contact";
import AppError from "../errors/AppError";
import { getIO } from "../libs/socket";

export const catalog = async (
  req: PrintDeviceAuthRequest,
  res: Response
): Promise<Response> => {
  const companyId = Number(req.companyId);
  const data = await BuildPosCatalogService({ companyId });
  return res.status(200).json(data);
};

export const ocupar = async (
  req: PrintDeviceAuthRequest,
  res: Response
): Promise<Response> => {
  const companyId = Number(req.companyId);
  const mesaId = Number(req.params.id);
  const customerName = String(req.body?.customerName || "").trim();
  if (!customerName) {
    throw new AppError("ERR_CONTACT_REQUIRED", 400);
  }

  const mesaEntity = await Mesa.findOne({
    where: { id: mesaId, companyId },
    attributes: ["id", "status"],
  });
  if (!mesaEntity) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  const created = await Contact.create({
    name: customerName,
    number: `SEMTELEFONE-${companyId}-${uuidv4()}`,
    email: "",
    companyId,
    userId: null,
    profilePicUrl: "",
    isGroup: false,
    disableBot: true,
  } as any);

  const mesa = await OcuparMesaService({
    mesaId,
    companyId,
    contactId: created.id,
    transferir: true,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "ocupar",
    mesa,
  });

  return res.status(200).json({
    id: mesa.id,
    status: mesa.status,
    contactName: customerName,
  });
};

export const liberar = async (
  req: PrintDeviceAuthRequest,
  res: Response
): Promise<Response> => {
  const companyId = Number(req.companyId);
  const mesaId = Number(req.params.id);
  const mesa = await LiberarMesaService({ mesaId, companyId });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "liberar",
    mesa,
  });

  return res.status(200).json({
    id: mesa.id,
    status: mesa.status,
  });
};
