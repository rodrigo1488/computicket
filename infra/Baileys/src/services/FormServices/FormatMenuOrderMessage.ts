import Product from "../../models/Product";
import ProductVariationOption from "../../models/ProductVariationOption";

interface MenuItem {
  productId: number;
  quantity: number;
  productName?: string;
  productValue?: number;
  grupo?: string;
  type?: string;
  observation?: string;
  variationOptionId?: number | null;
  optionId?: number | null;
  baseOptionId?: number | null;
  half1OptionId?: number | null;
  half2OptionId?: number | null;
  addons?: Array<{ label: string; value: number }>;
  addonsTotal?: number;
  comboItems?: Array<{
    productId?: number;
    productName?: string;
    value?: number;
    quantity?: number;
    variationOptionId?: number | null;
  }>;
}

interface CustomField {
  label: string;
  answer: string;
}

interface Request {
  menuItems: MenuItem[];
  customerName: string;
  customerPhone: string;
  customFields?: CustomField[];
  protocol?: string;
  /** Número/nome da mesa (pedidos de mesa ou garçom) */
  tableNumber?: string;
  /** Nome do garçom que anotou o pedido */
  garcomName?: string;
  /** Taxa de entrega (se houver) */
  deliveryFee?: number;
  /** Total já calculado (incluindo taxa de entrega e desconto) */
  total?: number;
  /** Código do cupom aplicado (se houver) */
  couponCode?: string;
  /** Valor do desconto do cupom (se houver) */
  couponDiscount?: number;
}

type ProductInfo = { name: string; value: number; grupo: string };
type OptionInfo = { id: number; label: string; value: number };

