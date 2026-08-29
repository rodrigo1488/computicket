import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as AppointmentController from "../controllers/AppointmentController";

const routes = express.Router();
const requireAgendamento = hasCompanyModule("agendamento");

routes.get("/appointments", isAuth, requireAgendamento, AppointmentController.index);
routes.get("/appointments/:id", isAuth, requireAgendamento, AppointmentController.show);
routes.put("/appointments/:id", isAuth, requireAgendamento, AppointmentController.update);

export default routes;
