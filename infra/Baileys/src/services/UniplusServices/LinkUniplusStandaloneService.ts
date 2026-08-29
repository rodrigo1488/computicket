import Product from "../../models/Product";
import AppError from "../../errors/AppError";
import { releaseUniplusCodigo } from "./ReleaseUniplusCodigoService";

export interface LinkUniplusStandaloneRequest {
  companyId: number;
  codigo: string;
  nome: string;
  preco: number;
  grupo?: string | null;
  /** Se enviado, vincula a este produto existente em vez de criar um novo */
  productId?: number | null;
}

export interface LinkUniplusStandaloneResult {
  productId: number;
  action: "created" | "updated";
  removedProductId?: number;
}

/**
 * Vincula um codigo UniPlus a um Product avulso (novo ou existente),
 * definindo o grupo/categoria na hora. Libera o codigo de qualquer
 * vínculo anterior (option de variação ou outro Product) primeiro.
 */
const LinkUniplusStandaloneService = async ({
  companyId,
  codigo: rawCodigo,
  nome: rawNome,
  preco,
  grupo,
  productId,
}: LinkUniplusStandaloneRequest): Promise<LinkUniplusStandaloneResult> => {
  const codigo = String(rawCodigo || "").trim().slice(0, 20);
  if (!codigo) {
    throw new AppError("ERR_UNIPLUS_ATTACH_CODIGO_REQUIRED", 400);
  }
  const nome = String(rawNome || "").trim().slice(0, 255);
  if (!nome) {
    throw new AppError("ERR_PRODUCT_NAME_REQUIRED", 400);
  }
  const nextValue =
    Number.isFinite(Number(preco)) && Number(preco) >= 0
      ? Math.round(Number(preco) * 100) / 100
      : 0;
  const trimmedGrupo = grupo?.trim() || null;

  let target: Product | null = null;
  if (productId) {
    target = await Product.findOne({ where: { id: productId, companyId } });
    if (!target) {
      throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
    }
  }

  const released = await releaseUniplusCodigo(companyId, codigo, {
    exceptProductId: target?.id,
  });

  if (target) {
    target.name = nome;
    target.value = nextValue;
    if (trimmedGrupo) target.grupo = trimmedGrupo;
    target.idUniplus = codigo;
    await target.save();
    return {
      productId: target.id,
      action: "updated",
      removedProductId: released.removedProductId,
    };
  }

  const created = await Product.create({
    name: nome,
    description: null,
    value: nextValue,
    quantity: 0,
    isMenuProduct: true,
    variablePrice: false,
    allowsHalfAndHalf: false,
    halfAndHalfPriceRule: null,
    halfAndHalfGrupo: null,
    grupo: trimmedGrupo || "Outros",
    imageUrl: null,
    companyId,
    addOnGroupId: null,
    idUniplus: codigo,
  });

  return {
    productId: created.id,
    action: "created",
    removedProductId: released.removedProductId,
  };
};

export default LinkUniplusStandaloneService;