export const resolveVariationOptionId = (item: MenuItem): number | null => {
  const raw =
    item.variationOptionId ??
    item.optionId ??
    (item.type === "halfAndHalf" ? item.baseOptionId ?? item.half1OptionId : null);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const collectVariationOptionIds = (menuItems: MenuItem[]): number[] => {
  const ids = new Set<number>();
  for (const item of menuItems || []) {
    const primary = resolveVariationOptionId(item);
    if (primary) ids.add(primary);
    if (item.half2OptionId) {
      const n = Number(item.half2OptionId);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
    for (const ci of item.comboItems || []) {
      if (ci.variationOptionId) {
        const n = Number(ci.variationOptionId);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
  }
  return Array.from(ids);
};

export const buildProductDisplayName = (
  baseName: string,
  productName: string | undefined,
  optionLabel: string | null | undefined
): string => {
  const name = String(productName || baseName || "Produto").trim();
  const label = String(optionLabel || "").trim();
  if (!label) return name || "Produto";
  if (name.toLowerCase().includes(label.toLowerCase())) return name;
  const base = String(baseName || name).trim() || name;
  return `${base} - ${label}`;
};

export const resolveMenuItemForMessage = (
  item: MenuItem,
  productMap: Map<number, ProductInfo>,
  optionMap: Map<number, OptionInfo>
): MenuItem => {
  const product = productMap.get(item.productId);
  const grupo = item.grupo || product?.grupo || "Outros";
  const optionId = resolveVariationOptionId(item);
  const option = optionId ? optionMap.get(optionId) : undefined;

  let productName = item.productName || product?.name || "Produto";
  let productValue =
    item.productValue != null ? Number(item.productValue) : Number(product?.value) || 0;

  if (option) {
    productName = buildProductDisplayName(
      product?.name || productName,
      item.productName,
      option.label
    );
    if (item.productValue == null) {
      productValue = Number(option.value) || productValue;
    }
  }

  if (item.type === "halfAndHalf") {
    const sizeLabel = option?.label;
    if (sizeLabel && !String(productName).toLowerCase().includes(sizeLabel.toLowerCase())) {
      productName = `${productName} (${sizeLabel})`;
    }
  }

  const comboItems = (item.comboItems || []).map((ci) => {
    const ciOptionId = ci.variationOptionId ? Number(ci.variationOptionId) : null;
    const ciOption =
      ciOptionId && Number.isFinite(ciOptionId) ? optionMap.get(ciOptionId) : undefined;
    const ciBaseName = ci.productName || `Produto #${ci.productId || "?"}`;
    return {
      ...ci,
      productName: ciOption
        ? buildProductDisplayName(ciBaseName, ci.productName, ciOption.label)
        : ciBaseName,
    };
  });

  return {
    ...item,
    productName,
    productValue,
    grupo,
    comboItems,
  };
};

const FormatMenuOrderMessage = async ({
  menuItems,
  customerName,
  customerPhone,
  customFields = [],
  protocol,
  tableNumber,
  garcomName,
  deliveryFee = 0,
  total,
  couponCode,
  couponDiscount = 0,
}: Request): Promise<string> => {
  const productIds = [...new Set(menuItems.map((item) => item.productId).filter(Boolean))];
  const products = productIds.length
    ? await Product.findAll({ where: { id: productIds } })
    : [];

  const productMap = new Map<number, ProductInfo>(
    products.map((p) => [
      p.id,
      {
        name: p.name,
        value: Number(p.value) || 0,
        grupo: p.grupo || "Outros",
      },
    ])
  );

  const optionIds = collectVariationOptionIds(menuItems);
  const options = optionIds.length
    ? await ProductVariationOption.findAll({ where: { id: optionIds } })
    : [];
  const optionMap = new Map<number, OptionInfo>(
    options.map((o) => [
      o.id,
      { id: o.id, label: o.label, value: Number(o.value) || 0 },
    ])
  );

  const itemsByGroup: { [key: string]: MenuItem[] } = {};

  menuItems.forEach((item) => {
    const resolved = resolveMenuItemForMessage(item, productMap, optionMap);
    const grupo = resolved.grupo || "Outros";
    if (!itemsByGroup[grupo]) itemsByGroup[grupo] = [];
    itemsByGroup[grupo].push(resolved);
  });

  let message = "🍽️ *NOVO PEDIDO - CARDÁPIO*\n\n";
  if (protocol) {
    message += `📋 *Protocolo:* ${protocol}\n`;
  }
  if (tableNumber) {
    message += `🪑 *Mesa:* ${tableNumber}\n`;
  }
  if (garcomName) {
    message += `👨‍💼 *Garçom:* ${garcomName}\n`;
  }
  message += `👤 *Cliente:* ${customerName}\n`;
  message += `📱 *Telefone:* ${customerPhone}\n\n`;
  message += "📋 *ITENS DO PEDIDO:*\n\n";

  const lineTotal = (item: MenuItem) => {
    const pv = item.productValue || 0;
    const addonsTotal = item.addonsTotal || 0;
    return (pv + addonsTotal) * item.quantity;
  };

  let calculatedTotal = total;
  if (calculatedTotal == null) {
    calculatedTotal = 0;
    Object.keys(itemsByGroup).forEach((grupo) => {
      itemsByGroup[grupo].forEach((item) => {
        calculatedTotal += lineTotal(item);
      });
    });
    calculatedTotal += deliveryFee || 0;
  }

  Object.keys(itemsByGroup).forEach((grupo) => {
    message += `*${grupo}*\n`;
    itemsByGroup[grupo].forEach((item) => {
      const itemTotal = lineTotal(item);
      const comboLabel = item.type === "combo" ? " (Combo)" : "";
      message += `• ${item.productName}${comboLabel} - Qtd: ${item.quantity} - R$ ${itemTotal.toFixed(2).replace(".", ",")}\n`;
      if (item.type === "combo" && Array.isArray(item.comboItems) && item.comboItems.length > 0) {
        item.comboItems.forEach((ci) => {
          const q = Number(ci.quantity) || 1;
          const name = ci.productName || `Produto #${ci.productId || "?"}`;
          const val = Number(ci.value) || 0;
          message += `  └ ${q > 1 ? `${q}x ` : ""}${name} — R$ ${val.toFixed(2).replace(".", ",")}\n`;
        });
      }
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((a) => {
          message += `  └ ${a.label} + R$ ${Number(a.value).toFixed(2).replace(".", ",")}\n`;
        });
      }
      if (item.observation && String(item.observation).trim()) {
        message += `  📝 Obs: ${String(item.observation).trim()}\n`;
      }
    });
    message += "\n";
  });

  const itemsSubtotal = calculatedTotal - (deliveryFee || 0) + (couponDiscount || 0);
  if ((deliveryFee && deliveryFee > 0) || (couponDiscount && couponDiscount > 0)) {
    message += `💰 *Subtotal:* R$ ${itemsSubtotal.toFixed(2).replace(".", ",")}\n`;
  }
  if (deliveryFee && deliveryFee > 0) {
    message += `🚚 *Taxa de entrega:* R$ ${deliveryFee.toFixed(2).replace(".", ",")}\n`;
  }
  if (couponDiscount && couponDiscount > 0) {
    message += `🎟️ *Cupom${couponCode ? ` (${couponCode})` : ""}:* - R$ ${couponDiscount.toFixed(2).replace(".", ",")}\n`;
  }
  message += `💰 *TOTAL:* R$ ${calculatedTotal.toFixed(2).replace(".", ",")}\n`;

  if (customFields && customFields.length > 0) {
    message += "\n";
    customFields.forEach((field) => {
      if (field.answer && field.answer.trim() !== "") {
        message += `*${field.label}:* ${field.answer}\n`;
      }
    });
  }

  return message;
};

export default FormatMenuOrderMessage;
