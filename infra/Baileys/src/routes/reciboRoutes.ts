import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as ReciboController from "../controllers/ReciboController";

const reciboRoutes = Router();

reciboRoutes.post("/recibos/pdf", isAuth, ReciboController.postPdf);

export default reciboRoutes;
