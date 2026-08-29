import express from "express";
import isAuth from "../middleware/isAuth";

import * as UserAppointmentController from "../controllers/UserAppointmentController";

const userAppointmentRoutes = express.Router();

userAppointmentRoutes.get("/user-appointments", isAuth, UserAppointmentController.index);
userAppointmentRoutes.post("/user-appointments", isAuth, UserAppointmentController.store);
userAppointmentRoutes.get("/user-appointments/:id", isAuth, UserAppointmentController.show);
userAppointmentRoutes.put("/user-appointments/:id", isAuth, UserAppointmentController.update);
userAppointmentRoutes.delete("/user-appointments/:id", isAuth, UserAppointmentController.remove);

export default userAppointmentRoutes;
