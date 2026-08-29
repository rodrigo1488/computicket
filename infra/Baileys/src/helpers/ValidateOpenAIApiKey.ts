import AppError from "../errors/AppError";
import { getLmStudioApiKey, isAiBackendConfigured } from "../config/openai";
import {
  getCompanyGeminiApiKey,
  isGeminiConfiguredForCompany
} from "../services/AiServices/GeminiApiKeyService";

/**
 * Garante que pelo menos um backend de IA está configurado via ambiente.
 * Não lê mais openaiApiKey por empresa.
 */
export const validateCompanyOpenAIApiKey = async (
  companyId: number
): Promise<string> => {
  if (isAiBackendConfigured()) {
    return getLmStudioApiKey();
  }
  if (await isGeminiConfiguredForCompany(companyId)) {
    return getCompanyGeminiApiKey(companyId);
  }
  throw new AppError(
    "Nenhum provider de IA configurado. Configure LM Studio no servidor e/ou a chave Gemini em Configurações.",
    400
  );
};
