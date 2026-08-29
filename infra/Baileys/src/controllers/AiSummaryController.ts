import { Request, Response } from "express";
import AgentSummaryGeminiService from "../services/ReportService/AgentSummaryGeminiService";
import ChatGeminiService from "../services/AiServices/ChatGeminiService";
import { AIProviderSelector } from "../services/AiServices/AIProviderSelector";
import DashboardCommandService from "../services/AiServices/DashboardCommandService";
import Setting from "../models/Setting";
import { AIProviderFactory } from "../services/AiServices/AIProviderFactory";
import TestOpenAIApiKeyService from "../services/AiServices/TestOpenAIApiKeyService";
import TestGeminiApiKeyService from "../services/AiServices/TestGeminiApiKeyService";
import {
  getGeminiKeySource,
  isGeminiConfiguredForCompany
} from "../services/AiServices/GeminiApiKeyService";

export const agentSummary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { agentId, dateStart, dateEnd, maxMessages } = req.body;

    // agentId é opcional - se não fornecido, gera resumo geral
    let agentIdNumber: number | undefined = undefined;
    
    if (agentId) {
      agentIdNumber = Number(agentId);
      if (isNaN(agentIdNumber)) {
        return res.status(400).json({ error: "agentId inválido" });
      }
    }

    const summary = await AgentSummaryGeminiService({
      companyId,
      agentId: agentIdNumber,
      dateStart,
      dateEnd,
      maxMessages
    });

    return res.status(200).json(summary);
  } catch (err: any) {
    console.error("Erro ao gerar resumo IA:", err);
    
    if (err.message === "GEMINI_KEY_MISSING" || err.message === "AI_NOT_CONFIGURED") {
      return res.status(400).json({ error: "AI_NOT_CONFIGURED" });
    }

    return res.status(500).json({
      error: "ERR_AI_SUMMARY",
      message: err.message || "Erro ao gerar resumo com IA"
    });
  }
};

export const chat = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId, id } = req.user;
    const { message, conversationHistory, articles } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Mensagem é obrigatória" });
    }

    const response = await ChatGeminiService({
      companyId,
      userId: Number(id),
      message: message.trim(),
      conversationHistory: conversationHistory || [],
      articles: articles || []
    });

    return res.status(200).json(response);
  } catch (err: any) {
    console.error("Erro no chat IA:", err);
    
    if (err.message === "GEMINI_KEY_MISSING" || err.message === "AI_NOT_CONFIGURED") {
      return res.status(400).json({ error: "AI_NOT_CONFIGURED" });
    }

    return res.status(500).json({
      error: "ERR_AI_CHAT",
      message: err.message || "Erro ao processar mensagem com IA"
    });
  }
};


export const dashboardCommand = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId, id } = req.user;
    const { command } = req.body;

    if (!command || !String(command).trim()) {
      return res.status(400).json({ error: "Comando e obrigatorio" });
    }

    const result = await DashboardCommandService({
      companyId,
      userId: Number(id),
      command: String(command).trim()
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao executar comando IA do dashboard:", err);

    if (err.message === "GEMINI_KEY_MISSING" || err.message === "AI_NOT_CONFIGURED") {
      return res.status(400).json({ error: "AI_NOT_CONFIGURED" });
    }

    return res.status(500).json({
      error: "ERR_AI_DASHBOARD_COMMAND",
      message: err.message || "Erro ao executar comando do dashboard"
    });
  }
};

export const chatWithAudio = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId, id } = req.user;
    const { conversationHistory } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Arquivo de áudio é obrigatório" });
    }

    // Transcrever áudio
    const provider = await AIProviderSelector.getProvider(companyId, "transcription");
    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || "audio/webm";

    console.log(`🎤 Transcrevendo áudio do chat interno (${(audioBuffer.length / 1024).toFixed(2)}KB)...`);
    
    const transcription = await provider.transcribeAudio(
      audioBuffer,
      mimeType,
      { prompt: undefined }
    );

    if (!transcription || transcription.trim() === "") {
      return res.status(400).json({ 
        error: "ERR_AI_TRANSCRIPTION_EMPTY",
        message: "Não foi possível transcrever o áudio. Tente novamente."
      });
    }

    console.log(`✅ Transcrição: "${transcription}"`);

    // Processar a transcrição como uma mensagem normal do chat
    const response = await ChatGeminiService({
      companyId,
      userId: Number(id),
      message: transcription.trim(),
      conversationHistory: conversationHistory || [],
      articles: []
    });

    return res.status(200).json({
      ...response,
      transcription: transcription.trim()
    });
  } catch (err: any) {
    console.error("Erro no chat com áudio:", err);
    
    if (
      err.message === "GEMINI_KEY_MISSING" ||
      err.message === "AI_NOT_CONFIGURED" ||
      err.message?.includes("API Key")
    ) {
      return res.status(400).json({ error: "AI_NOT_CONFIGURED" });
    }
    
    return res.status(500).json({ 
      error: "ERR_AI_CHAT_AUDIO",
      message: err.message || "Erro ao processar áudio com IA"
    });
  }
};

