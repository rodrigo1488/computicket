import {
  callGeminiGenerateContent,
  getGeminiDefaultModel
} from "../../config/gemini";
import {
  getCompanyGeminiApiKey,
  isGeminiConfiguredForCompany
} from "./GeminiApiKeyService";

interface TestGeminiApiKeyParams {
  companyId: number;
  apiKey?: string;
}

interface TestGeminiApiKeyResponse {
  valid: boolean;
  message: string;
}

const TestGeminiApiKeyService = async ({
  companyId,
  apiKey
}: TestGeminiApiKeyParams): Promise<TestGeminiApiKeyResponse> => {
  const keyToTest = apiKey?.trim() || (await getCompanyGeminiApiKey(companyId));

  if (!keyToTest) {
    return {
      valid: false,
      message:
        "Informe a chave da API Gemini em Configurações ou defina GEMINI_API_KEY no servidor."
    };
  }

  try {
    const data = await callGeminiGenerateContent(
      {
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 8, temperature: 0 }
      },
      getGeminiDefaultModel(),
      keyToTest
    );
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "";
    if (!text.trim()) {
      return {
        valid: false,
        message: "Gemini respondeu, mas sem conteúdo válido. Verifique o modelo padrão."
      };
    }
    return {
      valid: true,
      message: "Gemini respondeu com sucesso."
    };
  } catch (err: any) {
    return {
      valid: false,
      message: err?.message || "Não foi possível contatar a API do Gemini."
    };
  }
};

export const isGeminiAvailableForCompany = isGeminiConfiguredForCompany;

export default TestGeminiApiKeyService;
