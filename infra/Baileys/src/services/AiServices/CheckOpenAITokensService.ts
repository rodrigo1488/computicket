import {
  createOpenAIClient,
  getLmStudioDefaultModel,
  isAiBackendConfigured
} from "../../config/openai";
import { logger } from "../../utils/logger";

export interface OpenAITokenInfo {
  available: boolean;
  tokensUsed?: number;
  tokensRemaining?: number;
  tokensTotal?: number;
  quotaExceeded?: boolean;
  error?: string;
}

/**
 * Verifica se o servidor LM Studio (OpenAI-compat) responde.
 * companyId é ignorado — a IA é global no ambiente.
 */
const CheckOpenAITokensService = async (
  _companyId: number
): Promise<OpenAITokenInfo> => {
  try {
    if (!isAiBackendConfigured()) {
      return {
        available: false,
        error: "LM_STUDIO_BASE_URL não definido no servidor"
      };
    }

    try {
      const openai = createOpenAIClient();
      const completion = await openai.createChatCompletion({
        model: getLmStudioDefaultModel(),
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1
      });

      const usage = completion.data.usage;
      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;
      const totalTokens =
        usage?.total_tokens || promptTokens + completionTokens;

      return {
        available: true,
        tokensUsed: totalTokens,
        tokensRemaining: undefined,
        tokensTotal: undefined
      };
    } catch (error: any) {
      if (error.response?.status === 429) {
        return {
          available: false,
          quotaExceeded: false,
          error: "Limite de requisições no servidor de IA"
        };
      }
      if (error.response?.status === 401) {
        return {
          available: false,
          error: "Acesso negado ao servidor de IA"
        };
      }
      return {
        available: false,
        error:
          error.response?.data?.error?.message ||
          error.message ||
          "Erro ao contatar servidor de IA"
      };
    }
  } catch (error: any) {
    logger.error("Erro ao verificar servidor de IA (LM Studio):", error);
    return {
      available: false,
      error: error.message || "Erro desconhecido"
    };
  }
};

export default CheckOpenAITokensService;
