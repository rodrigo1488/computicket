import Product from "../../models/Product";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import AddOnGroup from "../../models/AddOnGroup";
import AppError from "../../errors/AppError";
import {
  ComboItemInput,
  syncProductComboItems,
  productDetailInclude,
} from "./SyncProductComboItems";

export interface ProductVariationInput {
  name: string;
  options: Array<{ label: string; value: number; idUniplus?: string | null }>;
}

interface Request {
  name: string;
  description?: string;
  value: number;
  quantity?: number;
  isMenuProduct?: boolean;
  variablePrice?: boolean;
  isCombo?: boolean;
  grupo?: string;
  imageUrl?: string;
  companyId: number;
  allowsHalfAndHalf?: boolean;
  halfAndHalfPriceRule?: string | null;
  halfAndHalfGrupo?: string | null;
  variations?: ProductVariationInput[];
  comboItems?: ComboItemInput[];
  addOnGroupId?: number | null;
  idUniplus?: string | null;
}

const CreateProductService = async ({
  name,
  description,
  value,
  quantity = 0,
  isMenuProduct = false,
  variablePrice = false,
  isCombo = false,
  allowsHalfAndHalf = false,
  halfAndHalfPriceRule,
  halfAndHalfGrupo,
  grupo,
  imageUrl,
  companyId,
  variations = [],
  comboItems = [],
  addOnGroupId,
  idUniplus,
}: Request): Promise<Product> => {
  if (!name || name.trim() === "") {
    throw new AppError("ERR_PRODUCT_NAME_REQUIRED", 400);
  }

  const asCombo = isCombo === true;

  if (asCombo) {
    if (!Array.isArray(comboItems) || comboItems.length === 0) {
      throw new AppError("ERR_COMBO_ITEMS_REQUIRED", 400);
    }
  } else if (value === undefined || value === null || value < 0) {
    throw new AppError("ERR_PRODUCT_VALUE_INVALID", 400);
  }

  if (!asCombo && addOnGroupId != null) {
    const addOnGroup = await AddOnGroup.findOne({
      where: { id: addOnGroupId, companyId },
    });
    if (!addOnGroup) {
      throw new AppError("ERR_ADDON_GROUP_NOT_FOUND", 404);
    }
  }

  const productValue = asCombo ? 0 : value;

  const product = await Product.create({
    name: name.trim(),
    description: description?.trim() || null,
    value: productValue,
    quantity: quantity || 0,
    isMenuProduct: isMenuProduct || false,
    variablePrice: asCombo ? false : variablePrice || false,
    isCombo: asCombo,
    allowsHalfAndHalf: asCombo ? false : allowsHalfAndHalf || false,
    halfAndHalfPriceRule: asCombo ? null : halfAndHalfPriceRule?.trim() || null,
    halfAndHalfGrupo: asCombo ? null : halfAndHalfGrupo?.trim() || null,
    grupo: grupo?.trim() || null,
    imageUrl: imageUrl?.trim() || null,
    companyId,
    addOnGroupId: asCombo ? null : addOnGroupId ?? null,
    idUniplus: idUniplus?.trim() || null,
  });

  if (asCombo) {
    product.value = await syncProductComboItems(product.id, companyId, comboItems);
    await product.save();
  } else {
    for (const v of variations) {
      if (!v.name || !v.options || v.options.length === 0) continue;
      const variation = await ProductVariation.create({
        productId: product.id,
        name: v.name.trim(),
      });
      for (const opt of v.options) {
        if (opt.label == null || opt.label === "" || opt.value == null || Number(opt.value) < 0) continue;
        await ProductVariationOption.create({
          productVariationId: variation.id,
          label: String(opt.label).trim(),
          value: Number(opt.value),
          idUniplus: opt.idUniplus?.trim() || null,
        });
      }
    }
  }

  const withDetails = await Product.findByPk(product.id, {
    include: productDetailInclude,
  });
  return withDetails ?? product;
};

export default CreateProductService;
