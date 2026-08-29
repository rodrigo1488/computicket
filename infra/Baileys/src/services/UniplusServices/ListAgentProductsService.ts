import { Op } from "sequelize";
import Product from "../../models/Product";
import AddOnGroup from "../../models/AddOnGroup";
import AddOnSubgroup from "../../models/AddOnSubgroup";
import AddOnItem from "../../models/AddOnItem";

interface Request {
  companyId: number;
  q?: string;
  limit?: number;
}

export interface FlatAddOn {
  id: number;
  label: string;
  value: number;
  idUniplus: string | null;
  groupName: string;
  subgroupName: string | null;
}

export interface HierarchicalAddOnItem {
  id: number;
  label: string;
  value: number;
  idUniplus: string | null;
  subgroupName: string | null;
}

export interface HierarchicalAddOnGroup {
  id: number;
  name: string;
  items: HierarchicalAddOnItem[];
}

type AddOnItemLite = {
  id: number;
  label: string;
  value: number | string;
  idUniplus?: string | null;
  addOnSubgroupId?: number | null;
};
type AddOnSubgroupLite = { name: string; items?: AddOnItemLite[] | null };
type AddOnGroupLite = {
  id?: number;
  name: string;
  items?: AddOnItemLite[] | null;
  subgroups?: AddOnSubgroupLite[] | null;
};

function collectGroupItems(group: AddOnGroupLite): HierarchicalAddOnItem[] {
  const items: HierarchicalAddOnItem[] = [];

  // group.items (FK addOnGroupId) inclui TAMBÉM os itens que pertencem a um
  // subgrupo (addOnGroupId fica preenchido nos dois casos) — sem esse filtro
  // cada item de subgrupo apareceria duplicado.
  for (const item of group.items || []) {
    if (item.addOnSubgroupId) continue;
    items.push({
      id: item.id,
      label: item.label,
      value: Number(item.value),
      idUniplus: item.idUniplus || null,
      subgroupName: null,
    });
  }
  for (const subgroup of group.subgroups || []) {
    for (const item of subgroup.items || []) {
      items.push({
        id: item.id,
        label: item.label,
        value: Number(item.value),
        idUniplus: item.idUniplus || null,
        subgroupName: subgroup.name,
      });
    }
  }

  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}

/**
 * Achata grupos/subgrupos/itens de adicional numa lista única. Exposta pra
 * testes unitários (sem precisar mockar o Sequelize).
 */
export function flattenAddOnGroups(groups: AddOnGroupLite[]): FlatAddOn[] {
  const flat: FlatAddOn[] = [];

  for (const group of groups) {
    for (const item of collectGroupItems(group)) {
      flat.push({
        id: item.id,
        label: item.label,
        value: item.value,
        idUniplus: item.idUniplus,
        groupName: group.name,
        subgroupName: item.subgroupName,
      });
    }
  }

  // groupName primeiro pra Jinja groupby / selects por grupo ficarem contíguos
  flat.sort((a, b) => {
    const byGroup = a.groupName.localeCompare(b.groupName);
    if (byGroup !== 0) return byGroup;
    return a.label.localeCompare(b.label);
  });
  return flat;
}

/**
 * Monta grupos hierárquicos (id + name + items). Grupos sem itens entram
 * vazios — o agent precisa listá-los pra permitir criar item no grupo.
 */
export function structureAddOnGroups(
  groups: AddOnGroupLite[]
): HierarchicalAddOnGroup[] {
  return groups.map((group) => ({
    id: Number(group.id) || 0,
    name: group.name,
    items: collectGroupItems(group),
  }));
}

async function loadAddOnGroups(companyId: number): Promise<AddOnGroupLite[]> {
  const groups = await AddOnGroup.findAll({
    where: { companyId },
    attributes: ["id", "name", "companyId"],
    order: [["name", "ASC"]],
    include: [
      {
        model: AddOnSubgroup,
        as: "subgroups",
        attributes: ["id", "name"],
        include: [
          {
            model: AddOnItem,
            as: "items",
            attributes: [
              "id",
              "label",
              "value",
              "idUniplus",
              "addOnSubgroupId",
              "addOnGroupId",
            ],
          },
        ],
      },
      {
        model: AddOnItem,
        as: "items",
        attributes: [
          "id",
          "label",
          "value",
          "idUniplus",
          "addOnSubgroupId",
          "addOnGroupId",
        ],
      },
    ],
  });

  return groups as unknown as AddOnGroupLite[];
}

/**
 * Lista produtos Compuchat para o Print Agent escolher o pai de uma variação UniPlus,
 * e adicionais (AddOnItem) pra vincular como item próprio no pedido UniPlus.
 */
const ListAgentProductsService = async ({
  companyId,
  q,
  limit = 1000,
}: Request) => {
  const where: any = { companyId };
  const needle = String(q || "").trim();
  if (needle) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${needle}%` } },
      { idUniplus: { [Op.iLike]: `%${needle}%` } },
    ];
  }

  const products = await Product.findAll({
    where,
    attributes: ["id", "name", "value", "idUniplus", "grupo", "variablePrice"],
    include: [
      {
        association: "variations",
        attributes: ["id", "name"],
        include: [
          {
            association: "options",
            attributes: ["id", "label", "value", "idUniplus"],
          },
        ],
      },
    ],
    order: [["name", "ASC"]],
    limit: Math.min(Math.max(Number(limit) || 1000, 1), 1000),
  });

  const groups = await loadAddOnGroups(companyId);
  const addOns = flattenAddOnGroups(groups);
  const addOnGroups = structureAddOnGroups(groups);

  return {
    addOns,
    addOnGroups,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      value: Number(p.value),
      idUniplus: p.idUniplus || null,
      grupo: p.grupo || null,
      variablePrice: Boolean(p.variablePrice),
      variations: ((p as any).variations || []).map((v: any) => ({
        id: v.id,
        name: v.name,
        options: (v.options || []).map((o: any) => ({
          id: o.id,
          label: o.label,
          value: Number(o.value),
          idUniplus: o.idUniplus || null,
        })),
      })),
    })),
  };
};

export default ListAgentProductsService;
