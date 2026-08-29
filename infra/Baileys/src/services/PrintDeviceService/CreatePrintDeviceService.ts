import crypto from "crypto";
import PrintDevice from "../../models/PrintDevice";
import AppError from "../../errors/AppError";
import Company from "../../models/Company";

interface Request {
  companyId: number;
  deviceId: string;
  name?: string;
}

const CreatePrintDeviceService = async ({
  companyId,
  deviceId,
  name
}: Request): Promise<PrintDevice> => {
  const company = await Company.findByPk(companyId);
  if (!company) {
    throw new AppError("ERR_COMPANY_NOT_FOUND", 404);
  }

  const existing = await PrintDevice.findOne({
    where: { companyId, deviceId }
  });
  if (existing) {
    throw new AppError("ERR_DEVICE_ALREADY_EXISTS", 400);
  }

  const token = crypto.randomBytes(32).toString("hex");

  const printDevice = await PrintDevice.create({
    companyId,
    deviceId: deviceId.trim(),
    token,
    name: name?.trim() || deviceId
  });

  return printDevice;
};

export default CreatePrintDeviceService;
