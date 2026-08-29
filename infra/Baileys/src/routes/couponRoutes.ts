import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as CouponController from "../controllers/CouponController";

const routes = express.Router();
const requireLanchonetes = hasCompanyModule("lanchonetes");

routes.get("/coupons", isAuth, requireLanchonetes, CouponController.index);
routes.post("/coupons", isAuth, requireLanchonetes, CouponController.store);
routes.put("/coupons/:id", isAuth, requireLanchonetes, CouponController.update);
routes.delete("/coupons/:id", isAuth, requireLanchonetes, CouponController.destroy);

// Público: validação de cupom no checkout do cardápio
routes.post("/public/forms/:publicId/validate-coupon", CouponController.validatePublic);

export default routes;
