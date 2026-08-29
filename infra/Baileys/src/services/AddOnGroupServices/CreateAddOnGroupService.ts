import AddOnGroup from "../../models/AddOnGroup";
import AddOnSubgroup from "../../models/AddOnSubgroup";
import AddOnItem from "../../models/AddOnItem";
import AppError from "../../errors/AppError";
import sequelize from "../../database";

export interface AddOnItemInput {
  label: string;
  value: number;
  order?: number;
}

export interface AddOnSubgroupInput {
  name: string;
  order?: number;
  required?: boolean;
  minItems?: number;
  maxItems?: number | null;
  items: AddOnItemInput[];
}

interface Request {
  companyId: number;
  name: string;
  subgroups?: AddOnSubgroupInput[];
  items?: AddOnItemInput[];
  required?: boolean;
  minItems?: number;
  maxItems?: number | null;
}

/** Normaliza min/max: required implica min>=1; max nulo = sem limite. */
export const normalizeMinMax = (input: {
  required?: boolean;
  minItems?: number;
  maxItems?: number | null;
}): { required: boolean; minItems: number; maxItems: number | null } => {
  const required = input.required === true;
  let minItems = Math.max(0, Number(input.minItems) || 0);
  if (required && minItems < 1) minItems = 1;
  let maxItems: number | null =
    input.maxItems == null || input.maxItems === ("" as any)
      ? null
      : Math.max(1, Number(input.maxItems) || 0) || null;
  if (maxItems != null && maxItems < minItems) maxItems = minItems;
  return { required, minItems, maxItems };
};

const CreateAddOnGroupService = async ({
  companyId,
  name,
  subgroups = [],
  items = [],
  required,
  minItems,
  maxItems,
}: Request): Promise<AddOnGroup> => {
  if (!name || !name.trim()) {
    throw new AppError("ERR_ADDON_GROUP_NAME_REQUIRED", 400);
  }

  const t = await sequelize.transaction();
  try {
    const groupRules = normalizeMinMax({ required, minItems, maxItems });
    const group = await AddOnGroup.create(
      { companyId, name: name.trim(), ...groupRules } as any,
      { transaction: t }
    );

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
    const created = await AddOnGroup.findByPk(group.id, {
      include: [
        { model: AddOnSubgroup, as: "subgroups", include: [{ model: AddOnItem, as: "items" }] },
        { model: AddOnItem, as: "items" },
      ],
    });
    return created!;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export default CreateAddOnGroupService;
