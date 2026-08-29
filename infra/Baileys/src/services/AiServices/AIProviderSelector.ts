import { IAIProvider } from "./AIProviderInterface";
import { AIProviderFactory } from "./AIProviderFactory";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";

export type AIFunctionType =
  | "summaries"
  | "chat"
  | "messageImprovement"
  | "transcription"
  | "campaigns";

const ALL_FUNCTIONS: AIFunctionType[] = [
  "summaries",
  "chat",
  "messageImprovement",
  "transcription",
  "campaigns"
];

const settingKeyForFunction = (functionType: AIFunctionType): string =>
  `aiProvider_${functionType}`;

type AIProviderName = "openai" | "gemini";

const normalizeProviderName = (value?: string | null): AIProviderName | null => {
  const v = (value || "").toLowerCase();
  if (v === "gemini" || v === "openai") return v;
  return null;
};

const resolveConfiguredProvider = async (
  companyId: number,
  functionType: AIFunctionType,
  available: { gemini: boolean; openai: boolean },
  overrideProvider?: string | null
): Promise<AIProviderName> => {
  const override = normalizeProviderName(overrideProvider);
  if (override) {
    if (functionType === "transcription") {
      if (available.openai) return "openai";
      throw new AppError(
        "Transcrição indisponível: configure LM_STUDIO_BASE_URL/WHISPER_API_BASE_URL no backend.",
        400
      );
    }
    if (override === "gemini" && available.gemini) return "gemini";
    if (override === "openai" && available.openai) return "openai";
    if (available.openai) return "openai";
    if (available.gemini) return "gemini";
    throw new AppError(
      `Provider '${override}' indisponível. Verifique LM_STUDIO_BASE_URL e/ou GEMINI_API_KEY.`,
      400
    );
  }

  const persisted = await Setting.findOne({
    where: {
      companyId,
      key: settingKeyForFunction(functionType)
    }
  });

  const preferred = (persisted?.value || "openai").toLowerCase() as AIProviderName;

  if (functionType === "transcription") {
    if (available.openai) return "openai";
    throw new AppError(
      "Transcrição indisponível: configure LM_STUDIO_BASE_URL/WHISPER_API_BASE_URL no backend.",
      400
    );
  }

  if (preferred === "gemini" && available.gemini) return "gemini";
  if (preferred === "openai" && available.openai) return "openai";
  if (available.openai) return "openai";
  if (available.gemini) return "gemini";

  throw new AppError(
    "Nenhum provider de IA configurado. Defina LM_STUDIO_BASE_URL e/ou GEMINI_API_KEY no backend.",
    400
  );
};

/**
 * Seleciona provider por função (Settings) com fallback e override opcional (ex.: prompt.provider).
 */
export class AIProviderSelector {
  static async getProvider(
    companyId: number,
    functionType: AIFunctionType,
    overrideProvider?: string | null
  ): Promise<IAIProvider> {
    const available = await AIProviderFactory.getAvailableProviders(companyId);
    const providerName = await resolveConfiguredProvider(
      companyId,
      functionType,
      available,
      overrideProvider
    );
    if (providerName === "gemini") {
      return AIProviderFactory.createGeminiProvider(companyId);
    }
    return AIProviderFactory.createOpenAIProvider(companyId);
  }

  static async getProviderName(
    companyId: number,
    functionType: AIFunctionType,
    overrideProvider?: string | null
  ): Promise<AIProviderName> {
    const available = await AIProviderFactory.getAvailableProviders(companyId);
    return resolveConfiguredProvider(
      companyId,
      functionType,
      available,
      overrideProvider
    );
  }

  static async getProviderConfigurations(companyId: number): Promise<{
    available: { gemini: boolean; openai: boolean };
    configured: Record<AIFunctionType, AIProviderName>;
  }> {
    const available = await AIProviderFactory.getAvailableProviders(companyId);
    const configured = {} as Record<AIFunctionType, AIProviderName>;
    for (const ft of ALL_FUNCTIONS) {
      configured[ft] = await resolveConfiguredProvider(companyId, ft, available);
    }
    return {
      available,
      configured
    };
  }
}
