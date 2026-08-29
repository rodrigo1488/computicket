import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Prompt from "../../models/Prompt";
import ShowPromptService from "./ShowPromptService";
import { getLmStudioDefaultModel, isAiBackendConfigured } from "../../config/openai";
import { getGeminiDefaultModel } from "../../config/gemini";
import { isGeminiConfiguredForCompany } from "../AiServices/GeminiApiKeyService";

interface PromptData {
    name: string;
    apiKey?: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    queueId?: number;
    maxMessages?: number;
    companyId: string | number;
    model: string;
    provider?: string;
    canSendInternalMessages?: boolean;
    canTransferToAgent?: boolean;
    canChangeTag?: boolean;
    permitirCriarAgendamentos?: boolean;
    tipoAgente?: string;
    isTemplate?: boolean;
    templateVariables?: string;
    transferQueueId?: number | null;
    businessHours?: any;
}

const CreatePromptService = async (promptData: PromptData): Promise<Prompt> => {
    // Garantir que companyId seja number
    const companyIdNumber = typeof promptData.companyId === "string" ? parseInt(promptData.companyId, 10) : promptData.companyId;

    if (isNaN(companyIdNumber)) {
        throw new AppError("companyId inválido", 400);
    }

    // Desestruturar dados do prompt
    const { name, prompt, queueId, maxMessages, provider: rawProvider = "openai" } = promptData;
    const provider = (rawProvider || "openai").toLowerCase();

    // Garantir que queueId e maxMessages sejam números (queueId agora é opcional)
    const queueIdNumber = queueId ? (typeof queueId === "string" ? parseInt(queueId, 10) : queueId) : null;
    const maxMessagesNumber = maxMessages ? (typeof maxMessages === "string" ? parseInt(maxMessages, 10) : maxMessages) : 10;

    // Validação baseada no provider (queueId agora é opcional)
    const promptSchema = Yup.object().shape({
        name: Yup.string().required("ERR_PROMPT_NAME_INVALID"),
        prompt: Yup.string().required("ERR_PROMPT_INTELLIGENCE_INVALID"),
        queueId: Yup.number().nullable(),
        maxMessages: Yup.number().required("ERR_PROMPT_MAX_MESSAGES_INVALID"),
        companyId: Yup.number().required("ERR_PROMPT_companyId_INVALID"),
        provider: Yup.string().oneOf(["openai", "gemini"], "ERR_PROMPT_PROVIDER_INVALID")
    });

    // Não exigir apiKey no prompt - será buscada das Settings
    try {
        await promptSchema.validate({
            name,
            prompt,
            queueId: queueIdNumber,
            maxMessages: maxMessagesNumber,
            companyId: companyIdNumber,
            provider
        });
    } catch (err: any) {
        console.error("Erro na validação do prompt:", err);
        throw new AppError(`Erro de validação: ${err.message || JSON.stringify(err, undefined, 2)}`, 400);
    }

    if (provider === "openai" && !isAiBackendConfigured()) {
        throw new AppError(
            "Servidor de IA não configurado. Defina LM_STUDIO_BASE_URL no ambiente do backend.",
            400
        );
    }
    if (provider === "gemini" && !(await isGeminiConfiguredForCompany(companyIdNumber))) {
        throw new AppError(
            "Gemini não configurado. Informe a chave em Configurações → Inteligência Artificial.",
            400
        );
    }

    const finalModel =
      promptData.model ||
      (provider === "gemini" ? getGeminiDefaultModel() : getLmStudioDefaultModel());

    // Criar objeto de dados para salvar, sempre com apiKey como string vazia
    const promptToCreate: any = {
        name: promptData.name,
        prompt: promptData.prompt,
        queueId: queueIdNumber,
        maxMessages: maxMessagesNumber,
        maxTokens: promptData.maxTokens || 100,
        temperature: promptData.temperature || 1,
        promptTokens: promptData.promptTokens || 0,
        completionTokens: promptData.completionTokens || 0,
        totalTokens: promptData.totalTokens || 0,
        model: finalModel,
        provider,
        companyId: companyIdNumber,
        apiKey: "", // Sempre string vazia - será buscada das Settings
        canSendInternalMessages: promptData.canSendInternalMessages || false,
        canTransferToAgent: promptData.canTransferToAgent || false,
        canChangeTag: promptData.canChangeTag || false,
        permitirCriarAgendamentos: promptData.permitirCriarAgendamentos || false,
        tipoAgente: promptData.tipoAgente || "personalizado",
        isTemplate: promptData.isTemplate || false,
        templateVariables: promptData.templateVariables || null,
        transferQueueId: promptData.transferQueueId || null,
        businessHours: promptData.businessHours || null
    };

    try {
        console.log("Criando prompt com dados:", {
            name: promptToCreate.name,
            provider: promptToCreate.provider,
            companyId: promptToCreate.companyId,
            queueId: promptToCreate.queueId,
            apiKey: promptToCreate.apiKey ? "***" : "(vazio)"
        });

        let promptTable = await Prompt.create(promptToCreate);
        console.log("Prompt criado com sucesso, ID:", promptTable.id);

        promptTable = await ShowPromptService({ promptId: promptTable.id, companyId: companyIdNumber });
        return promptTable;
    } catch (err: any) {
        console.error("Erro ao criar prompt no banco:", {
            message: err.message,
            errors: err.errors,
            stack: err.stack
        });
        throw new AppError(`Erro ao criar prompt: ${err.message || "Erro desconhecido"}`, 500);
    }
};

export default CreatePromptService;