/**
 * Obtém configurações de providers de IA
 */
export const getProviderConfigurations = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;

    const config = await AIProviderSelector.getProviderConfigurations(companyId);

    return res.status(200).json(config);
  } catch (err: any) {
    console.error("Erro ao obter configurações de providers:", err);
    return res.status(500).json({ 
      error: "ERR_GET_PROVIDER_CONFIG",
      message: err.message || "Erro ao obter configurações de providers"
    });
  }
};

/**
 * Define configuração de provider para uma funcionalidade
 */
export const setProviderConfiguration = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { functionType, provider } = req.body;

    if (!functionType || !provider) {
      return res.status(400).json({ 
        error: "functionType e provider são obrigatórios" 
      });
    }

    if (!["summaries", "chat", "messageImprovement", "transcription", "campaigns"].includes(functionType)) {
      return res.status(400).json({ 
        error: "functionType inválido" 
      });
    }

    if (!["gemini", "openai"].includes(provider)) {
      return res.status(400).json({
        error: "provider inválido"
      });
    }
    const available = await AIProviderFactory.getAvailableProviders(companyId);
    if (provider === "gemini" && !available.gemini) {
      return res.status(400).json({
        error: "provider indisponível",
        message:
          "Gemini não configurado. Informe a chave em Configurações → Inteligência Artificial."
      });
    }
    if (provider === "openai" && !available.openai) {
      return res.status(400).json({
        error: "provider indisponível",
        message: "LM Studio não configurado. Defina LM_STUDIO_BASE_URL no backend."
      });
    }
    if (functionType === "transcription" && provider === "gemini") {
      return res.status(400).json({
        error: "provider inválido",
        message: "Transcrição suporta apenas provider OpenAI/LM Studio/Whisper."
      });
    }

    const key = `aiProvider_${functionType}`;
    const existing = await Setting.findOne({ where: { companyId, key } });
    if (existing) {
      await existing.update({ value: provider });
    } else {
      await Setting.create({ companyId, key, value: provider });
    }

    return res.status(200).json({
      success: true,
      functionType,
      provider,
      message: "Configuração de provider atualizada com sucesso."
    });
  } catch (err: any) {
    console.error("Erro ao configurar provider:", err);
    return res.status(500).json({ 
      error: "ERR_SET_PROVIDER_CONFIG",
      message: err.message || "Erro ao configurar provider"
    });
  }
};

/**
 * Status de disponibilidade e teste rápido dos providers (env do servidor).
 */
export const getProvidersStatus = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const available = await AIProviderFactory.getAvailableProviders(companyId);
    const config = await AIProviderSelector.getProviderConfigurations(companyId);

    let openaiTest = { valid: false, message: "LM Studio não configurado." };
    let geminiTest = { valid: false, message: "Gemini não configurado." };

    if (available.openai) {
      openaiTest = await TestOpenAIApiKeyService({ companyId });
    }
    if (available.gemini) {
      geminiTest = await TestGeminiApiKeyService({ companyId });
    }

    const geminiKeySource = await getGeminiKeySource(companyId);

    return res.status(200).json({
      available,
      configured: config.configured,
      geminiKeyConfigured: await isGeminiConfiguredForCompany(companyId),
      geminiKeySource,
      tests: {
        openai: openaiTest,
        gemini: geminiTest
      }
    });
  } catch (err: any) {
    console.error("Erro ao obter status dos providers:", err);
    return res.status(500).json({
      error: "ERR_GET_PROVIDER_STATUS",
      message: err.message || "Erro ao obter status dos providers"
    });
  }
};

/**
 * Testa chave Gemini (corpo opcional apiKey; senão usa a salva na empresa ou env).
 */
export const testGeminiApiKey = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { apiKey } = req.body as { apiKey?: string };
    const result = await TestGeminiApiKeyService({ companyId, apiKey });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao testar chave Gemini:", err);
    return res.status(500).json({
      error: "ERR_TEST_GEMINI_KEY",
      message: err.message || "Erro ao testar chave Gemini"
    });
  }
};

/**
 * Obtém configurações do chat IA
 */
export const getChatConfig = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { getChatConfig: loadChatConfig } = await import("../services/AiServices/ChatConfigService");
    const config = await loadChatConfig(companyId);
    return res.status(200).json(config);
  } catch (err: any) {
    console.error("Erro ao obter configurações do chat:", err);
    return res.status(500).json({ 
      error: "ERR_GET_CHAT_CONFIG",
      message: err.message || "Erro ao obter configurações do chat"
    });
  }
};


