import { Op } from "sequelize";
import Product from "../../models/Product";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import AddOnItem from "../../models/AddOnItem";
import AddOnGroup from "../../models/AddOnGroup";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

export interface ReleaseUniplusCodigoOptions {
  exceptProductId?: number;
  exceptOptionId?: number;
  exceptAddOnItemId?: number;
}

export interface ReleaseUniplusCodigoResult {
  removedProductId?: number;
  removedProductName?: string;
  removedProductValue?: number;
  clearedOptionIds: number[];
  /** Opção desvinculada (se houver) — útil pra reaproveitar label sugerida */
  clearedOptionLabel?: string;
  /** Adicional desvinculado (se houver) */
  clearedAddOnItemId?: number;
  clearedAddOnLabel?: string;
}

function suggestLabelFromName(name: string, fallback: string): string {
  const tokens = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const last = tokens[tokens.length - 1] || "";
  if (/^(p|m|g|gg|pp|xg|xp)$/i.test(last)) {
    return last.toUpperCase();
  }
  if (name.trim()) return name.trim().slice(0, 40);
  return fallback;
}

export async function findOptionByCodigo(
  companyId: number,
  codigo: string
): Promise<ProductVariationOption | null> {
  return ProductVariationOption.findOne({
    where: { idUniplus: codigo },
    include: [
      {
        model: ProductVariation,
        required: true,
        include: [
          {
            model: Product,
            required: true,
            where: { companyId },
            attributes: ["id", "companyId", "name"],
          },
        ],
      },
    ],
  });
}

export async function findAddOnByCodigo(
  companyId: number,
  codigo: string
): Promise<AddOnItem | null> {
  return AddOnItem.findOne({
    where: { idUniplus: codigo },
    include: [
      {
        model: AddOnGroup,
        required: true,
        where: { companyId },
        attributes: ["id", "companyId"],
      },
    ],
  });
}

/**
 * Libera um codigo UniPlus de qualquer vínculo anterior na company (Product
 * standalone ou ProductVariationOption), para poder ser reatribuído.
 *
 * - Options: apenas desvincula (idUniplus = null); não deleta a opção
 *   (label/valor continuam editáveis manualmente pelo usuário).
 * - Product standalone "folha" (sem variações com opções): destrói.
 * - Product standalone com variações próprias: lança ERR_UNIPLUS_ATTACH_NOT_LEAF
 *   (é um pai de verdade, não deve ser removido silenciosamente).
 */
export async function releaseUniplusCodigo(
  companyId: number,
  codigo: string,
  opts: ReleaseUniplusCodigoOptions = {}
): Promise<ReleaseUniplusCodigoResult> {
  const clearedOptionIds: number[] = [];
  let clearedOptionLabel: string | undefined;

  const existingOption = await findOptionByCodigo(companyId, codigo);
  if (existingOption && existingOption.id !== opts.exceptOptionId) {
    clearedOptionLabel = existingOption.label;
    existingOption.idUniplus = null;
    await existingOption.save();
    clearedOptionIds.push(existingOption.id);
    logger.info(
      `Uniplus release: desvinculado optionId=${existingOption.id} codigo=${codigo} companyId=${companyId}`
    );
  }

  let clearedAddOnItemId: number | undefined;
  let clearedAddOnLabel: string | undefined;

  const existingAddOn = await findAddOnByCodigo(companyId, codigo);
  if (existingAddOn && existingAddOn.id !== opts.exceptAddOnItemId) {
    clearedAddOnLabel = existingAddOn.label;
    existingAddOn.idUniplus = null;
    await existingAddOn.save();
    clearedAddOnItemId = existingAddOn.id;
    logger.info(
      `Uniplus release: desvinculado addOnItemId=${existingAddOn.id} codigo=${codigo} companyId=${companyId}`
    );
  }

  let removedProductId: number | undefined;
  let removedProductName: string | undefined;
  let removedProductValue: number | undefined;

  const standaloneWhere: any = { companyId, idUniplus: codigo };
  if (opts.exceptProductId) {
    standaloneWhere.id = { [Op.ne]: opts.exceptProductId };
  }
  const standalone = await Product.findOne({
    where: standaloneWhere,
    include: [
      { association: "variations", include: [{ association: "options" }] },
    ],
  });

  if (standalone) {
    const vars = (standalone as any).variations || [];
    const optionCount = vars.reduce(
      (n: number, v: any) => n + (v.options?.length || 0),
      0
    );
    if (optionCount > 0) {
      throw new AppError(
        "ERR_UNIPLUS_ATTACH_NOT_LEAF: produto com o codigo já tem variações; remova manualmente",
        409
      );
    }
    removedProductName = standalone.name;
    removedProductValue = Number.isFinite(Number(standalone.value))
      ? Math.round(Number(standalone.value) * 100) / 100
      : undefined;
    await standalone.destroy();
    removedProductId = standalone.id;
    logger.info(
      `Uniplus release: removido standalone productId=${standalone.id} codigo=${codigo} companyId=${companyId}`
    );
  }

  // Limpa qualquer outro Product da company com esse código (defensivo).
  await Product.update(
    { idUniplus: null },
    {
      where: {
        companyId,
        idUniplus: codigo,
        ...(opts.exceptProductId ? { id: { [Op.ne]: opts.exceptProductId } } : {}),
      },
    }
  );

  return {
    removedProductId,
    removedProductName,
    removedProductValue,
    clearedOptionIds,
    clearedOptionLabel,
    clearedAddOnItemId,
    clearedAddOnLabel,
  };
}

export { suggestLabelFromName };
