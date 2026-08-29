import { Op } from "sequelize";
import FormResponse from "../../models/FormResponse";
import GourmetFinanceiro from "../../models/GourmetFinanceiro";

export interface ProdutoRelatório {
  productName: string;
  quantity: number;
  unitValue: number;
  total: number;
}

export interface RelatorioProdutosResult {
  produtos: ProdutoRelatório[];
  totalGeral: number;
  totalItens: number;
  startDate: string;
  endDate: string;
}

interface Params {
  companyId: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

/** Acumula itens de uma lista no map de agregação. */
function acumularItens(
  map: Map<string, { qty: number; unitValue: number }>,
  items: any[]
) {
  for (const item of items) {
    const name = (item.productName || item.name || "Item").trim();
    const qty = Number(item.quantity) || 0;
    const pv = Number(item.productValue) || 0;
    const at = Number(item.addonsTotal) || 0;
    const unit = Math.round((pv + at) * 100) / 100;

    if (qty <= 0) continue;

    const existing = map.get(name);
    if (existing) {
      existing.qty += qty;
    } else {
      map.set(name, { qty, unitValue: unit });
    }
  }
}

/**
 * Agrega os produtos vendidos no período considerando:
 * 1. FormResponse (pedidos de mesa/delivery) com menuItems em metadata
 * 2. GourmetFinanceiro tipo="pdv" com itens salvos na coluna itens
 * Pedidos cancelados são excluídos.
 */
const RelatorioProdutosService = async ({
  companyId,
  startDate,
  endDate,
}: Params): Promise<RelatorioProdutosResult> => {
  const start = `${startDate} 00:00:00`;
  const end = `${endDate} 23:59:59`;

  const map = new Map<string, { qty: number; unitValue: number }>();

  // ── 1. Pedidos de formulário (mesa/delivery) ─────────────────────────────
  const responses = await FormResponse.findAll({
    where: {
      submittedAt: { [Op.gte]: start, [Op.lte]: end },
      orderStatus: { [Op.notIn]: ["cancelado"] },
    },
    attributes: ["id", "metadata"],
    include: [
      {
        association: "form",
        attributes: ["companyId"],
        required: true,
        where: { companyId },
      },
    ],
  });

  for (const response of responses) {
    const meta = (response as any).metadata || {};
    const items: any[] = Array.isArray(meta.menuItems) ? meta.menuItems : [];
    acumularItens(map, items);
  }

  // ── 2. Vendas PDV (nova venda) ────────────────────────────────────────────
  const pdvVendas = await GourmetFinanceiro.findAll({
    where: {
      companyId,
      tipo: "pdv",
      createdAt: { [Op.gte]: start, [Op.lte]: end },
    },
    attributes: ["id", "itens"],
  });

  for (const venda of pdvVendas) {
    const items: any[] = Array.isArray((venda as any).itens) ? (venda as any).itens : [];
    acumularItens(map, items);
  }

  // ── Montar resultado ──────────────────────────────────────────────────────
  const produtos: ProdutoRelatório[] = Array.from(map.entries())
    .map(([productName, { qty, unitValue }]) => ({
      productName,
      quantity: qty,
      unitValue,
      total: Math.round(qty * unitValue * 100) / 100,
    }))
    .sort((a, b) => b.quantity - a.quantity);

  const totalGeral = Math.round(
    produtos.reduce((s, p) => s + p.total, 0) * 100
  ) / 100;

  const totalItens = produtos.reduce((s, p) => s + p.quantity, 0);

  return { produtos, totalGeral, totalItens, startDate, endDate };
};

export default RelatorioProdutosService;
