import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Prompt from "../../models/Prompt";
import ShowPromptService from "./ShowPromptService";
import { getLmStudioDefaultModel, isAiBackendConfigured } from "../../config/openai";
import { getGeminiDefaultModel } from "../../config/gemini";
import { isGeminiConfiguredForCompany } from "../AiServices/GeminiApiKeyService";

interface PromptData {
    id?: number;
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

interface Request {
    promptData: PromptData;
    promptId: string | number;
    companyId: string | number;
}

const UpdatePromptService = async ({
    promptId,
    promptData,
    companyId
}: Request): Promise<Prompt | undefined> => {
    const companyIdNumber =
      typeof companyId === "string" ? parseInt(companyId, 10) : companyId;

    const promptTable = await ShowPromptService({ promptId: promptId, companyId });

    const rawProv = promptData.provider || promptTable.provider || "openai";
    const provider = String(rawProv).toLowerCase();

    // Validação baseada no provider (queueId agora é opcional)
    const promptSchema = Yup.object().shape({
        name: Yup.string().required("ERR_PROMPT_NAME_INVALID"),
        prompt: Yup.string().required("ERR_PROMPT_PROMPT_INVALID"),
        queueId: Yup.number().nullable(),
        maxMessages: Yup.number().required("ERR_PROMPT_MAX_MESSAGES_INVALID"),
        provider: Yup.string().oneOf(["openai", "gemini"], "ERR_PROMPT_PROVIDER_INVALID")
    });

    // Não exigir apiKey no prompt - será buscada das Settings
    const { name, prompt, maxTokens, temperature, promptTokens, completionTokens, totalTokens, queueId, maxMessages, model, canSendInternalMessages, canTransferToAgent, canChangeTag, permitirCriarAgendamentos, tipoAgente, isTemplate, templateVariables, transferQueueId, businessHours } = promptData;

    try {
        await promptSchema.validate({ name, prompt, maxTokens, temperature, promptTokens, completionTokens, totalTokens, queueId, maxMessages, provider });
    } catch (err) {
        throw new AppError(`${JSON.stringify(err, undefined, 2)}`);
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
      model || (provider === "gemini" ? getGeminiDefaultModel() : getLmStudioDefaultModel());

    const updateData: any = {
        name,
        prompt,
        maxTokens,
        temperature,
        promptTokens,
        completionTokens,
        totalTokens,
        queueId,
        maxMessages,
        model: finalModel,
        provider,
        canSendInternalMessages: canSendInternalMessages !== undefined ? canSendInternalMessages : false,
        canTransferToAgent: canTransferToAgent !== undefined ? canTransferToAgent : false,
        canChangeTag: canChangeTag !== undefined ? canChangeTag : false,
        permitirCriarAgendamentos: permitirCriarAgendamentos !== undefined ? permitirCriarAgendamentos : false,
        tipoAgente: tipoAgente !== undefined ? tipoAgente : promptTable.tipoAgente || "personalizado",
        isTemplate: isTemplate !== undefined ? isTemplate : promptTable.isTemplate || false,
        templateVariables: templateVariables !== undefined ? templateVariables : promptTable.templateVariables,
        transferQueueId: transferQueueId || null,
        businessHours: businessHours !== undefined ? businessHours : promptTable.businessHours,
        // Sempre definir apiKey como string vazia - será buscada das Settings
        apiKey: ""
    };

    await promptTable.update(updateData);
    await promptTable.reload();
    return promptTable;
};

export default UpdatePromptService;
