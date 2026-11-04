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
    .filter((part: any) => part?.thought !== true)
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
};

const generationConfigFor = (
  temperature: number,
  topP: number,
  maxTokens: number,
  withThinking: boolean
): Record<string, unknown> => ({
  temperature,
  topP,
  maxOutputTokens: maxTokens,
  ...(withThinking ? { thinkingConfig: { thinkingLevel: "LOW" } } : {})
});

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
      const merged: typeof contents = [];
      for (const item of contents) {
        const previous = merged[merged.length - 1];
        if (previous && previous.role === item.role) {
          previous.parts[0].text = `${previous.parts[0].text}\n${item.parts[0].text}`;
        } else {
          merged.push({ role: item.role, parts: [{ text: item.parts[0].text }] });
        }
      }
      if (options.image?.data) {
        const lastUser = [...merged].reverse().find(item => item.role === "user");
        const target = lastUser || { role: "user", parts: [{ text: "O cliente enviou uma imagem." }] };
        if (!lastUser) merged.push(target);
        (target.parts as Array<Record<string, unknown>>).push({
          inlineData: {
            mimeType: options.image.mimeType || "image/jpeg",
            data: options.image.data
          }
        });
      }
      const payload = {
        ...(systemMessages
          ? {
              systemInstruction: {
                parts: [{ text: systemMessages }]
              }
            }
          : {}),
        contents: merged.length
          ? merged
          : [{ role: "user", parts: [{ text: "Olá" }] }]
      };
      const outputTokens = Math.max(maxTokens, 1024);
      const readReply = async (withThinking: boolean, tokens: number) => {
        const data = await callGeminiGenerateContent(
          { ...payload, generationConfig: generationConfigFor(temperature, topP, tokens, withThinking) },
          model,
          apiKey
        );
        return {
          text: extractGeminiText(data),
          cut: data?.candidates?.[0]?.finishReason === "MAX_TOKENS"
        };
      };
      let reply: { text: string; cut: boolean };
      try {
        reply = await readReply(options.thinking !== false, outputTokens);
      } catch (err: any) {
        if (err?.response?.status !== 400) throw err;
        reply = await readReply(false, outputTokens);
      }
      if (reply.cut) {
        reply = await readReply(false, outputTokens);
      }
      if (!reply.text || (reply.cut && reply.text.length < 120)) {
        throw new AppError("A IA devolveu uma resposta cortada", 500);
      }
      return reply.text;
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
