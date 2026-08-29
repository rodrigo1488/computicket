import Product from "../../models/Product";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import { Op } from "sequelize";
import { logger } from "../../utils/logger";

export interface UniplusProductUpsertItem {
  codigo: string;
  nome: string;
  preco: number;
}

export interface UniplusProductUpsertResult {
  codigo: string;
  action: "created" | "updated" | "skipped";
  productId?: number;
  optionId?: number;
  error?: string;
}

interface Request {
  companyId: number;
  products: UniplusProductUpsertItem[];
}

function normalizeName(name: string): string {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b\d+\s*ml\b/g, " ")
    .replace(/\b\d+\s*l\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function findOptionByCodigo(
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
            attributes: ["id", "companyId"],
          },
        ],
      },
    ],
  });
}

/**
 * Upsert UniPlus → Compuchat.
 * 0) se codigo já está em ProductVariationOption → atualiza option (não cria Product)
 * 1) por idUniplus (= codigo)
 * 2) por nome (atualiza produto do cardápio existente e grava o codigo)
 * 3) cria novo
 */
const UpsertUniplusProductsService = async ({
  companyId,
  products,
}: Request): Promise<{ results: UniplusProductUpsertResult[] }> => {
  const results: UniplusProductUpsertResult[] = [];
  const list = Array.isArray(products) ? products.slice(0, 100) : [];

  for (const raw of list) {
    const codigo = String(raw?.codigo || "").trim().slice(0, 20);
    const nome = String(raw?.nome || "").trim().slice(0, 255);
    const preco = Number(raw?.preco);

    if (!codigo) {
      results.push({
        codigo: String(raw?.codigo || ""),
        action: "skipped",
        error: "codigo ausente",
      });
      continue;
    }
    if (!nome) {
      results.push({
        codigo,
        action: "skipped",
        error: "nome ausente",
      });
      continue;
    }
    if (!Number.isFinite(preco) || preco < 0) {
      results.push({
        codigo,
        action: "skipped",
        error: "preco inválido",
      });
      continue;
    }

    try {
      const nextValue = Math.round(preco * 100) / 100;

      // 0) Já anexado como variação de um produto pai
      const asOption = await findOptionByCodigo(companyId, codigo);
      if (asOption) {
        let changed = false;
        if (Number(asOption.value) !== nextValue) {
          asOption.value = nextValue;
          changed = true;
        }
        if (changed) {
          await asOption.save();
        }
        const parentId = asOption.productVariation?.productId;
        results.push({
          codigo,
          action: "updated",
          productId: parentId,
          optionId: asOption.id,
        });
        continue;
      }

      let existing = await Product.findOne({
        where: { companyId, idUniplus: codigo },
      });

      // Vincula produto já cadastrado no cardápio (mesmo nome, sem codigo)
      if (!existing) {
        const candidates = await Product.findAll({
          where: {
            companyId,
            [Op.or]: [{ idUniplus: null }, { idUniplus: "" }],
          },
          attributes: ["id", "name", "value", "idUniplus"],
          limit: 500,
        });
        const needle = normalizeName(nome);
        let best: Product | null = null;
        let bestLen = -1;
        for (const p of candidates) {
          const pname = normalizeName(p.name || "");
          if (!pname) continue;
          if (pname === needle || needle.includes(pname) || pname.includes(needle)) {
            if (pname.length > bestLen) {
              best = p;
              bestLen = pname.length;
            }
          }
        }
        existing = best;
      }

      if (existing) {
        let changed = false;
        if (existing.name !== nome) {
          existing.name = nome;
          changed = true;
        }
        if (Number(existing.value) !== nextValue) {
          existing.value = nextValue;
          changed = true;
        }
        if (String(existing.idUniplus || "").trim() !== codigo) {
          existing.idUniplus = codigo;
          changed = true;
        }
        if (changed) {
          await existing.save();
        }
        results.push({
          codigo,
          action: "updated",
          productId: existing.id,
        });
      } else {
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
          grupo: "Outros",
          imageUrl: null,
          companyId,
          addOnGroupId: null,
          idUniplus: codigo,
        });
        results.push({
          codigo,
          action: "created",
          productId: created.id,
        });
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      logger.warn(
        `UpsertUniplusProducts codigo=${codigo} companyId=${companyId}: ${msg}`
      );
      results.push({
        codigo,
        action: "skipped",
        error: msg,
      });
    }
  }

  return { results };
};

export default UpsertUniplusProductsService;
