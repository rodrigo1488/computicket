import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as AppointmentServiceController from "../controllers/AppointmentServiceController";

const routes = express.Router();
const requireAgendamento = hasCompanyModule("agendamento");

routes.get("/appointment-services", isAuth, requireAgendamento, AppointmentServiceController.index);
routes.post("/appointment-services", isAuth, requireAgendamento, AppointmentServiceController.store);
routes.get("/appointment-services/:id", isAuth, requireAgendamento, AppointmentServiceController.show);
routes.put("/appointment-services/:id", isAuth, requireAgendamento, AppointmentServiceController.update);
routes.delete("/appointment-services/:id", isAuth, requireAgendamento, AppointmentServiceController.remove);

export default routes;
