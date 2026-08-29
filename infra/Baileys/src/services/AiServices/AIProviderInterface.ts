/**
 * Interface comum para provedores de IA (Gemini, OpenAI, etc.)
 * Define os métodos que todos os provedores devem implementar
 */

export interface GenerateTextOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions extends GenerateTextOptions {
  model?: string;
}

export interface TranscribeAudioOptions {
  language?: string;
  prompt?: string;
}

/**
 * Interface principal para provedores de IA
 */
export interface IAIProvider {
  /**
   * Nome do provider (ex: "gemini", "openai")
   */
  readonly name: string;

  /**
   * Gera texto a partir de um prompt simples
   * @param prompt - Texto do prompt
   * @param options - Opções de geração
   * @returns Texto gerado
   */
  generateText(prompt: string, options?: GenerateTextOptions): Promise<string>;

  /**
   * Realiza chat com histórico de mensagens
   * @param messages - Array de mensagens (histórico)
   * @param options - Opções de geração
   * @returns Resposta do chat
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /**
   * Transcreve áudio para texto
   * @param audioInput - Buffer, Readable Stream ou caminho do arquivo de áudio
   * @param mimeType - Tipo MIME do áudio (ex: "audio/mpeg", "audio/ogg")
   * @param options - Opções de transcrição
   * @returns Texto transcrito
   */
  transcribeAudio(
    audioInput: Buffer | any,
    mimeType: string,
    options?: TranscribeAudioOptions
  ): Promise<string>;
}
