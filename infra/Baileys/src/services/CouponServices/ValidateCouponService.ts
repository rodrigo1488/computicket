import Coupon from "../../models/Coupon";

interface Request {
  companyId: number;
  code: string;
  subtotal: number;
}

export interface CouponValidationResult {
  valid: boolean;
  reason?: string;
  coupon?: Coupon;
  discount: number;
}

/**
 * Valida um cupom para a empresa e calcula o desconto sobre o subtotal.
 * Não incrementa uso — isso é feito apenas no submit do pedido.
 */
const ValidateCouponService = async ({
  companyId,
  code,
  subtotal,
}: Request): Promise<CouponValidationResult> => {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    return { valid: false, reason: "Informe o código do cupom.", discount: 0 };
  }

  const coupon = await Coupon.findOne({
    where: { companyId, code: normalized },
  });

  if (!coupon || coupon.active !== true) {
    return { valid: false, reason: "Cupom inválido.", discount: 0 };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    return { valid: false, reason: "Cupom expirado.", discount: 0 };
  }
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, reason: "Cupom esgotado.", discount: 0 };
  }
  const minOrder = Number(coupon.minOrderValue) || 0;
  if (minOrder > 0 && subtotal < minOrder) {
    return {
      valid: false,
      reason: `Pedido mínimo de R$ ${minOrder.toFixed(2).replace(".", ",")} para este cupom.`,
      discount: 0,
    };
  }

  const value = Number(coupon.discountValue) || 0;
  let discount = coupon.discountType === "percent" ? (subtotal * value) / 100 : value;
  discount = Math.min(discount, subtotal);
  discount = Math.round(discount * 100) / 100;

  return { valid: true, coupon, discount };
};

export default ValidateCouponService;
