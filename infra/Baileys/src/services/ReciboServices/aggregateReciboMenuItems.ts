/** Item de cardápio como aparece em metadata.menuItems / resumo-conta. */
export type ReciboMenuItem = {
  productId?: number;
  productName?: string;
  quantity?: number;
  productValue?: number;
  addonsTotal?: number;
  addons?: Array<{ addOnItemId?: number; label?: string; value?: number }>;
  type?: string;
  half1ProductId?: number;
  half2ProductId?: number;
};

export function menuItemLineTotal(item: ReciboMenuItem): number {
  const qty = Number(item.quantity) || 0;
  const pv = Number(item.productValue) || 0;
  const at = Number(item.addonsTotal) || 0;
  return Math.round((pv + at) * qty * 100) / 100;
}

export function fingerprintMenuItem(item: ReciboMenuItem): string {
  const addonIds = (item.addons || [])
    .map((a) => a.addOnItemId)
    .filter((id) => id != null)
    .sort((a, b) => Number(a) - Number(b));
  const parts = [
    item.type || "",
    item.productId ?? "",
    (item.productName || "").trim(),
    Number(item.productValue) || 0,
    Number(item.addonsTotal) || 0,
    addonIds.join(","),
    item.half1ProductId ?? "",
    item.half2ProductId ?? ""
  ];
  return JSON.stringify(parts);
}

export interface AggregatedLine {
  productName: string;
  quantity: number;
  /** productValue + addonsTotal (por unidade) */
  unitValue: number;
  lineTotal: number;
}

export function aggregateReciboMenuItems(
  pedidos: Array<{ menuItems?: ReciboMenuItem[] }>
): AggregatedLine[] {
  const map = new Map<string, { name: string; qty: number; unit: number }>();
  for (const pedido of pedidos || []) {
    for (const raw of pedido.menuItems || []) {
      const item = raw as ReciboMenuItem;
      const key = fingerprintMenuItem(item);
      const qty = Number(item.quantity) || 0;
      const pv = Number(item.productValue) || 0;
      const at = Number(item.addonsTotal) || 0;
      const unit = Math.round((pv + at) * 100) / 100;
      const existing = map.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        map.set(key, { name: (item.productName || "Item").trim() || "Item", qty, unit });
      }
    }
  }
  return Array.from(map.values()).map((v) => ({
    productName: v.name,
    quantity: v.qty,
    unitValue: v.unit,
    lineTotal: Math.round(v.qty * v.unit * 100) / 100
  }));
}
