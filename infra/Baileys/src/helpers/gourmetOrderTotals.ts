export type DescontoTipo = "fixed" | "percent";

export interface DescontoInput {
  tipo?: DescontoTipo | string | null;
  valor?: number | string | null;
}

export interface DiscountResult {
  subtotal: number;
  desconto: number;
  total: number;
  descontoTipo: DescontoTipo | null;
  descontoValor: number | null;
}

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

export const calcMenuItemLineTotal = (item: {
  quantity?: number;
  productValue?: number;
  addonsTotal?: number;
}): number => {
  const qty = Number(item.quantity) || 0;
  const pv = Number(item.productValue) || 0;
  const at = Number(item.addonsTotal) || 0;
  return roundMoney((pv + at) * qty);
};

export const calcSubtotalFromMenuItems = (items: unknown[]): number => {
  if (!Array.isArray(items)) return 0;
  return roundMoney(
    items.reduce((sum, item) => sum + calcMenuItemLineTotal(item as any), 0)
  );
};

export const calcSubtotalFromPdvItens = (
  itens: Array<{ quantity?: number; productValue?: number }>
): number => {
  if (!Array.isArray(itens)) return 0;
  return roundMoney(
    itens.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const val = Number(item.productValue) ?? 0;
      return sum + qty * val;
    }, 0)
  );
};

export const applyDiscount = (
  subtotal: number,
  descontoInput?: DescontoInput | null
): DiscountResult => {
  const base = roundMoney(Math.max(0, Number(subtotal) || 0));
  const tipoRaw = descontoInput?.tipo;
  const valorInformado = Number(descontoInput?.valor);

  if (
    !tipoRaw ||
    (tipoRaw !== "fixed" && tipoRaw !== "percent") ||
    !Number.isFinite(valorInformado) ||
    valorInformado <= 0
  ) {
    return {
      subtotal: base,
      desconto: 0,
      total: base,
      descontoTipo: null,
      descontoValor: null,
    };
  }

  const tipo = tipoRaw as DescontoTipo;
  let desconto = 0;
  if (tipo === "fixed") {
    desconto = Math.min(valorInformado, base);
  } else {
    desconto = Math.min(roundMoney((base * valorInformado) / 100), base);
  }
  desconto = roundMoney(desconto);
  const total = roundMoney(Math.max(0, base - desconto));

  return {
    subtotal: base,
    desconto,
    total,
    descontoTipo: tipo,
    descontoValor: roundMoney(valorInformado),
  };
};

export const validatePayments = (
  total: number,
  meiosPagamento: unknown,
  options?: { requireFullPayment?: boolean }
): { ok: boolean; paid: number; restante: number } => {
  const expected = roundMoney(Number(total) || 0);
  if (!Array.isArray(meiosPagamento) || meiosPagamento.length === 0) {
    if (options?.requireFullPayment && expected > 0.01) {
      return { ok: false, paid: 0, restante: expected };
    }
    return { ok: true, paid: 0, restante: expected };
  }

  const paid = roundMoney(
    meiosPagamento.reduce((s, p: any) => s + (Number(p?.valor) || 0), 0)
  );
  const restante = roundMoney(expected - paid);
  const ok = restante <= 0.01;
  return { ok, paid, restante };
};
