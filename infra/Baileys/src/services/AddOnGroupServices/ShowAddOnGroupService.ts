import AddOnGroup from "../../models/AddOnGroup";
import AddOnSubgroup from "../../models/AddOnSubgroup";
import AddOnItem from "../../models/AddOnItem";
import AppError from "../../errors/AppError";

interface Request {
  addOnGroupId: number;
  companyId: number;
}

const ShowAddOnGroupService = async ({
  addOnGroupId,
  companyId,
}: Request): Promise<AddOnGroup | null> => {
  const group = await AddOnGroup.findOne({
    where: { id: addOnGroupId, companyId },
    include: [
      {
        model: AddOnSubgroup,
        as: "subgroups",
        order: [["order", "ASC"]],
        include: [{ model: AddOnItem, as: "items", order: [["order", "ASC"]] }],
      },
      { model: AddOnItem, as: "items", order: [["order", "ASC"]] },
    ],
  });
  if (!group) {
    throw new AppError("ERR_ADDON_GROUP_NOT_FOUND", 404);
  }
  return group;
};

export default ShowAddOnGroupService;
