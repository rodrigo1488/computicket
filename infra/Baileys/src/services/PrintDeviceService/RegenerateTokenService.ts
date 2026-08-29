import crypto from "crypto";
import PrintDevice from "../../models/PrintDevice";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  id: number;
}

const RegenerateTokenService = async ({
  companyId,
  id
}: Request): Promise<PrintDevice> => {
  const device = await PrintDevice.findOne({
    where: { id, companyId }
  });

  if (!device) {
    throw new AppError("ERR_PRINT_DEVICE_NOT_FOUND", 404);
  }

  device.token = crypto.randomBytes(32).toString("hex");
  await device.save();

  return device;
};

export default RegenerateTokenService;
