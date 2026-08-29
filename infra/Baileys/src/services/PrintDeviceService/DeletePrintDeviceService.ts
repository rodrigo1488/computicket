import PrintDevice from "../../models/PrintDevice";
import AppError from "../../errors/AppError";

interface Request {
  companyId: number;
  id: number;
}

const DeletePrintDeviceService = async ({
  companyId,
  id
}: Request): Promise<void> => {
  const device = await PrintDevice.findOne({
    where: { id, companyId }
  });

  if (!device) {
    throw new AppError("ERR_PRINT_DEVICE_NOT_FOUND", 404);
  }

  await device.destroy();
};

export default DeletePrintDeviceService;
