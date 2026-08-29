import Product from "../../models/Product";
import ProductComboItem from "../../models/ProductComboItem";
import ProductVariationOption from "../../models/ProductVariationOption";
import ProductVariation from "../../models/ProductVariation";
import AppError from "../../errors/AppError";

export interface ComboItemInput {
  productId: number;
  value: number;
  quantity?: number;
  order?: number;
  variationOptionId?: number | null;
}

export const productDetailInclude = [
  { association: "variations" as const, include: [{ association: "options" as const }] },
  {
    association: "comboItems" as const,
    include: [
      {
        association: "product" as const,
        attributes: ["id", "name", "idUniplus", "value", "isCombo", "grupo"],
      },
      {
        association: "variationOption" as const,
        attributes: ["id", "label", "value", "idUniplus"],
      },
    ],
  },
];

export function calcComboTotal(
  items: Array<{ value: number; quantity?: number }>
): number {
  const total = items.reduce((sum, it) => {
    const v = Number(it.value) || 0;
    const q = Number(it.quantity) || 1;
    return sum + v * q;
  }, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Valida e recria os integrantes do combo.
 * Retorna o valor total do combo (soma value*quantity).
 */
export async function syncProductComboItems(
  comboProductId: number,
  companyId: number,
  comboItems: ComboItemInput[]
): Promise<number> {
  if (!Array.isArray(comboItems) || comboItems.length === 0) {
    throw new AppError("ERR_COMBO_ITEMS_REQUIRED", 400);
  }

  const seen = new Set<string>();
  const normalized: ComboItemInput[] = [];

  for (let i = 0; i < comboItems.length; i++) {
    const raw = comboItems[i];
    const productId = Number(raw.productId);
    const value = Number(raw.value);
    const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 1));
    const order = raw.order != null ? Number(raw.order) : i;
    const rawOpt = raw.variationOptionId;
    const variationOptionId =
      rawOpt != null && String(rawOpt).trim() !== ""
        ? Number(rawOpt)
        : null;

    if (!productId || Number.isNaN(productId)) {
      throw new AppError("ERR_COMBO_ITEM_PRODUCT_REQUIRED", 400);
    }
    if (productId === comboProductId) {
      throw new AppError("ERR_COMBO_CANNOT_INCLUDE_SELF", 400);
    }
    const key = `${productId}:${variationOptionId || 0}`;
    if (seen.has(key)) {
      throw new AppError("ERR_COMBO_DUPLICATE_ITEM", 400);
    }
    if (value == null || Number.isNaN(value) || value < 0) {
      throw new AppError("ERR_COMBO_ITEM_VALUE_INVALID", 400);
    }

    seen.add(key);
    normalized.push({
      productId,
      value,
      quantity,
      order,
      variationOptionId:
        variationOptionId && !Number.isNaN(variationOptionId)
          ? variationOptionId
          : null,
    });
  }

  const productIds = [...new Set(normalized.map((n) => n.productId))];
  const products = await Product.findAll({
    where: { id: productIds, companyId },
    attributes: ["id", "isCombo", "isMenuProduct"],
  });

  if (products.length !== productIds.length) {
    throw new AppError("ERR_COMBO_ITEM_PRODUCT_NOT_FOUND", 404);
  }

  for (const p of products) {
    if ((p as any).isCombo) {
      throw new AppError("ERR_COMBO_CANNOT_NEST", 400);
    }
  }

  const optionIds = normalized
    .map((n) => n.variationOptionId)
    .filter((id): id is number => id != null && id > 0);

  if (optionIds.length > 0) {
    const options = await ProductVariationOption.findAll({
      where: { id: optionIds },
      include: [
        {
          model: ProductVariation,
          as: "productVariation",
          attributes: ["id", "productId"],
          required: true,
        },
      ],
    });
    if (options.length !== new Set(optionIds).size) {
      throw new AppError("ERR_COMBO_ITEM_VARIATION_NOT_FOUND", 404);
    }
    for (const opt of options) {
      const parentProductId = (opt as any).productVariation?.productId;
      const item = normalized.find((n) => n.variationOptionId === opt.id);
      if (item && parentProductId && Number(parentProductId) !== Number(item.productId)) {
        throw new AppError("ERR_COMBO_ITEM_VARIATION_MISMATCH", 400);
      }
    }
  }

  await ProductComboItem.destroy({ where: { comboProductId } });

  for (const item of normalized) {
    await ProductComboItem.create({
      comboProductId,
      productId: item.productId,
      variationOptionId: item.variationOptionId ?? null,
      value: item.value,
      quantity: item.quantity ?? 1,
      order: item.order ?? 0,
    });
  }

  return calcComboTotal(normalized);
}
