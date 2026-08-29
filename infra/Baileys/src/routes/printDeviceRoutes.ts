import express from "express";
import isAuth from "../middleware/isAuth";
import * as PrintDeviceController from "../controllers/PrintDeviceController";

const routes = express.Router();

routes.get("/print-devices", isAuth, PrintDeviceController.index);
routes.post("/print-devices", isAuth, PrintDeviceController.store);
routes.get("/print-devices/:id", isAuth, PrintDeviceController.show);
routes.put("/print-devices/:id", isAuth, PrintDeviceController.update);
routes.delete("/print-devices/:id", isAuth, PrintDeviceController.destroy);
routes.post(
  "/print-devices/:id/regenerate-token",
  isAuth,
  PrintDeviceController.regenerateToken
);

export default routes;
