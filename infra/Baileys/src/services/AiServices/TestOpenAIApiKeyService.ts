import { isAiBackendConfigured, testLmStudioConnection } from "../../config/openai";

interface TestOpenAIApiKeyParams {
  companyId: number;
}

interface TestOpenAIApiKeyResponse {
  valid: boolean;
  message: string;
}

/**
 * Testa conectividade com o LM Studio (OpenAI-compat) configurado no ambiente.
 * companyId é ignorado.
 */
const TestOpenAIApiKeyService = async ({
  companyId: _companyId
}: TestOpenAIApiKeyParams): Promise<TestOpenAIApiKeyResponse> => {
  if (!isAiBackendConfigured()) {
    return {
      valid: false,
      message:
        "LM_STUDIO_BASE_URL não definido no ambiente do servidor. Peça ao administrador para configurar."
    };
  }

  const ok = await testLmStudioConnection();
  if (!ok) {
    return {
      valid: false,
      message:
        "Não foi possível contatar o servidor de IA (LM Studio). Verifique se está em execução e se o modelo está carregado."
    };
  }

  return {
    valid: true,
    message: "Servidor de IA (LM Studio) respondeu com sucesso."
  };
};

export default TestOpenAIApiKeyService;
