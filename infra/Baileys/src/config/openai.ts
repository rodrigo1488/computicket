import { Configuration, OpenAIApi } from "openai";

/** Modelo padrão quando LM_STUDIO_DEFAULT_MODEL não está definido */
const FALLBACK_DEFAULT_MODEL = "local-model";

export const OPENAI_TRANSCRIPTION_MODEL = "whisper-1";

/** Modelo para visão/multimodal (deve existir no LM Studio se usar PDF/imagem) */
export const OPENAI_VISION_MODEL =
  process.env.LM_STUDIO_VISION_MODEL?.trim() || FALLBACK_DEFAULT_MODEL;

/**
 * URL base compatível OpenAI (ex.: http://127.0.0.1:1234/v1)
 */
export const getLmStudioBasePath = (): string => {
  const raw = process.env.LM_STUDIO_BASE_URL?.trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
};

/**
 * Chave enviada no header Authorization; LM Studio aceita placeholder.
 */
export const getLmStudioApiKey = (): string => {
  const k = process.env.LM_STUDIO_API_KEY?.trim();
  return k && k.length > 0 ? k : "lm-studio";
};

/**
 * Modelo carregado no LM Studio (fallback para prompts sem model).
 */
export const getLmStudioDefaultModel = (): string => {
  const m = process.env.LM_STUDIO_DEFAULT_MODEL?.trim();
  return m && m.length > 0 ? m : FALLBACK_DEFAULT_MODEL;
};

export const isAiBackendConfigured = (): boolean => getLmStudioBasePath().length > 0;

/** Janela de contexto do modelo no LM Studio (prompt + geração). Padrão 4096 = comum em GPU limitada. */
export const getLmStudioContextWindowTokens = (): number => {
  const raw = process.env.LM_STUDIO_CONTEXT_SIZE?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 1024) return n;
  }
  return 4096;
};

/**
 * Limite de caracteres do system prompt do chat interno (Compuchat).
 * Com 4096 tokens totais no servidor, o prompt gigante de tickets estoura o slot — truncamos aqui.
 */
export const getLmStudioMaxSystemChars = (): number => {
  const raw = process.env.LM_STUDIO_MAX_SYSTEM_CHARS?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 2000) return n;
  }
  return 7500;
};

export const truncateSystemPromptForLmStudio = (text: string): string => {
  const max = getLmStudioMaxSystemChars();
  if (text.length <= max) return text;
  const marker = "INSTRUÇÕES IMPORTANTES:";
  const idx = text.indexOf(marker);
  if (idx > 200) {
    const tail = text.slice(idx);
    const headBudget = max - tail.length - 120;
    if (headBudget > 800) {
      return (
        `${text.slice(0, headBudget)}\n\n[… trecho intermediário omitido: muitos tickets/mensagens. Aumente LM_STUDIO_CONTEXT_SIZE no LM Studio e LM_STUDIO_MAX_SYSTEM_CHARS no backend …]\n\n${tail}`
      );
    }
  }
  const notice =
    "\n\n[Contexto truncado para caber no LM Studio. Ajuste LM_STUDIO_MAX_SYSTEM_CHARS ou o Context Length no LM Studio.]";
  return `${text.slice(0, Math.max(0, max - notice.length))}${notice}`;
};

let cachedOpenAIClient: OpenAIApi | null = null;

/**
 * Cliente OpenAI-compatível (LM Studio) — credenciais só via ambiente.
 */
export const createOpenAIClient = (): OpenAIApi => {
  const basePath = getLmStudioBasePath();
  if (!basePath) {
    throw new Error(
      "Servidor de IA não configurado. Defina LM_STUDIO_BASE_URL no ambiente do backend."
    );
  }
  if (!cachedOpenAIClient) {
    const configuration = new Configuration({
      apiKey: getLmStudioApiKey(),
      basePath,
      baseOptions: {
        timeout: 300_000 // 5 min — modelos locais podem ser lentos a gerar
      }
    });
    cachedOpenAIClient = new OpenAIApi(configuration);
  }
  return cachedOpenAIClient;
};

