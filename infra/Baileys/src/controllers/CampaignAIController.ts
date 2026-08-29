import { Request, Response } from "express";
import {
  generateInitialMessage,
  generateVariations
} from "../services/AiServices/CampaignMessageGeneratorService";

/**
 * Gera mensagem inicial de campanha baseada no objetivo
 * POST /ai/campaign/initial
 */
export const generateCampaignInitialMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { objective } = req.body;

    if (!objective || !objective.trim()) {
      return res.status(400).json({ 
        error: "OBJECTIVE_REQUIRED",
        message: "Objetivo da campanha é obrigatório" 
      });
    }

    if (objective.trim().length < 10) {
      return res.status(400).json({ 
        error: "OBJECTIVE_TOO_SHORT",
        message: "Objetivo deve ter pelo menos 10 caracteres" 
      });
    }

    if (objective.trim().length > 500) {
      return res.status(400).json({ 
        error: "OBJECTIVE_TOO_LONG",
        message: "Objetivo deve ter no máximo 500 caracteres" 
      });
    }

    const result = await generateInitialMessage({
      companyId,
      objective: objective.trim()
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao gerar mensagem inicial de campanha:", err);
    
    if (
      err.message?.includes("LM_STUDIO") ||
      err.message?.includes("Servidor de IA não configurado") ||
      err.message?.includes("API Key") ||
      err.message?.includes("GEMINI_KEY") ||
      err.message?.includes("OPENAI")
    ) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message || "IA não configurada no servidor"
      });
    }

    return res.status(err.statusCode || 500).json({
      error: "ERR_GENERATE_CAMPAIGN_MESSAGE",
      message: err.message || "Erro ao gerar mensagem de campanha"
    });
  }
};

/**
 * Gera 4 variações da mensagem original
 * POST /ai/campaign/variations
 */
export const generateCampaignVariations = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { originalMessage, objective } = req.body;

    if (!originalMessage || !originalMessage.trim()) {
      return res.status(400).json({ 
        error: "MESSAGE_REQUIRED",
        message: "Mensagem original é obrigatória" 
      });
    }

    if (!objective || !objective.trim()) {
      return res.status(400).json({ 
        error: "OBJECTIVE_REQUIRED",
        message: "Objetivo da campanha é obrigatório" 
      });
    }

    if (originalMessage.trim().length < 20) {
      return res.status(400).json({ 
        error: "MESSAGE_TOO_SHORT",
        message: "Mensagem original deve ter pelo menos 20 caracteres" 
      });
    }

    if (originalMessage.trim().length > 1000) {
      return res.status(400).json({ 
        error: "MESSAGE_TOO_LONG",
        message: "Mensagem original muito longa" 
      });
    }

    const result = await generateVariations({
      companyId,
      originalMessage: originalMessage.trim(),
      objective: objective.trim()
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao gerar variações de campanha:", err);
    
    if (
      err.message?.includes("LM_STUDIO") ||
      err.message?.includes("Servidor de IA não configurado") ||
      err.message?.includes("API Key") ||
      err.message?.includes("GEMINI_KEY") ||
      err.message?.includes("OPENAI")
    ) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message || "IA não configurada no servidor"
      });
    }

    return res.status(err.statusCode || 500).json({
      error: "ERR_GENERATE_CAMPAIGN_VARIATIONS",
      message: err.message || "Erro ao gerar variações de campanha"
    });
  }
};

