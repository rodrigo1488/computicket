import { Router } from "express";
import * as InstagramController from "../controllers/InstagramController";

const instagramRoutes = Router();

instagramRoutes.get("/instagram/webhook", InstagramController.webhookVerify);
instagramRoutes.post("/instagram/webhook", InstagramController.webhookEvent);

export default instagramRoutes;