export const resetOpenAIClientCache = (): void => {
  cachedOpenAIClient = null;
  cachedWhisperClient = null;
};

/**
 * API OpenAI-compatível só para transcrição (ex.: ghcr.io/hwdsl2/docker-whisper em :8000).
 * Deve incluir `/v1` se o servidor esperar esse prefixo (ex.: http://localhost:8000/v1).
 */
export const getWhisperApiBasePath = (): string => {
  const raw = process.env.WHISPER_API_BASE_URL?.trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
};

export const isWhisperTranscriptionConfigured = (): boolean =>
  getWhisperApiBasePath().length > 0;

export const getWhisperApiKey = (): string => {
  const k = process.env.WHISPER_API_KEY?.trim();
  return k && k.length > 0 ? k : "whisper-local";
};

/** Timeout HTTP (axios) só no cliente Whisper dedicado — áudios longos no GPU. */
export const getTranscriptionHttpTimeoutMs = (): number => {
  const raw = process.env.TRANSCRIPTION_HTTP_TIMEOUT_MS?.trim();
  const fallback = 240_000;
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(600_000, Math.max(60_000, n));
};

let cachedWhisperClient: OpenAIApi | null = null;

export const createWhisperClient = (): OpenAIApi => {
  const basePath = getWhisperApiBasePath();
  if (!basePath) {
    throw new Error(
      "Serviço de transcrição não configurado. Defina WHISPER_API_BASE_URL (ex.: http://localhost:8000/v1)."
    );
  }
  if (!cachedWhisperClient) {
    const configuration = new Configuration({
      apiKey: getWhisperApiKey(),
      basePath,
      baseOptions: {
        timeout: getTranscriptionHttpTimeoutMs()
      }
    });
    cachedWhisperClient = new OpenAIApi(configuration);
  }
  return cachedWhisperClient;
};

/**
 * Transcrição: cliente dedicado (Docker Whisper) se WHISPER_API_BASE_URL estiver definida;
 * caso contrário usa o mesmo cliente do LM Studio (pode retornar 415 se não houver endpoint de áudio).
 */
export const getTranscriptionOpenAIClient = (): OpenAIApi => {
  if (isWhisperTranscriptionConfigured()) {
    return createWhisperClient();
  }
  return createOpenAIClient();
};

/**
 * Valida chave apenas quando ainda há código legado que recebe string externa.
 * Para LM Studio, qualquer string não vazia é aceita.
 */
export const validateOpenAIApiKey = (apiKey: string | null | undefined): string => {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Chave da API não configurada.");
  }
  return apiKey.trim();
};

/**
 * LM Studio / llama.cpp devolvem `error` como string ou objeto; OpenAI usa `{ error: { message } }`.
 */
export const extractOpenAICompatibleErrorMessage = (error: any): string => {
  const data = error?.response?.data;
  if (data == null || data === "") {
    return "";
  }
  if (typeof data === "string") {
    return data.trim();
  }
  const err = data.error;
  if (typeof err === "string") {
    return err.trim();
  }
  if (err && typeof err === "object") {
    if (typeof err.message === "string" && err.message.trim()) {
      return err.message.trim();
    }
    if (typeof (err as any).msg === "string" && (err as any).msg.trim()) {
      return (err as any).msg.trim();
    }
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail.trim();
  }
  try {
    const s = JSON.stringify(data);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return "";
  }
};

/** Transcrição estilo Whisper (multipart) não existe no LM Studio — só em API OpenAI real ou servidor STT separado. */
export const LM_STUDIO_TRANSCRIPTION_UNSUPPORTED_PT =
  "O LM Studio não oferece o endpoint de transcrição de áudio (Whisper). Use texto no chat interno, ou rode um serviço STT/Whisper compatível e aponte o backend para ele.";

