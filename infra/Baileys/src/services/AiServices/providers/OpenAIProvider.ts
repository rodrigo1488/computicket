import { Readable } from "stream";
import {
  IAIProvider,
  GenerateTextOptions,
  ChatMessage,
  ChatOptions,
  TranscribeAudioOptions
} from "../AIProviderInterface";
import {
  createOpenAIClient,
  getLmStudioDefaultModel,
  getLmStudioContextWindowTokens,
  getTranscriptionOpenAIClient,
  isWhisperTranscriptionConfigured,
  OPENAI_TRANSCRIPTION_MODEL,
  interpretOpenAIError,
  extractOpenAICompatibleErrorMessage,
  LM_STUDIO_TRANSCRIPTION_UNSUPPORTED_PT,
  getChatCompletionAssistantText
} from "../../../config/openai";
import AppError from "../../../errors/AppError";
import { logger } from "../../../utils/logger";

/**
 * Provider OpenAI implementando a interface IAIProvider
 */
export class OpenAIProvider implements IAIProvider {
  readonly name = "openai";
  private client: ReturnType<typeof createOpenAIClient>;

  constructor() {
    this.client = createOpenAIClient();
  }

  /**
   * Gera texto a partir de um prompt simples
   */
  async generateText(
    prompt: string,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    let {
      temperature = 0.5,
      maxTokens = 2048,
      topP = 0.95
    } = options;

    const capOut = process.env.LM_STUDIO_MAX_OUTPUT_TOKENS?.trim();
    if (capOut) {
      const cap = parseInt(capOut, 10);
      if (!Number.isNaN(cap) && cap > 0) {
        maxTokens = Math.min(maxTokens, cap);
      }
    }

    try {
      const model = getLmStudioDefaultModel();
      const messages = [{ role: "user" as const, content: prompt }];
      const ctxWindow = getLmStudioContextWindowTokens();
      const estPromptTokens = Math.ceil(JSON.stringify(messages).length / 3.2);
      const headroom = 128;
      const safeMaxTokens = Math.min(
        maxTokens,
        Math.max(64, ctxWindow - estPromptTokens - headroom)
      );

      const completion = await this.client.createChatCompletion({
        model,
        messages,
        temperature,
        max_tokens: safeMaxTokens,
        top_p: topP
      });

      const text = getChatCompletionAssistantText(completion.data);
      if (!text || text.trim() === "") {
        throw new AppError("A IA não retornou resposta válida", 500);
      }

      // Sanitizar resposta: remover caracteres de controle inválidos e garantir encoding correto
      const sanitized = text
        .trim()
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "") // Remover caracteres de controle exceto \n, \r, \t
        .replace(/\uFFFD/g, "") // Remover caracteres de substituição Unicode
        .replace(/\u0000/g, "") // Remover null bytes
        .normalize("NFC"); // Normalizar Unicode mantendo acentos

      return sanitized.trim();
    } catch (err: any) {
      const userMessage = interpretOpenAIError(err);
      throw new AppError(`Erro ao gerar texto com OpenAI: ${userMessage}`, err?.status || 500);
    }
  }

  /**
   * Realiza chat com histórico de mensagens
   */
  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {
    let {
      temperature = 0.5,
      maxTokens = 2048,
      topP = 0.95,
      model = getLmStudioDefaultModel()
    } = options;

    const capOut = process.env.LM_STUDIO_MAX_OUTPUT_TOKENS?.trim();
    if (capOut) {
      const cap = parseInt(capOut, 10);
      if (!Number.isNaN(cap) && cap > 0) {
        maxTokens = Math.min(maxTokens, cap);
      }
    }

    try {
      // Converter mensagens para o formato OpenAI
      const openAIMessages = messages.map(msg => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const ctxWindow = getLmStudioContextWindowTokens();
      const estPromptTokens = Math.ceil(JSON.stringify(openAIMessages).length / 3.2);
      const headroom = 128;
      const safeMaxTokens = Math.min(
        maxTokens,
        Math.max(64, ctxWindow - estPromptTokens - headroom)
      );

      const completion = await this.client.createChatCompletion({
        model,
        messages: openAIMessages,
        temperature,
        max_tokens: safeMaxTokens,
        top_p: topP
      });

      const text = getChatCompletionAssistantText(completion.data);
      if (!text || text.trim() === "") {
        throw new AppError("A IA não retornou resposta válida", 500);
      }

      // Sanitizar resposta: remover caracteres de controle inválidos e garantir encoding correto
      const sanitized = text
        .trim()
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "") // Remover caracteres de controle exceto \n, \r, \t
        .replace(/\uFFFD/g, "") // Remover caracteres de substituição Unicode
        .replace(/\u0000/g, "") // Remover null bytes
        .normalize("NFC"); // Normalizar Unicode mantendo acentos

      return sanitized.trim();
    } catch (err: any) {
      logger.error("❌ OpenAIProvider.chat resposta de erro", {
        status: err?.response?.status,
        data: err?.response?.data
      });
      const userMessage = interpretOpenAIError(err);
      throw new AppError(`Erro ao realizar chat com OpenAI: ${userMessage}`, err?.status || 500);
    }
  }

  /**
   * Transcreve áudio para texto usando Whisper API
   * Aceita Buffer, FileStream ou caminho de arquivo
   */
  async transcribeAudio(
    audioInput: Buffer | Readable | string,
    mimeType: string,
    options: TranscribeAudioOptions = {}
  ): Promise<string> {
    try {
      let file: any;

      // Se for string, assumir que é caminho de arquivo
      if (typeof audioInput === "string") {
        const fs = require("fs");
        file = fs.createReadStream(audioInput);
      }
      // Se for Buffer, converter para Readable Stream
      else if (Buffer.isBuffer(audioInput)) {
        file = Readable.from(audioInput);
        // OpenAI SDK precisa de um objeto File-like
        file.name = `audio.${mimeType.split("/")[1] || "mp3"}`;
      }
      // Se já for Readable Stream
      else {
        file = audioInput;
      }

      // Configurar parâmetros da transcrição
      // Whisper API (v3.3.0): createTranscription(file, model, prompt, responseFormat, temperature, language)
      // IMPORTANTE: Prompt deve ser MUITO curto (máx 244 caracteres) e apenas para contexto
      // Prompt complexo ou longo pode fazer o modelo gastar tokens desnecessariamente e retornar vazio
      // Para transcrição simples, é melhor NÃO usar prompt ou usar apenas termos técnicos esperados
      
      // Usar prompt apenas se fornecido, curto e relevante (não instruções complexas)
      const promptToUse = options.prompt && options.prompt.length <= 200 
        ? options.prompt 
        : undefined; // Não usar prompt se for muito longo ou complexo

      const txClient = getTranscriptionOpenAIClient();
      if (isWhisperTranscriptionConfigured()) {
        logger.info("Transcrição via WHISPER_API_BASE_URL (serviço dedicado)");
      }

      // createTranscription(file, model, prompt, responseFormat, temperature, language)
      const response = await txClient.createTranscription(
        file as any,
        OPENAI_TRANSCRIPTION_MODEL,
        promptToUse,
        "text",
        undefined,
        options.language || undefined
      );

      // Extrair texto da resposta
      // Na API 3.3.0, createTranscription com responseFormat="text" retorna string diretamente
      // Mas pode retornar objeto em alguns casos
      let text = "";
      
      if (typeof response === "string") {
        // Resposta direta como string
        text = response;
      } else if (response && typeof response === "object") {
        // Resposta como objeto - tentar extrair de várias propriedades possíveis
        text = (response as any).text || 
               (response as any).data?.text || 
               (response as any).data || 
               (response as any).transcription ||
               "";
        
        // Se ainda for objeto, tentar stringify e extrair
        if (typeof text === "object" && text !== null) {
          text = JSON.stringify(text);
        }
      }

      // Verificar se a transcrição está vazia
      if (!text || typeof text !== "string" || text.trim() === "") {
        logger.error("Transcrição vazia retornada pela API Whisper");
        throw new AppError("ERR_AI_TRANSCRIPTION_EMPTY", 500);
      }

      logger.info(`✅ Transcrição OpenAI concluída (${text.length} caracteres)`);
      return text.trim();
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = extractOpenAICompatibleErrorMessage(err);
      if (status === 429) {
        throw new AppError("ERR_AI_QUOTA_EXCEEDED", 429);
      }
      if (status === 401) {
        throw new AppError("ERR_AI_CONFIG_MISSING", 401);
      }
      if (
        status === 415 ||
        /unsupported media type|application\/json/i.test(detail)
      ) {
        throw new AppError(LM_STUDIO_TRANSCRIPTION_UNSUPPORTED_PT, 415);
      }
      const userMessage = interpretOpenAIError(err);
      throw new AppError(`ERR_AI_TRANSCRIPTION_ERROR: ${userMessage}`, status || 500);
    }
  }
}
