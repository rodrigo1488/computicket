import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as MesaController from "../controllers/MesaController";

const routes = express.Router();
const requireLanchonetes = hasCompanyModule("lanchonetes");

routes.get("/mesas", isAuth, requireLanchonetes, MesaController.index);
routes.get("/mesas/links-qr", isAuth, requireLanchonetes, MesaController.getMesasLinksQr);
routes.get("/mesas/by-identifier", isAuth, requireLanchonetes, MesaController.byIdentifier);
routes.get("/mesas/default-cardapio-form", isAuth, requireLanchonetes, MesaController.getDefaultCardapioForm);
routes.post("/mesas", isAuth, requireLanchonetes, MesaController.store);
routes.post("/mesas/bulk", isAuth, requireLanchonetes, MesaController.storeBulk);
routes.post(
  "/mesas/validate-restore-qr",
  isAuth,
  requireLanchonetes,
  MesaController.validateRestoreQr
);
routes.post(
  "/mesas/restore-from-qr",
  isAuth,
  requireLanchonetes,
  MesaController.restoreFromQr
);
routes.get("/mesas/:id/link-qr", isAuth, requireLanchonetes, MesaController.getMesaLinkQr);
routes.get("/mesas/:id", isAuth, requireLanchonetes, MesaController.show);
routes.get("/mesas/:id/resumo-conta", isAuth, requireLanchonetes, MesaController.resumoConta);
routes.put("/mesas/:id", isAuth, requireLanchonetes, MesaController.update);
routes.put("/mesas/:id/ocupar", isAuth, requireLanchonetes, MesaController.ocupar);
routes.put("/mesas/:id/contato-nome", isAuth, requireLanchonetes, MesaController.atualizarNomeContato);
routes.post("/mesas/:id/confirmar-ocupacao", isAuth, requireLanchonetes, MesaController.confirmarOcupacao);
routes.put("/mesas/:id/liberar", isAuth, requireLanchonetes, MesaController.liberar);
routes.delete("/mesas/:id", isAuth, requireLanchonetes, MesaController.destroy);

// Public routes (no auth) - cardápio por mesa / QR
routes.get("/public/mesas/:mesaId", MesaController.getPublicMesaByToken);
routes.get("/public/mesas/:mesaId/products", MesaController.getPublicMesaProducts);
routes.get("/public/forms/:publicId/mesas", MesaController.getPublicMesas);
routes.get("/public/forms/:publicId/mesas/:mesaId", MesaController.getPublicMesaById);

export default routes;
