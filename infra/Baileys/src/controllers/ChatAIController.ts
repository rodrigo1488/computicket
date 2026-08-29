import { Request, Response } from "express";
import {
  analyzeChatContext,
  summarizeUnreadAudios,
  improveMessage,
  generateTicketInfo,
  applyChatModelReplyActions
} from "../services/AiServices/ChatAIService";
import transcribeAndPersistAudioMessage from "../services/AiServices/TranscribeAndPersistAudioService";
import AppError from "../errors/AppError";

export const analyze = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { ticketId, question, suggestResponse } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    const result = await analyzeChatContext({
      ticketId: Number(ticketId),
      companyId,
      question,
      suggestResponse: Boolean(suggestResponse)
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao analisar chat:", err);
    
    if (
      err.message?.includes("LM_STUDIO") ||
      err.message?.includes("Servidor de IA não configurado")
    ) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message
      });
    }
    if (err.message?.includes("API Key") || err.message?.includes("GEMINI_KEY") || err.message?.includes("OPENAI")) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message || "IA não configurada no servidor"
      });
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao analisar chat"
      });
    }

    return res.status(500).json({
      error: "ERR_CHAT_AI_ANALYZE",
      message: err.message || "Erro ao analisar chat com IA"
    });
  }
};

export const audioSummary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { ticketId } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    const result = await summarizeUnreadAudios({
      ticketId: Number(ticketId),
      companyId
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao resumir áudios:", err);
    
    if (
      err.message?.includes("LM_STUDIO") ||
      err.message?.includes("Servidor de IA não configurado")
    ) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message
      });
    }
    if (err.message?.includes("API Key") || err.message?.includes("GEMINI_KEY") || err.message?.includes("OPENAI")) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message || "IA não configurada no servidor"
      });
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao resumir áudios"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_AUDIO_SUMMARY",
      message: err.message || "Erro ao resumir áudios com IA"
    });
  }
};

export const improve = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId, id: userId } = req.user;
    const { ticketId, draftText } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    console.log(`[ChatAIController] Melhorando mensagem - ticketId: ${ticketId}, companyId: ${companyId}, draftText length: ${draftText?.length || 0}`);

    const result = await improveMessage({
      ticketId: Number(ticketId),
      companyId,
      draftText: draftText || ""
    });

    console.log(
      `[ChatAIController] Mensagem melhorada com sucesso - improvedText length: ${result.improvedText?.length || 0}, userId: ${userId}`
    );

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[ChatAIController] Erro ao melhorar mensagem:", err);
    console.error("[ChatAIController] Stack trace:", err.stack);
    
    if (
      err.message?.includes("LM_STUDIO") ||
      err.message?.includes("Servidor de IA não configurado")
    ) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message
      });
    }
    if (err.message?.includes("API Key") || err.message?.includes("GEMINI_KEY") || err.message?.includes("OPENAI")) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message || "IA não configurada no servidor"
      });
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao melhorar mensagem"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_IMPROVE",
      message: err.message || "Erro ao melhorar mensagem com IA"
    });
  }
};

export const applyReplyActions = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId, id: userId } = req.user;
    const { ticketId, modelReply } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }
    if (!modelReply || !String(modelReply).trim()) {
      return res.status(400).json({ error: "modelReply é obrigatório" });
    }

    const result = await applyChatModelReplyActions({
      ticketId: Number(ticketId),
      companyId,
      userId: Number(userId),
      modelReply: String(modelReply)
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[ChatAIController] Erro ao aplicar ações da resposta:", err);

    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "ERR_CHAT_AI_APPLY_ACTIONS"
      });
    }

    return res.status(500).json({
      error: "ERR_CHAT_AI_APPLY_ACTIONS",
      message: err.message || "Erro ao aplicar ações"
    });
  }
};

export const transcribe = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { messageId } = req.params;

    if (!messageId) {
      return res.status(400).json({ error: "messageId é obrigatório" });
    }

    const force =
      Boolean((req.body as { force?: boolean })?.force) ||
      String((req.query as { force?: string })?.force || "") === "1";

    const result = await transcribeAndPersistAudioMessage({
      messageId,
      companyId,
      force
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Erro ao transcrever áudio:", err);
    
    if (err.message?.includes("GEMINI_KEY") || err.message?.includes("Chave da API") || err.message === "ERR_AI_CONFIG_MISSING") {
      return res.status(400).json({ error: "ERR_AI_CONFIG_MISSING" });
    }
    
    if (err instanceof AppError) {
      // Usar código de erro para o frontend exibir mensagem amigável via i18n
      const errorCode = err.message?.startsWith("ERR_") ? err.message.split(":")[0] : null;
      return res.status(err.statusCode || 500).json({
        error: errorCode || err.message || "ERR_CHAT_AI_TRANSCRIBE"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_TRANSCRIBE",
      message: err.message || "Erro ao transcrever áudio com IA"
    });
  }
};

export const generateTicket = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { ticketId } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId é obrigatório" });
    }

    console.log(`[ChatAIController] Gerando informações do ticket - ticketId: ${ticketId}, companyId: ${companyId}`);

    const result = await generateTicketInfo({
      ticketId: Number(ticketId),
      companyId
    });

    console.log(`[ChatAIController] Informações do ticket geradas com sucesso`);

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[ChatAIController] Erro ao gerar informações do ticket:", err);
    console.error("[ChatAIController] Stack trace:", err.stack);
    
    if (
      err.message?.includes("LM_STUDIO") ||
      err.message?.includes("Servidor de IA não configurado")
    ) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message
      });
    }
    if (err.message?.includes("API Key") || err.message?.includes("GEMINI_KEY") || err.message?.includes("OPENAI")) {
      return res.status(400).json({
        error: "AI_NOT_CONFIGURED",
        message: err.message || "IA não configurada no servidor"
      });
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Erro ao gerar informações do ticket"
      });
    }
    
    return res.status(500).json({
      error: "ERR_CHAT_AI_GENERATE_TICKET",
      message: err.message || "Erro ao gerar informações do ticket com IA"
    });
  }
};
