import Product from "../../models/Product";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import ProductComboItem from "../../models/ProductComboItem";
import AppError from "../../errors/AppError";
import { productDetailInclude } from "./SyncProductComboItems";

interface Request {
  productId: number;
  companyId: number;
}

const DuplicateProductService = async ({ productId, companyId }: Request): Promise<Product> => {
  const originalProduct = await Product.findByPk(productId, {
    include: productDetailInclude,
  });

  if (!originalProduct) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  if (originalProduct.companyId !== companyId) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  const newProduct = await Product.create({
    name: `${originalProduct.name} (Cópia)`,
    description: originalProduct.description,
    value: originalProduct.value,
    quantity: originalProduct.quantity || 0,
    isMenuProduct: originalProduct.isMenuProduct,
    variablePrice: originalProduct.variablePrice,
    isCombo: originalProduct.isCombo || false,
    allowsHalfAndHalf: originalProduct.allowsHalfAndHalf,
    halfAndHalfPriceRule: originalProduct.halfAndHalfPriceRule,
    halfAndHalfGrupo: originalProduct.halfAndHalfGrupo,
    grupo: originalProduct.grupo,
    imageUrl: originalProduct.imageUrl,
    addOnGroupId: originalProduct.isCombo ? null : (originalProduct as any).addOnGroupId ?? null,
    idUniplus: originalProduct.idUniplus ?? null,
    companyId: companyId,
  });

  if (originalProduct.isCombo && originalProduct.comboItems?.length) {
    for (const ci of originalProduct.comboItems) {
      await ProductComboItem.create({
        comboProductId: newProduct.id,
        productId: ci.productId,
        value: Number(ci.value),
        quantity: Number(ci.quantity) || 1,
        order: Number(ci.order) || 0,
      });
    }
  } else if (originalProduct.variations && originalProduct.variations.length > 0) {
    for (const variation of originalProduct.variations) {
      const newVariation = await ProductVariation.create({
        productId: newProduct.id,
        name: variation.name,
      });

      if (variation.options && variation.options.length > 0) {
        for (const option of variation.options) {
          await ProductVariationOption.create({
            productVariationId: newVariation.id,
            label: option.label,
            value: option.value,
            idUniplus: (option as any).idUniplus ?? null,
          });
        }
      }
    }
  }

  const productWithDetails = await Product.findByPk(newProduct.id, {
    include: productDetailInclude,
  });

  return productWithDetails ?? newProduct;
};

export default DuplicateProductService;
