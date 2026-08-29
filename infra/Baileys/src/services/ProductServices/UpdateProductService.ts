import Product from "../../models/Product";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import ProductComboItem from "../../models/ProductComboItem";
import AddOnGroup from "../../models/AddOnGroup";
import AppError from "../../errors/AppError";
import { ProductVariationInput } from "./CreateProductService";
import {
  ComboItemInput,
  syncProductComboItems,
  calcComboTotal,
  productDetailInclude,
} from "./SyncProductComboItems";

interface Request {
  productId: number;
  companyId: number;
  name?: string;
  description?: string;
  value?: number;
  quantity?: number;
  isMenuProduct?: boolean;
  variablePrice?: boolean;
  isCombo?: boolean;
  allowsHalfAndHalf?: boolean;
  halfAndHalfPriceRule?: string | null;
  halfAndHalfGrupo?: string | null;
  grupo?: string;
  imageUrl?: string;
  variations?: ProductVariationInput[];
  comboItems?: ComboItemInput[];
  addOnGroupId?: number | null;
  idUniplus?: string | null;
}

const UpdateProductService = async ({
  productId,
  companyId,
  name,
  description,
  value,
  quantity,
  isMenuProduct,
  variablePrice,
  isCombo,
  allowsHalfAndHalf,
  halfAndHalfPriceRule,
  halfAndHalfGrupo,
  grupo,
  imageUrl,
  variations,
  comboItems,
  addOnGroupId,
  idUniplus,
}: Request): Promise<Product> => {
  const product = await Product.findOne({
    where: { id: productId, companyId },
  });

  if (!product) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  if (name !== undefined) {
    if (!name || name.trim() === "") {
      throw new AppError("ERR_PRODUCT_NAME_REQUIRED", 400);
    }
    product.name = name.trim();
  }

  if (description !== undefined) {
    product.description = description?.trim() || null;
  }

  if (quantity !== undefined) {
    product.quantity = quantity;
  }

  if (isMenuProduct !== undefined) {
    product.isMenuProduct = isMenuProduct;
  }

  if (grupo !== undefined) {
    product.grupo = grupo?.trim() || null;
  }

  if (imageUrl !== undefined) {
    product.imageUrl = imageUrl?.trim() || null;
  }

  if (idUniplus !== undefined) {
    product.idUniplus = idUniplus?.trim() || null;
  }

  const wasCombo = product.isCombo === true;
  const nextIsCombo = isCombo !== undefined ? isCombo === true : wasCombo;

  if (isCombo !== undefined) {
    product.isCombo = nextIsCombo;
  }

  if (nextIsCombo) {
    product.variablePrice = false;
    product.allowsHalfAndHalf = false;
    product.halfAndHalfPriceRule = null;
    product.halfAndHalfGrupo = null;
    product.addOnGroupId = null;

    if (comboItems !== undefined) {
      const total = await syncProductComboItems(product.id, companyId, comboItems);
      product.value = total;
    } else if (!wasCombo) {
      throw new AppError("ERR_COMBO_ITEMS_REQUIRED", 400);
    } else {
      const existing = await ProductComboItem.findAll({
        where: { comboProductId: product.id },
      });
      product.value = calcComboTotal(
        existing.map((ci) => ({
          value: Number(ci.value),
          quantity: Number(ci.quantity) || 1,
        }))
      );
    }

    await ProductVariation.destroy({ where: { productId: product.id } });
  } else {
    if (variablePrice !== undefined) {
      product.variablePrice = variablePrice;
    }

    if (allowsHalfAndHalf !== undefined) {
      product.allowsHalfAndHalf = allowsHalfAndHalf;
    }

    if (halfAndHalfPriceRule !== undefined) {
      product.halfAndHalfPriceRule = halfAndHalfPriceRule?.trim() || null;
    }

    if (halfAndHalfGrupo !== undefined) {
      product.halfAndHalfGrupo = halfAndHalfGrupo?.trim() || null;
    }

    if (value !== undefined) {
      if (value === null || value < 0) {
        throw new AppError("ERR_PRODUCT_VALUE_INVALID", 400);
      }
      product.value = value;
    }

    if (addOnGroupId !== undefined) {
      if (addOnGroupId != null) {
        const addOnGroup = await AddOnGroup.findOne({
          where: { id: addOnGroupId, companyId },
        });
        if (!addOnGroup) {
          throw new AppError("ERR_ADDON_GROUP_NOT_FOUND", 404);
        }
      }
      product.addOnGroupId = addOnGroupId ?? null;
    }

    // saiu do modo combo: limpa integrantes
    if (isCombo === false) {
      await ProductComboItem.destroy({ where: { comboProductId: product.id } });
    }

    if (variations !== undefined) {
      await ProductVariation.destroy({ where: { productId: product.id } });

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
  }

  await product.save();

  const withDetails = await Product.findByPk(product.id, {
    include: productDetailInclude,
  });
  return withDetails ?? product;
};

export default UpdateProductService;
