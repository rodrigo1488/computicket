import express from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";

import * as CompanyController from "../controllers/CompanyController";

const companyRoutes = express.Router();

companyRoutes.get("/companies/list", isAuth, isSuper, CompanyController.list);
companyRoutes.get("/companies", isAuth, isSuper, CompanyController.index);
companyRoutes.get("/companies/:id", isAuth, CompanyController.show);
companyRoutes.post("/companies", isAuth, isSuper, CompanyController.store);
companyRoutes.put("/companies/:id", isAuth, isSuper, CompanyController.update);
companyRoutes.put("/companies/:id/schedules",isAuth,CompanyController.updateSchedules);
companyRoutes.delete("/companies/:id", isAuth, isSuper, CompanyController.remove);
companyRoutes.post("/companies/cadastro", CompanyController.store);
companyRoutes.post("/companies/create-free-account", CompanyController.createFreeAccount);
companyRoutes.put("/companies/:id/auto-renew", isAuth, CompanyController.updateCompanyAutoRenew);
companyRoutes.get("/companies/by-email", CompanyController.getCompanyByEmail);

companyRoutes.get("/companies/:id/modules", isAuth, isSuper, CompanyController.getCompanyModules);
companyRoutes.put("/companies/:id/modules", isAuth, isSuper, CompanyController.updateCompanyModules);

// Rota para listar o plano da empresa
companyRoutes.get("/companies/listPlan/:id", isAuth, CompanyController.listPlan);
companyRoutes.get("/companiesPlan", isAuth, CompanyController.indexPlan);

export default companyRoutes;