export const interpretOpenAIError = (error: any): string => {
  const detail = extractOpenAICompatibleErrorMessage(error);
  const status = error?.response?.status;

  if (status === 401) {
    return "Acesso negado ao servidor de IA. Verifique LM_STUDIO_API_KEY se necessário.";
  }
  if (status === 429) {
    return "Limite de requisições ao servidor de IA. Aguarde e tente novamente.";
  }
  if (status === 415 || /unsupported media type|application\/json/i.test(detail)) {
    return detail || "Este endpoint exige JSON; o LM Studio não aceita upload de áudio no formato da API Whisper.";
  }
  if (status === 413) {
    return detail || "Corpo da requisição grande demais para o servidor de IA (reduza contexto ou max_tokens).";
  }
  if (status === 400) {
    if (
      /exceeds the available context|context size|n_ctx|too many tokens|maximum context/i.test(
        detail
      )
    ) {
      return (
        `Prompt maior que a janela de contexto do LM Studio (${detail.slice(0, 200)}). ` +
        "Aumente o contexto no LM Studio (Context Length / n_ctx), ou reduza dados: defina LM_STUDIO_MAX_SYSTEM_CHARS menor " +
        "e/ou LM_STUDIO_CONTEXT_SIZE igual ao n_ctx do servidor."
      );
    }
    if (detail.includes("model") || /model/i.test(detail)) {
      const hint =
        "Defina LM_STUDIO_DEFAULT_MODEL no .env com o mesmo id do modelo carregado (veja GET /v1/models no LM Studio).";
      return detail.trim()
        ? `Modelo no LM Studio: ${detail}. ${hint}`
        : `Modelo rejeitado pelo LM Studio (400). ${hint}`;
    }
    if (detail.trim()) {
      return `Requisição inválida: ${detail}`;
    }
    return (
      "Requisição rejeitada pelo LM Studio (400) sem detalhe. Confira se o nome do modelo bate com o carregado, " +
      "se o contexto não excede o limite do modelo e se LM_STUDIO_BASE_URL termina em /v1."
    );
  }
  if (status === 404) {
    return detail || "Endpoint do servidor de IA não encontrado. Verifique LM_STUDIO_BASE_URL.";
  }
  if (status === 500 || status === 503) {
    if (
      /exceeds the available context|context size|n_ctx|request \(\d+ tokens\)/i.test(detail)
    ) {
      return (
        `Janela de contexto insuficiente no LM Studio: ${detail.slice(0, 180)}… ` +
        "Aumente Context Length no LM Studio ou use LM_STUDIO_MAX_SYSTEM_CHARS / LM_STUDIO_CONTEXT_SIZE no backend."
      );
    }
    return detail || "Servidor de IA temporariamente indisponível. Tente novamente em instantes.";
  }

  const errorMessage = detail || error?.message || "Erro desconhecido";
  return `Erro no servidor de IA: ${errorMessage}`;
};

export const handleOpenAIError = (err: any): never => {
  const userMessage = interpretOpenAIError(err);
  throw new Error(userMessage);
};

/**
 * Texto visível do assistente em respostas `chat.completion`.
 * Modelos reasoning (ex.: DeepSeek R1 no LM Studio) podem usar `reasoning_content` com `content` vazio
 * até o fim do raciocínio; ler só `content` faz o atendimento parecer “mudo”.
 */
export const getChatCompletionAssistantText = (completionData: any): string => {
  const msg = completionData?.choices?.[0]?.message;
  if (!msg) return "";
  const direct = msg.content;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  if (Array.isArray(direct)) {
    const parts = direct
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text as string);
    const joined = parts.join("\n").trim();
    if (joined.length > 0) return joined;
  }
  const reasoning =
    msg.reasoning_content ??
    (typeof (msg as any).reasoning === "string" ? (msg as any).reasoning : "");
  if (typeof reasoning === "string" && reasoning.trim().length > 0) {
    return reasoning.trim();
  }
  return "";
};

/** Teste de conectividade com o LM Studio (chat mínimo). */
export const testLmStudioConnection = async (): Promise<boolean> => {
  if (!isAiBackendConfigured()) {
    return false;
  }
  try {
    const client = createOpenAIClient();
    await client.createChatCompletion({
      model: getLmStudioDefaultModel(),
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5
    });
    return true;
  } catch (err: any) {
    console.error("Falha no teste LM Studio:", {
      status: err?.response?.status,
      error: err?.response?.data?.error,
      message: err?.message
    });
    return false;
  }
};
