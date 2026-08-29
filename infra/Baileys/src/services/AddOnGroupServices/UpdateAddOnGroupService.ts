import AddOnGroup from "../../models/AddOnGroup";
import AddOnSubgroup from "../../models/AddOnSubgroup";
import AddOnItem from "../../models/AddOnItem";
import AppError from "../../errors/AppError";
import sequelize from "../../database";
import {
  AddOnItemInput,
  AddOnSubgroupInput,
  normalizeMinMax,
} from "./CreateAddOnGroupService";

interface Request {
  addOnGroupId: number;
  companyId: number;
  name?: string;
  subgroups?: AddOnSubgroupInput[];
  items?: AddOnItemInput[];
  required?: boolean;
  minItems?: number;
  maxItems?: number | null;
}

const UpdateAddOnGroupService = async ({
  addOnGroupId,
  companyId,
  name,
  subgroups = [],
  items = [],
  required,
  minItems,
  maxItems,
}: Request): Promise<AddOnGroup> => {
  const group = await AddOnGroup.findOne({
    where: { id: addOnGroupId, companyId },
  });
  if (!group) {
    throw new AppError("ERR_ADDON_GROUP_NOT_FOUND", 404);
  }

  const t = await sequelize.transaction();
  try {
    const groupRules = normalizeMinMax({ required, minItems, maxItems });
    await group.update(
      {
        ...(name != null && name.trim() !== "" && { name: name.trim() }),
        ...groupRules,
      } as any,
      { transaction: t }
    );

    await AddOnItem.destroy({
      where: { addOnGroupId: group.id },
      transaction: t,
    });
    await AddOnSubgroup.destroy({
      where: { addOnGroupId: group.id },
      transaction: t,
    });

    for (let i = 0; i < subgroups.length; i++) {
      const sg = subgroups[i];
      const sgRules = normalizeMinMax(sg);
      const subgroup = await AddOnSubgroup.create(
        {
          addOnGroupId: group.id,
          name: sg.name.trim(),
          order: sg.order ?? i,
          ...sgRules,
        } as any,
        { transaction: t }
      );
      for (let j = 0; j < (sg.items || []).length; j++) {
        const it = sg.items[j];
        if (!it.label || it.value == null || Number(it.value) < 0) continue;
        await AddOnItem.create(
          {
            addOnGroupId: group.id,
            addOnSubgroupId: subgroup.id,
            label: it.label.trim(),
            value: Number(it.value),
            order: it.order ?? j,
          },
          { transaction: t }
        );
      }
    }

    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      if (!it.label || it.value == null || Number(it.value) < 0) continue;
      await AddOnItem.create(
        {
          addOnGroupId: group.id,
          addOnSubgroupId: null,
          label: it.label.trim(),
          value: Number(it.value),
          order: it.order ?? j,
        },
        { transaction: t }
      );
    }

    await t.commit();
    const updated = await AddOnGroup.findByPk(group.id, {
      include: [
        { model: AddOnSubgroup, as: "subgroups", include: [{ model: AddOnItem, as: "items" }] },
        { model: AddOnItem, as: "items" },
      ],
    });
    return updated!;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export default UpdateAddOnGroupService;
