import express from "express";
import isAuth from "../middleware/isAuth";

import * as DashboardController from "../controllers/DashbardController";

const routes = express.Router();

routes.get("/dashboard", isAuth, DashboardController.index);
routes.get("/dashboard/extended", isAuth, DashboardController.extended);
routes.get("/dashboard/orders-stats", isAuth, DashboardController.ordersStats);
routes.get("/dashboard/lanchonetes-stats", isAuth, DashboardController.lanchonetesStats);
routes.get("/dashboard/lanchonetes-export", isAuth, DashboardController.lanchonetesExport);
routes.get("/dashboard/agendamento-stats", isAuth, DashboardController.agendamentoStats);
routes.get("/dashboard/financial-summary", isAuth, DashboardController.financialSummary);
routes.get("/dashboard/ticketsUsers", isAuth, DashboardController.reportsUsers);
routes.get("/dashboard/ticketsDay", isAuth, DashboardController.reportsDay);

export default routes;
