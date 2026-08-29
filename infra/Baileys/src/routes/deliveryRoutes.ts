import express from "express";
import isAuth from "../middleware/isAuth";
import * as DeliveryController from "../controllers/DeliveryController";

const routes = express.Router();

routes.get("/delivery/order-by-token", isAuth, DeliveryController.orderByToken);
routes.get("/delivery/scan-token/:formId/:responseId", isAuth, DeliveryController.getScanToken);
routes.post("/delivery/iniciar-rota", isAuth, DeliveryController.iniciarRota);
routes.post("/delivery/finalizar-rota", isAuth, DeliveryController.finalizarRota);
routes.get("/delivery/entregas-concluidas", isAuth, DeliveryController.listEntregasConcluidas);

export default routes;
