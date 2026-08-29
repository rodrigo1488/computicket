import { Router } from "express";
import isPrintDeviceAuth from "../middleware/isPrintDeviceAuth";
import * as AgentPosCatalogController from "../controllers/AgentPosCatalogController";

const routes = Router();

routes.get("/agent/pos/catalog", isPrintDeviceAuth, AgentPosCatalogController.catalog);
routes.put("/agent/pos/mesas/:id/ocupar", isPrintDeviceAuth, AgentPosCatalogController.ocupar);
routes.put("/agent/pos/mesas/:id/liberar", isPrintDeviceAuth, AgentPosCatalogController.liberar);

export default routes;
