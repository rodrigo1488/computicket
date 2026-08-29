import { Request, Response } from "express";
import * as Yup from "yup";
import Coupon from "../models/Coupon";
import AppError from "../errors/AppError";
import ValidateCouponService from "../services/CouponServices/ValidateCouponService";
import { findPublicFormBySlug } from "../services/FormServices/FindPublicFormService";

const couponSchema = Yup.object().shape({
  code: Yup.string().required().max(30),
  discountType: Yup.string().oneOf(["percent", "fixed"]).required(),
  discountValue: Yup.number().min(0).required(),
  minOrderValue: Yup.number().min(0).nullable(),
  expiresAt: Yup.date().nullable(),
  usageLimit: Yup.number().min(1).nullable(),
  active: Yup.boolean(),
});

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const coupons = await Coupon.findAll({
    where: { companyId },
    order: [["createdAt", "DESC"]],
  });
  return res.json(coupons);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  try {
    await couponSchema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }
  const { code, discountType, discountValue, minOrderValue, expiresAt, usageLimit, active } = req.body;
  const normalized = String(code).trim().toUpperCase();
  const existing = await Coupon.findOne({ where: { companyId, code: normalized } });
  if (existing) {
    throw new AppError("Já existe um cupom com este código.", 409);
  }
  const coupon = await Coupon.create({
    companyId,
    code: normalized,
    discountType,
    discountValue,
    minOrderValue: minOrderValue ?? null,
    expiresAt: expiresAt ?? null,
    usageLimit: usageLimit ?? null,
    active: active !== false,
  } as any);
  return res.status(201).json(coupon);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const coupon = await Coupon.findOne({ where: { id, companyId } });
  if (!coupon) {
    throw new AppError("ERR_COUPON_NOT_FOUND", 404);
  }
  const { code, discountType, discountValue, minOrderValue, expiresAt, usageLimit, active } = req.body;
  await coupon.update({
    ...(code != null && { code: String(code).trim().toUpperCase() }),
    ...(discountType != null && { discountType }),
    ...(discountValue != null && { discountValue }),
    minOrderValue: minOrderValue ?? null,
    expiresAt: expiresAt ?? null,
    usageLimit: usageLimit ?? null,
    ...(active != null && { active: active === true }),
  } as any);
  return res.json(coupon);
};

export const destroy = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const coupon = await Coupon.findOne({ where: { id, companyId } });
  if (!coupon) {
    throw new AppError("ERR_COUPON_NOT_FOUND", 404);
  }
  await coupon.destroy();
  return res.status(204).send();
};

/** Público: valida cupom no checkout do cardápio (não incrementa uso). */
export const validatePublic = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const { code, subtotal } = req.body;

  const form = await findPublicFormBySlug(publicId, {
    attributes: ["id", "companyId"],
  });

  const result = await ValidateCouponService({
    companyId: form.companyId,
    code: String(code || ""),
    subtotal: Number(subtotal) || 0,
  });

  if (!result.valid) {
    return res.json({ valid: false, reason: result.reason });
  }
  return res.json({
    valid: true,
    code: result.coupon!.code,
    discountType: result.coupon!.discountType,
    discountValue: Number(result.coupon!.discountValue),
    discount: result.discount,
  });
};
