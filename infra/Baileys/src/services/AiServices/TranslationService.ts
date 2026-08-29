import { AIProviderSelector } from "./AIProviderSelector";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import { logger } from "../../utils/logger";
import crypto from "crypto";

/**
 * Cache em memória para traduções
 * Estrutura: Map<cacheKey, { translation: string, timestamp: number }>
 */
const translationCache = new Map<string, { translation: string; timestamp: number }>();
const CACHE_DURATION = 3600000; // 1 hora em ms

/**
 * Cache em memória para detecção de idioma
 * Estrutura: Map<textHash, { language: string, timestamp: number }>
 */
const languageDetectionCache = new Map<string, { language: string; timestamp: number }>();
const LANGUAGE_CACHE_DURATION = 86400000; // 24 horas em ms

interface TranslateParams {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  companyId: number;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationNeeded: boolean;
  cached: boolean;
}

export class TranslationService {
  static isEnabled(): boolean {
    return process.env.MESSAGE_TRANSLATION_ENABLED === "true";
  }

  /**
   * Gera chave de cache para tradução
   */
  private static generateCacheKey(text: string, sourceLang: string, targetLang: string): string {
    const hash = crypto.createHash('md5').update(`${text}-${sourceLang}-${targetLang}`).digest('hex');
    return hash;
  }

