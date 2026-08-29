import { Request, Response } from "express";
import CreatePrintDeviceService from "../services/PrintDeviceService/CreatePrintDeviceService";
import ListPrintDevicesService from "../services/PrintDeviceService/ListPrintDevicesService";
import ShowPrintDeviceService from "../services/PrintDeviceService/ShowPrintDeviceService";
import UpdatePrintDeviceService from "../services/PrintDeviceService/UpdatePrintDeviceService";
import DeletePrintDeviceService from "../services/PrintDeviceService/DeletePrintDeviceService";
import RegenerateTokenService from "../services/PrintDeviceService/RegenerateTokenService";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const devices = await ListPrintDevicesService({ companyId });
  return res.json(devices);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { deviceId, name } = req.body;
  const device = await CreatePrintDeviceService({ companyId, deviceId, name });
  return res.status(201).json(device);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;
  const device = await ShowPrintDeviceService({
    companyId,
    id: Number(id)
  });
  return res.json(device);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { deviceId, name } = req.body;
  const device = await UpdatePrintDeviceService({
    companyId,
    id: Number(id),
    deviceId,
    name
  });
  return res.json(device);
};

export const destroy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;
  await DeletePrintDeviceService({ companyId, id: Number(id) });
  return res.status(204).send();
};

export const regenerateToken = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { id } = req.params;
  const device = await RegenerateTokenService({ companyId, id: Number(id) });
  return res.json(device);
};
