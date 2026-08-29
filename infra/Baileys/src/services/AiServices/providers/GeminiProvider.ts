import { Readable } from "stream";
import AppError from "../../../errors/AppError";
import {
  IAIProvider,
  GenerateTextOptions,
  ChatMessage,
  ChatOptions,
  TranscribeAudioOptions
} from "../AIProviderInterface";
import {
  callGeminiGenerateContent,
  getGeminiApiKey,
  getGeminiDefaultModel,
  interpretGeminiError,
  resolveGeminiModel
} from "../../../config/gemini";
import { getCompanyGeminiApiKey } from "../GeminiApiKeyService";

const extractGeminiText = (data: any): string => {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("\n")
    .trim();
};

export class GeminiProvider implements IAIProvider {
  readonly name = "gemini";

  constructor(private readonly companyId?: number) {}

  private async resolveApiKey(): Promise<string> {
    if (this.companyId) {
      const key = await getCompanyGeminiApiKey(this.companyId);
      if (key) return key;
      throw new Error("GEMINI_KEY_MISSING");
    }
    const envKey = getGeminiApiKey();
    if (envKey) return envKey;
    throw new Error("GEMINI_KEY_MISSING");
  }

  async generateText(
    prompt: string,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const { temperature = 0.5, maxTokens = 2048, topP = 0.95 } = options;
    try {
      const apiKey = await this.resolveApiKey();
      const data = await callGeminiGenerateContent(
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            topP,
            maxOutputTokens: maxTokens
          }
        },
        undefined,
        apiKey
      );
      const text = extractGeminiText(data);
      if (!text) {
        throw new AppError("A IA não retornou resposta válida", 500);
      }
      return text;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(`Erro ao gerar texto com Gemini: ${interpretGeminiError(err)}`, 500);
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const {
      temperature = 0.5,
      maxTokens = 2048,
      topP = 0.95,
      model: rawModel = getGeminiDefaultModel()
    } = options;
    const model = resolveGeminiModel(rawModel);

    const systemMessages = messages
      .filter(m => m.role === "system")
      .map(m => m.content)
      .join("\n\n")
      .trim();

    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

    try {
      const apiKey = await this.resolveApiKey();
      const data = await callGeminiGenerateContent(
        {
          ...(systemMessages
            ? {
                systemInstruction: {
                  parts: [{ text: systemMessages }]
                }
              }
            : {}),
          contents: contents.length
            ? contents
            : [{ role: "user", parts: [{ text: "Olá" }] }],
          generationConfig: {
            temperature,
            topP,
            maxOutputTokens: maxTokens
          }
        },
        model,
        apiKey
      );
      const text = extractGeminiText(data);
      if (!text) {
        throw new AppError("A IA não retornou resposta válida", 500);
      }
      return text;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(`Erro ao realizar chat com Gemini: ${interpretGeminiError(err)}`, 500);
    }
  }

  async transcribeAudio(
    _audioInput: Buffer | Readable | string,
    _mimeType: string,
    _options: TranscribeAudioOptions = {}
  ): Promise<string> {
    throw new AppError(
      "Transcrição via Gemini não suportada neste backend. Configure LM Studio/Whisper para transcrição.",
      400
    );
  }
}
