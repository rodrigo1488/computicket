import express from "express";
import isAuth from "../middleware/isAuth";
import * as CompanyModuleController from "../controllers/CompanyModuleController";

const routes = express.Router();

routes.get("/company/modules", isAuth, CompanyModuleController.list);
routes.get("/company/modules/available", isAuth, CompanyModuleController.available);
routes.post("/company/modules/:moduleName", isAuth, CompanyModuleController.add);
routes.delete("/company/modules/:moduleName", isAuth, CompanyModuleController.remove);

export default routes;
