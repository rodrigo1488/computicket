import Product from "../../models/Product";
import AppError from "../../errors/AppError";

export interface CreateAgentParentProductRequest {
  companyId: number;
  nome: string;
  grupo?: string | null;
  preco: number;
}

export interface CreateAgentParentProductResult {
  productId: number;
}

/**
 * Cria um Product "pai" sem nenhum codigo UniPlus próprio — só existe pra
 * servir de pai de variação (ex.: transformar um cluster de tamanhos num
 * único produto com variação). Evita reproduzir o bug de um mesmo produto
 * acumular papel duplo (avulso + pai) que a UI já teve.
 */
const CreateAgentParentProductService = async ({
  companyId,
  nome: rawNome,
  grupo,
  preco,
}: CreateAgentParentProductRequest): Promise<CreateAgentParentProductResult> => {
  const nome = String(rawNome || "").trim().slice(0, 255);
  if (!nome) {
    throw new AppError("ERR_PRODUCT_NAME_REQUIRED", 400);
  }
  const nextValue =
    Number.isFinite(Number(preco)) && Number(preco) >= 0
      ? Math.round(Number(preco) * 100) / 100
      : 0;
  const trimmedGrupo = grupo?.trim() || "Outros";

  const created = await Product.create({
    name: nome,
    description: null,
    value: nextValue,
    quantity: 0,
    isMenuProduct: true,
    variablePrice: true,
    allowsHalfAndHalf: false,
    halfAndHalfPriceRule: null,
    halfAndHalfGrupo: null,
    grupo: trimmedGrupo,
    imageUrl: null,
    companyId,
    addOnGroupId: null,
    idUniplus: null,
  });

  return { productId: created.id };
};

export default CreateAgentParentProductService;
