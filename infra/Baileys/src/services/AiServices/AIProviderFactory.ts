import { OpenAIProvider } from "./providers/OpenAIProvider";
import { isAiBackendConfigured } from "../../config/openai";
import { isGeminiConfiguredForCompany } from "./GeminiApiKeyService";
import AppError from "../../errors/AppError";
import { GeminiProvider } from "./providers/GeminiProvider";

/**
 * Factory para o cliente OpenAI-compatível (LM Studio), configurado globalmente via ambiente.
 */
export class AIProviderFactory {
  /**
   * Cria instância do provider (LM Studio). companyId é ignorado — mantido só por compatibilidade de chamadas.
   */
  static async createOpenAIProvider(_companyId?: number): Promise<OpenAIProvider> {
    if (!isAiBackendConfigured()) {
      throw new AppError(
        "Servidor de IA não configurado. Defina LM_STUDIO_BASE_URL no ambiente do backend.",
        400
      );
    }
    return new OpenAIProvider();
  }

  static async createGeminiProvider(companyId?: number): Promise<GeminiProvider> {
    if (!companyId || !(await isGeminiConfiguredForCompany(companyId))) {
      throw new AppError(
        "Gemini não configurado. Informe a chave em Configurações → Inteligência Artificial ou defina GEMINI_API_KEY no servidor.",
        400
      );
    }
    return new GeminiProvider(companyId);
  }

  /**
   * Disponibilidade de IA: apenas LM Studio (openai-compat). gemini permanece false para compatibilidade de tipos legados.
   */
  static async getAvailableProviders(companyId?: number): Promise<{
    gemini: boolean;
    openai: boolean;
  }> {
    const openai = isAiBackendConfigured();
    const gemini =
      companyId != null
        ? await isGeminiConfiguredForCompany(companyId)
        : false;
    return {
      gemini,
      openai
    };
  }
}
