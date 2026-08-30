import axios from "axios";

const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL?.trim() ||
  "https://generativelanguage.googleapis.com";

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1beta";

/** Modelo atual recomendado pela API Google AI (jul/2026+). */
const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";

/** Nomes legados / descontinuados → ID atual. */
const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "gemini-1.5-flash": GEMINI_FALLBACK_MODEL,
  "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
  "gemini-1.5-pro": GEMINI_FALLBACK_MODEL,
  "gemini-1.5-pro-latest": GEMINI_FALLBACK_MODEL,
  "gemini-2.0-flash": GEMINI_FALLBACK_MODEL,
  "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-flash": GEMINI_FALLBACK_MODEL,
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": GEMINI_FALLBACK_MODEL,
  "gemini-pro": GEMINI_FALLBACK_MODEL
};

export const getGeminiApiKey = (): string => process.env.GEMINI_API_KEY?.trim() || "";

export const isGeminiConfigured = (): boolean => getGeminiApiKey().length > 0;

export const getGeminiDefaultModel = (): string =>
  process.env.GEMINI_DEFAULT_MODEL?.trim() || GEMINI_FALLBACK_MODEL;

/**
 * Normaliza o ID do modelo para um nome aceito pela API generateContent.
 */
export const resolveGeminiModel = (model?: string): string => {
  const raw = (model || getGeminiDefaultModel()).trim();
  if (!raw) {
    return GEMINI_FALLBACK_MODEL;
  }
  const bare = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
  const key = bare.toLowerCase();
  return GEMINI_MODEL_ALIASES[key] || bare;
};

export const getGeminiApiUrl = (model?: string): string => {
  const targetModel = resolveGeminiModel(model);
  const base = GEMINI_BASE_URL.replace(/\/+$/, "");
  return `${base}/${GEMINI_API_VERSION}/models/${targetModel}:generateContent`;
};

export const callGeminiGenerateContent = async (
  payload: Record<string, any>,
  model?: string,
  apiKeyOverride?: string
): Promise<any> => {
  const apiKey = (apiKeyOverride || getGeminiApiKey()).trim();
  if (!apiKey) {
    throw new Error("GEMINI_KEY_MISSING");
  }

  const url = getGeminiApiUrl(model);
  const { data } = await axios.post(url, payload, {
    headers: {
      "Content-Type": "application/json"
    },
    params: {
      key: apiKey
    },
    timeout: 300_000
  });
  return data;
};

export const interpretGeminiError = (error: any): string => {
  const status = error?.response?.status;
  const detail =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "";

  if (status === 401 || status === 403) {
    return "Acesso negado ao Gemini. Verifique GEMINI_API_KEY.";
  }
  if (status === 429) {
    return "Limite de requisições do Gemini atingido. Tente novamente em instantes.";
  }
  if (status === 404) {
    const hint = detail
      ? detail
      : "Modelo não encontrado na API. Use gemini-3.6-flash ou defina GEMINI_DEFAULT_MODEL=gemini-3.6-flash.";
    return hint;
  }
  if (status === 400) {
    return detail || "Requisição inválida para o Gemini.";
  }
  return detail || "Erro ao comunicar com Gemini.";
};