  /**
   * Limpa cache expirado
   */
  private static cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of translationCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        translationCache.delete(key);
      }
    }
  }

  /**
   * Detecta o idioma de um texto usando IA
   */
  static async detectLanguage(text: string, companyId: number): Promise<string> {
    if (!this.isEnabled()) {
      return "unknown";
    }

    try {
      // Validações básicas
      if (!text || typeof text !== "string") {
        return "unknown";
      }

      const trimmedText = text.trim();
      
      // Texto muito curto - retornar unknown sem logar erro
      if (trimmedText.length < 10) {
        return "unknown";
      }

      // Ignorar se for apenas emojis, números ou caracteres especiais
      const textWithoutEmojis = trimmedText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
      const onlyNumbersOrSpecial = /^[0-9\s\W]+$/.test(textWithoutEmojis);
      if (onlyNumbersOrSpecial || textWithoutEmojis.length < 5) {
        return "unknown";
      }

      // Verificar cache primeiro
      const textHash = crypto.createHash('md5').update(trimmedText.toLowerCase()).digest('hex');
      const cached = languageDetectionCache.get(textHash);
      
      if (cached && (Date.now() - cached.timestamp) < LANGUAGE_CACHE_DURATION) {
        return cached.language;
      }

      // Obter provider de IA
      const provider = await AIProviderSelector.getProvider(companyId, "chat");

      // Prompt otimizado para detecção rápida de idioma
      const prompt = `Detect the language of this text and respond ONLY with the ISO 639-1 two-letter language code (pt, en, es, fr, de, it, etc.). No explanation, just the code.

Text: "${trimmedText.slice(0, 500)}"

Language code:`;

      const response = await provider.generateText(prompt, {
        temperature: 0.1,
        maxTokens: 10
      });

      // Extrair código de idioma (primeiros 2 caracteres alfanuméricos)
      const languageCode = response.trim().toLowerCase().match(/[a-z]{2}/)?.[0] || "unknown";
      
      // Armazenar no cache
      languageDetectionCache.set(textHash, {
        language: languageCode,
        timestamp: Date.now()
      });

      // Limpar cache expirado periodicamente
      if (languageDetectionCache.size > 1000) {
        const now = Date.now();
        for (const [key, value] of languageDetectionCache.entries()) {
          if (now - value.timestamp > LANGUAGE_CACHE_DURATION) {
            languageDetectionCache.delete(key);
          }
        }
      }

      logger.debug(`Idioma detectado: ${languageCode} para texto: "${trimmedText.slice(0, 50)}..."`);
      return languageCode;

    } catch (err: any) {
      // Logar apenas erros inesperados, não erros de validação
      if (err instanceof AppError || err.message?.includes("API Key") || err.message?.includes("configurada")) {
        // Erros esperados - não logar como erro crítico
        logger.debug(`Detecção de idioma falhou (esperado): ${err.message}`);
      } else {
        // Erros inesperados - logar com mais detalhes
        logger.error("Erro ao detectar idioma:", {
          message: err.message,
          stack: err.stack,
          textLength: text?.length || 0
        });
      }
      return "unknown";
    }
  }

  /**
   * Traduz um texto de um idioma para outro
   */
  static async translateText(params: TranslateParams): Promise<TranslationResult> {
    const { text, sourceLanguage, targetLanguage, companyId } = params;

    if (!this.isEnabled()) {
      const normalizedTarget = (targetLanguage || "pt").toLowerCase();
      return {
        originalText: text,
        translatedText: text,
        sourceLanguage: sourceLanguage?.toLowerCase() || "unknown",
        targetLanguage: normalizedTarget,
        translationNeeded: false,
        cached: false
      };
    }

    try {
      // Validações
      if (!text || text.trim().length === 0) {
        throw new AppError("Texto vazio não pode ser traduzido", 400);
      }

      if (!targetLanguage) {
        throw new AppError("Idioma de destino não especificado", 400);
      }

      // Detectar idioma de origem se não foi fornecido
      let detectedSourceLang = sourceLanguage;
      if (!detectedSourceLang) {
        detectedSourceLang = await this.detectLanguage(text, companyId);
      }

      // Normalizar códigos de idioma
      const normalizedSource = detectedSourceLang.toLowerCase();
      const normalizedTarget = targetLanguage.toLowerCase();

      // Se os idiomas são iguais, não precisa traduzir
      if (normalizedSource === normalizedTarget) {
        return {
          originalText: text,
          translatedText: text,
          sourceLanguage: normalizedSource,
          targetLanguage: normalizedTarget,
          translationNeeded: false,
          cached: false
        };
      }

      // Se idioma de origem é desconhecido, tentar traduzir mesmo assim
      // (pode ser que a detecção falhou mas o texto ainda precisa ser traduzido)
      // Apenas não traduzir se o texto for muito curto ou apenas números/emojis
      if (normalizedSource === "unknown") {
        const trimmedText = text.trim();
        const textWithoutEmojis = trimmedText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
        const onlyNumbersOrSpecial = /^[0-9\s\W]+$/.test(textWithoutEmojis);
        
        // Se for texto válido (não apenas números/emojis), tentar traduzir mesmo com idioma desconhecido
        if (trimmedText.length >= 5 && !onlyNumbersOrSpecial && textWithoutEmojis.length >= 3) {
          // Continuar com a tradução, assumindo que pode ser um idioma diferente
          // O provider de IA vai tentar traduzir mesmo sem saber o idioma de origem
        } else {
          // Texto muito curto ou inválido, não traduzir
          return {
            originalText: text,
            translatedText: text,
            sourceLanguage: normalizedSource,
            targetLanguage: normalizedTarget,
            translationNeeded: false,
            cached: false
          };
        }
      }

      // Verificar cache
      const cacheKey = this.generateCacheKey(text, normalizedSource, normalizedTarget);
      const cached = translationCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        logger.info(`Tradução encontrada em cache: ${cacheKey}`);
        return {
          originalText: text,
          translatedText: cached.translation,
          sourceLanguage: normalizedSource,
          targetLanguage: normalizedTarget,
          translationNeeded: true,
          cached: true
        };
      }

      // Obter provider de IA
      const provider = await AIProviderSelector.getProvider(companyId, "chat");

      // Mapear códigos de idioma para nomes completos
      const languageNames: Record<string, string> = {
        pt: "Portuguese",
        en: "English",
        es: "Spanish",
        fr: "French",
        de: "German",
        it: "Italian",
        ja: "Japanese",
        zh: "Chinese",
        ru: "Russian",
        ar: "Arabic"
      };

      const sourceLangName = languageNames[normalizedSource] || normalizedSource;
      const targetLangName = languageNames[normalizedTarget] || normalizedTarget;

      // Prompt para tradução
      let prompt: string;
      if (normalizedSource === "unknown") {
        // Quando o idioma é desconhecido, pedir para detectar e traduzir
        prompt = `Detect the language of the following text and translate it to ${targetLangName}. 
Preserve all formatting, emojis, and line breaks. 
Respond ONLY with the translated text, no explanations or additional comments.

Text to translate:
${text}

Translation:`;
      } else {
        prompt = `Translate the following text from ${sourceLangName} to ${targetLangName}. 
Preserve all formatting, emojis, and line breaks. 
Respond ONLY with the translated text, no explanations or additional comments.

Text to translate:
${text}

Translation:`;
      }

      // Retry com backoff em caso de rate limit (429)
      const MAX_RETRIES_429 = 3;
      const BACKOFF_MS = [3000, 10000, 30000]; // 3s, 10s, 30s
      let translatedText: string = "";

      for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
        try {
          translatedText = await provider.generateText(prompt, {
            temperature: 0.3,
            maxTokens: Math.max(text.length * 2, 500)
          });
          break;
        } catch (err: any) {
          const appErr = err instanceof AppError ? err : new AppError(err.message || "Erro ao traduzir", err.statusCode || 500);
          if (appErr.statusCode === 429 && attempt < MAX_RETRIES_429) {
            const delay = BACKOFF_MS[attempt];
            logger.warn(`IA 429 (tentativa ${attempt + 1}/${MAX_RETRIES_429 + 1}). Aguardando ${delay / 1000}s antes de retry.`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw appErr;
        }
      }

      // Armazenar em cache
      translationCache.set(cacheKey, {
        translation: translatedText.trim(),
        timestamp: Date.now()
      });

      // Limpar cache expirado periodicamente
      if (translationCache.size > 1000) {
        this.cleanExpiredCache();
      }

      logger.info(`Texto traduzido: ${normalizedSource} → ${normalizedTarget}`);

      return {
        originalText: text,
        translatedText: translatedText.trim(),
        sourceLanguage: normalizedSource,
        targetLanguage: normalizedTarget,
        translationNeeded: true,
        cached: false
      };

    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error("Erro ao traduzir texto:", err);
      throw new AppError(`Erro ao traduzir texto: ${err.message || "Erro desconhecido"}`, 500);
    }
  }

  /**
   * Obtém o idioma configurado da empresa
   */
  static async getCompanyLanguage(companyId: number): Promise<string> {
    try {
      const setting = await Setting.findOne({
        where: {
          key: "companyLanguage",
          companyId
        }
      });

      return setting?.value || "pt"; // Padrão: português
    } catch (err: any) {
      logger.error("Erro ao buscar idioma da empresa:", err);
      return "pt";
    }
  }

  /**
   * Limpa todo o cache de traduções
   */
  static clearCache(): void {
    translationCache.clear();
    logger.info("Cache de traduções limpo");
  }

  /**
   * Obtém estatísticas do cache
   */
  static getCacheStats(): { size: number; oldestEntry: number | null } {
    const now = Date.now();
    let oldestTimestamp: number | null = null;

    for (const value of translationCache.values()) {
      if (oldestTimestamp === null || value.timestamp < oldestTimestamp) {
        oldestTimestamp = value.timestamp;
      }
    }

    return {
      size: translationCache.size,
      oldestEntry: oldestTimestamp ? Math.floor((now - oldestTimestamp) / 1000) : null
    };
  }
}

export default TranslationService;
