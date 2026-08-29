import PrintDevice from "../../models/PrintDevice";

interface Request {
  companyId: number;
}

const ListPrintDevicesService = async ({
  companyId
}: Request): Promise<PrintDevice[]> => {
  const devices = await PrintDevice.findAll({
    where: { companyId },
    order: [["createdAt", "DESC"]]
  });
  return devices;
};

export default ListPrintDevicesService;
