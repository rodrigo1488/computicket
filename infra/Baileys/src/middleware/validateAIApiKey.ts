import { Request, Response, NextFunction } from "express";
import { AIProviderFactory } from "../services/AiServices/AIProviderFactory";

/**
 * Garante que o backend tem LM Studio (OpenAI-compat) configurado via ambiente.
 */
const validateAIApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    if (!req.user?.companyId) {
      return res.status(401).json({
        error: "ERR_UNAUTHORIZED",
        message: "Usuário não autenticado"
      });
    }

    const available = await AIProviderFactory.getAvailableProviders(req.user.companyId);
    if (!available.openai && !available.gemini) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message:
          "Nenhum provider de IA configurado. Configure LM Studio no servidor e/ou a chave Gemini em Configurações → Inteligência Artificial."
      });
    }

    next();
  } catch (err: any) {
    return res.status(500).json({
      error: "ERR_VALIDATE_AI_KEY",
      message: err.message || "Erro ao validar configuração de IA"
    });
  }
};

export default validateAIApiKey;
