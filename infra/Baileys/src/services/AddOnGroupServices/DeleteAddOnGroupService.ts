import AddOnGroup from "../../models/AddOnGroup";
import AppError from "../../errors/AppError";

interface Request {
  addOnGroupId: number;
  companyId: number;
}

const DeleteAddOnGroupService = async ({
  addOnGroupId,
  companyId,
}: Request): Promise<void> => {
  const group = await AddOnGroup.findOne({
    where: { id: addOnGroupId, companyId },
  });
  if (!group) {
    throw new AppError("ERR_ADDON_GROUP_NOT_FOUND", 404);
  }
  await group.destroy();
};

export default DeleteAddOnGroupService;
