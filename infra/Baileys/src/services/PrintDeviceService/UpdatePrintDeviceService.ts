import PrintDevice from "../../models/PrintDevice";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  id: number;
  deviceId?: string;
  name?: string;
}

const UpdatePrintDeviceService = async ({
  companyId,
  id,
  deviceId,
  name
}: Request): Promise<PrintDevice> => {
  const device = await PrintDevice.findOne({
    where: { id, companyId }
  });

  if (!device) {
    throw new AppError("ERR_PRINT_DEVICE_NOT_FOUND", 404);
  }

  if (deviceId !== undefined) {
    const existing = await PrintDevice.findOne({
      where: { companyId, deviceId: deviceId.trim() }
    });
    if (existing && existing.id !== id) {
      throw new AppError("ERR_DEVICE_ID_ALREADY_IN_USE", 400);
    }
    device.deviceId = deviceId.trim();
  }

  if (name !== undefined) {
    device.name = name.trim();
  }

  await device.save();
  return device;
};

export default UpdatePrintDeviceService;
