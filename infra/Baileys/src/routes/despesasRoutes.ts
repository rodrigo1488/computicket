import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as GourmetDespesaController from "../controllers/GourmetDespesaController";
import validateAIApiKey from "../middleware/validateAIApiKey";
import uploadExpenseDocMemory from "../config/uploadExpenseDocMemory";

const routes = express.Router();
const requireLanchonetes = hasCompanyModule("lanchonetes");

routes.get("/despesas", isAuth, requireLanchonetes, GourmetDespesaController.index);
routes.post("/despesas", isAuth, requireLanchonetes, GourmetDespesaController.store);
routes.post(
  "/despesas/extract-document",
  isAuth,
  requireLanchonetes,
  validateAIApiKey,
  uploadExpenseDocMemory.single("file"),
  GourmetDespesaController.extractFromDocument
);
routes.get("/despesas/:id", isAuth, requireLanchonetes, GourmetDespesaController.show);
routes.put("/despesas/:id", isAuth, requireLanchonetes, GourmetDespesaController.update);
routes.delete("/despesas/:id", isAuth, requireLanchonetes, GourmetDespesaController.destroy);

export default routes;
