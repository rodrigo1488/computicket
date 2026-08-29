import AddOnGroup from "../../models/AddOnGroup";
import AddOnSubgroup from "../../models/AddOnSubgroup";
import AddOnItem from "../../models/AddOnItem";

interface Request {
  companyId: number;
}

const ListAddOnGroupsService = async ({
  companyId,
}: Request): Promise<AddOnGroup[]> => {
  const groups = await AddOnGroup.findAll({
    where: { companyId },
    order: [["name", "ASC"]],
    include: [
      {
        model: AddOnSubgroup,
        as: "subgroups",
        order: [["order", "ASC"]],
        include: [
          {
            model: AddOnItem,
            as: "items",
            order: [["order", "ASC"]],
          },
        ],
      },
      {
        model: AddOnItem,
        as: "items",
        order: [["order", "ASC"]],
      },
    ],
  });
  return groups;
};

export default ListAddOnGroupsService;
