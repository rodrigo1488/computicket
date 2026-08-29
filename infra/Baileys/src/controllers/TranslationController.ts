import { Request, Response } from "express";
import { TranslationService } from "../services/AiServices/TranslationService";
import Message from "../models/Message";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";

// Throttle de log para 429: evita encher o console quando a API de IA está no limite
const RATE_LIMIT_LOG_INTERVAL_MS = 60000; // 1 minuto
let lastRateLimitLogTime = 0;

/**
 * Traduz uma mensagem específica
 */
export const translateMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { messageId } = req.params;
    const { companyId } = req.user;
    const { targetLanguage } = req.body;

    // Validar messageId
    if (!messageId) {
      return res.status(400).json({ error: "messageId é obrigatório" });
    }

    // Buscar mensagem
    const message = await Message.findOne({
      where: {
        id: messageId,
        companyId
      }
    });

    if (!message) {
      return res.status(404).json({ error: "Mensagem não encontrada" });
    }

    // Obter idioma de destino (usar da empresa se não fornecido)
    let targetLang = targetLanguage;
    if (!targetLang) {
      targetLang = await TranslationService.getCompanyLanguage(companyId);
    }

    // Traduzir
    const result = await TranslationService.translateText({
      text: message.body,
      targetLanguage: targetLang,
      companyId
    });

    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 429) {
      const now = Date.now();
      if (now - lastRateLimitLogTime >= RATE_LIMIT_LOG_INTERVAL_MS) {
        lastRateLimitLogTime = now;
        logger.warn("Tradução: limite da API de IA (429). As requisições serão retentadas com backoff.");
      }
    } else {
      logger.error("Erro ao traduzir mensagem:", err);
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    return res.status(500).json({ 
      error: "Erro ao traduzir mensagem",
      message: err.message 
    });
  }
};

/**
 * Traduz múltiplas mensagens em batch (otimização de performance)
 */
export const translateMessagesBatch = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { messageIds, targetLanguage } = req.body;

    // Validações
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: "messageIds deve ser um array não vazio" });
    }

    // Limitar batch size para evitar sobrecarga
    const MAX_BATCH_SIZE = 20;
    const messageIdsToProcess = messageIds.slice(0, MAX_BATCH_SIZE);

    // Obter idioma de destino
    let targetLang = targetLanguage;
    if (!targetLang) {
      targetLang = await TranslationService.getCompanyLanguage(companyId);
    }

    // Buscar todas as mensagens de uma vez
    const messages = await Message.findAll({
      where: {
        id: messageIdsToProcess,
        companyId
      },
      attributes: ['id', 'body']
    });

    // Traduzir em paralelo (limitado para evitar sobrecarga)
    const translationPromises = messages.map(message => 
      TranslationService.translateText({
        text: message.body,
        targetLanguage: targetLang,
        companyId
      }).then(result => ({
        messageId: message.id,
        ...result
      })).catch(err => ({
        messageId: message.id,
        error: err.message || "Erro ao traduzir"
      }))
    );

    const results = await Promise.all(translationPromises);

    return res.status(200).json({ translations: results });
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 429) {
      const now = Date.now();
      if (now - lastRateLimitLogTime >= RATE_LIMIT_LOG_INTERVAL_MS) {
        lastRateLimitLogTime = now;
        logger.warn("Tradução em batch: limite da API de IA (429).");
      }
    } else {
      logger.error("Erro ao traduzir mensagens em batch:", err);
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    return res.status(500).json({ 
      error: "Erro ao traduzir mensagens em batch",
      message: err.message 
    });
  }
};

/**
 * Traduz um texto fornecido diretamente
 */
export const translateText = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { text, sourceLanguage, targetLanguage } = req.body;

    // Validações
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "text é obrigatório" });
    }

    // Obter idioma de destino (usar da empresa se não fornecido)
    let targetLang = targetLanguage;
    if (!targetLang) {
      targetLang = await TranslationService.getCompanyLanguage(companyId);
    }

    // Traduzir
    const result = await TranslationService.translateText({
      text,
      sourceLanguage,
      targetLanguage: targetLang,
      companyId
    });

    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 429) {
      const now = Date.now();
      if (now - lastRateLimitLogTime >= RATE_LIMIT_LOG_INTERVAL_MS) {
        lastRateLimitLogTime = now;
        logger.warn("Tradução de texto: limite da API de IA (429).");
      }
    } else {
      logger.error("Erro ao traduzir texto:", err);
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    return res.status(500).json({ 
      error: "Erro ao traduzir texto",
      message: err.message 
    });
  }
};

/**
 * Detecta o idioma de um texto
 */
export const detectLanguage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "text é obrigatório" });
    }

    const language = await TranslationService.detectLanguage(text, companyId);

    // Sempre retornar sucesso, mesmo que o idioma seja "unknown"
    return res.status(200).json({ 
      text: text.slice(0, 100),
      detectedLanguage: language 
    });
  } catch (err: any) {
    // Logar erro mas retornar "unknown" em vez de erro 500
    console.error("Erro ao detectar idioma:", err);
    return res.status(200).json({ 
      text: req.body?.text?.slice(0, 100) || "",
      detectedLanguage: "unknown" 
    });
  }
};

/**
 * Obtém o idioma configurado da empresa
 */
export const getCompanyLanguage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { companyId } = req.user;
    const language = await TranslationService.getCompanyLanguage(companyId);

    return res.status(200).json({
      language,
      enabled: TranslationService.isEnabled()
    });
  } catch (err: any) {
    console.error("Erro ao buscar idioma da empresa:", err);
    return res.status(500).json({ 
      error: "Erro ao buscar idioma da empresa",
      message: err.message 
    });
  }
};

/**
 * Obtém estatísticas do cache de traduções
 */
export const getCacheStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const stats = TranslationService.getCacheStats();
    return res.status(200).json(stats);
  } catch (err: any) {
    console.error("Erro ao buscar estatísticas do cache:", err);
    return res.status(500).json({ 
      error: "Erro ao buscar estatísticas do cache",
      message: err.message 
    });
  }
};

/**
 * Limpa o cache de traduções
 */
export const clearCache = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    TranslationService.clearCache();
    return res.status(200).json({ message: "Cache limpo com sucesso" });
  } catch (err: any) {
    console.error("Erro ao limpar cache:", err);
    return res.status(500).json({ 
      error: "Erro ao limpar cache",
      message: err.message 
    });
  }
};
