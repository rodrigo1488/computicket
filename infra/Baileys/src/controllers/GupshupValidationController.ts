import { Request, Response } from "express";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { ValidateGupshupConnection, TestGupshupConnection } from "../services/GupshupServices/ValidateGupshupConnection";
import AppError from "../errors/AppError";

/**
 * Valida conexão Gupshup existente
 */
export const validateConnection = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { whatsappId } = req.params;
    const { companyId } = req.user;

    const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

    if (whatsapp.provider !== "gupshup") {
      throw new AppError("Esta conexão não é do tipo Gupshup");
    }

    const result = await ValidateGupshupConnection(whatsapp);

    return res.status(200).json({
      valid: result.valid,
      message: result.message,
      status: whatsapp.status
    });
  } catch (error: any) {
    return res.status(400).json({
      error: error.message || "Erro ao validar conexão"
    });
  }
};

/**
 * Testa credenciais Gupshup sem salvar
 */
export const testCredentials = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { apiKey, appName } = req.body;

    if (!apiKey || !appName) {
      throw new AppError("API Key e App Name são obrigatórios");
    }

    const result = await TestGupshupConnection(apiKey, appName);

    return res.status(200).json({
      valid: result.valid,
      message: result.message
    });
  } catch (error: any) {
    return res.status(400).json({
      error: error.message || "Erro ao testar credenciais"
    });
  }
};

