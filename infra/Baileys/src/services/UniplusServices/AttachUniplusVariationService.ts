import Product from "../../models/Product";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import AppError from "../../errors/AppError";
import {
  releaseUniplusCodigo,
  findOptionByCodigo,
  suggestLabelFromName,
} from "./ReleaseUniplusCodigoService";

export interface AttachUniplusVariationRequest {
  companyId: number;
  codigo: string;
  parentProductId: number;
  variationName?: string;
  optionLabel?: string;
  preco?: number;
  /** Se enviado, atualiza o grupo/categoria do produto pai junto (corrige "Outros") */
  parentGrupo?: string;
}

export interface AttachUniplusVariationResult {
  parentProductId: number;
  variationId: number;
  optionId: number;
  removedProductId?: number;
}

/**
 * Anexa um codigo UniPlus como opção de variação de um Product pai.
 * Remove o Product standalone com o mesmo codigo (folha sync), se existir,
 * e desvincula de qualquer outra opção que já o usasse.
 */
const AttachUniplusVariationService = async ({
  companyId,
  codigo: rawCodigo,
  parentProductId,
  variationName: rawVariationName,
  optionLabel: rawOptionLabel,
  preco,
  parentGrupo,
}: AttachUniplusVariationRequest): Promise<AttachUniplusVariationResult> => {
  const codigo = String(rawCodigo || "").trim().slice(0, 20);
  if (!codigo) {
    throw new AppError("ERR_UNIPLUS_ATTACH_CODIGO_REQUIRED", 400);
  }

  const parent = await Product.findOne({
    where: { id: parentProductId, companyId },
    include: [
      { association: "variations", include: [{ association: "options" }] },
    ],
  });
  if (!parent) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  const variationName =
    String(rawVariationName || "Tamanho").trim() || "Tamanho";
  let optionLabel = String(rawOptionLabel || "").trim();

  const nextValue =
    preco != null && Number.isFinite(Number(preco)) && Number(preco) >= 0
      ? Math.round(Number(preco) * 100) / 100
      : null;

  // Se o código já está numa opção de OUTRO pai, bloqueia com erro amigável
  // (o Print Agent resolve o nome do produto conflitante a partir do id).
  const existingOption = await findOptionByCodigo(companyId, codigo);
  if (
    existingOption?.productVariation &&
    existingOption.productVariation.productId !== parent.id
  ) {
    throw new AppError(
      `ERR_UNIPLUS_CODIGO_IN_OTHER_OPTION:${existingOption.productVariation.productId}`,
      409
    );
  }

  const released = await releaseUniplusCodigo(companyId, codigo, {
    exceptProductId: parent.id,
    exceptOptionId: existingOption?.id,
  });

  if (released.removedProductId && !optionLabel) {
    optionLabel = suggestLabelFromName(released.removedProductName || "", codigo);
  }
  if (!optionLabel) {
    optionLabel = codigo;
  }

  let variation =
    ((parent as any).variations || []).find(
      (v: ProductVariation) =>
        String(v.name || "").trim().toLowerCase() ===
        variationName.toLowerCase()
    ) || null;

  if (!variation) {
    variation = await ProductVariation.create({
      productId: parent.id,
      name: variationName,
    });
  }

  const optionValue =
    nextValue != null
      ? nextValue
      : released.removedProductValue
        ? released.removedProductValue
        : Number(parent.value) || 0;

  let option =
    (await ProductVariationOption.findOne({
      where: { productVariationId: variation.id, idUniplus: codigo },
    })) ||
    (await ProductVariationOption.findOne({
      where: { productVariationId: variation.id, label: optionLabel },
    }));

  if (option) {
    option.label = optionLabel;
    option.value = optionValue;
    option.idUniplus = codigo;
    await option.save();
  } else {
    option = await ProductVariationOption.create({
      productVariationId: variation.id,
      label: optionLabel,
      value: optionValue,
      idUniplus: codigo,
    });
  }

  let parentChanged = false;
  if (!parent.variablePrice) {
    parent.variablePrice = true;
    parentChanged = true;
  }
  const trimmedGrupo = parentGrupo?.trim();
  if (trimmedGrupo && trimmedGrupo !== parent.grupo) {
    parent.grupo = trimmedGrupo;
    parentChanged = true;
  }
  if (parentChanged) {
    await parent.save();
  }

  return {
    parentProductId: parent.id,
    variationId: variation.id,
    optionId: option.id,
    removedProductId: released.removedProductId,
  };
};

export default AttachUniplusVariationService;
