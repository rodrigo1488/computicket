import { Router } from "express";
import * as GupshupWebhookController from "../controllers/GupshupWebhookController";

const gupshupWebhookRoutes = Router();

// Rota para receber webhooks da Gupshup
// Esta rota não requer autenticação pois será chamada pela Gupshup
gupshupWebhookRoutes.post("/webhook/gupshup", GupshupWebhookController.webhook);

export default gupshupWebhookRoutes;

