import { Router } from "express";
import * as PromptController from "../controllers/PromptController";
import * as PromptTemplateController from "../controllers/PromptTemplateController";
import isAuth from "../middleware/isAuth";


const promptRoutes = Router();

promptRoutes.get("/prompt", isAuth, PromptController.index);

promptRoutes.post("/prompt", isAuth, PromptController.store);

promptRoutes.get("/prompt/:promptId", isAuth, PromptController.show);

promptRoutes.put("/prompt/:promptId", isAuth, PromptController.update);

promptRoutes.delete("/prompt/:promptId", isAuth, PromptController.remove);

// Rotas de templates
promptRoutes.get("/prompt-templates", isAuth, PromptTemplateController.listTemplates);

promptRoutes.post("/prompt-templates/create", isAuth, PromptTemplateController.createFromTemplate);

export default promptRoutes;
