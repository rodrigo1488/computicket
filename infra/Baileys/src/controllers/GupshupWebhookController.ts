import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { logger } from "../utils/logger";
import { processGupshupWebhook } from "../services/GupshupServices/ReceiveGupshupWebhook";

/**
 * Controller para receber webhooks da Gupshup
 */
export const webhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const payload = req.body;

    logger.info("Gupshup webhook recebido:", JSON.stringify(payload));

    // Processar webhook de forma assíncrona
    processGupshupWebhook(payload).catch(error => {
      Sentry.captureException(error);
      logger.error("Erro ao processar webhook Gupshup:", error);
    });

    // Retornar resposta imediata para Gupshup
    return res.status(200).json({
      status: "success",
      message: "Webhook recebido"
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error("Erro no controller do webhook Gupshup:", error);
    return res.status(500).json({
      status: "error",
      message: "Erro ao processar webhook"
    });
  }
};

