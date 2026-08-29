export type AiChatContextMode = "auto" | "compact" | "detailed";

export interface ChatConfig {
  temperature: number;
  maxHistoryMessages: number;
  maxTokens: number;
  topP: number;
  /** Artigos de ajuda injetados no prompt (1–30). */
  maxArticles: number;
  /** auto: compacto salvo se pedir detalhe / entidades; compact: só métricas; detailed: sempre com mensagens. */
  contextMode: AiChatContextMode;
  /** TTL em segundos para cache de estatísticas agregadas (0 = desligado). */
  statsCacheTtlSeconds: number;
}

const DEFAULT_CONFIG: ChatConfig = {
  temperature: 0.3,
  maxHistoryMessages: 10,
  maxTokens: 4096,
  topP: 0.95,
  maxArticles: 8,
  contextMode: "auto",
  statsCacheTtlSeconds: 90
};

/**
 * Configuração fixa do chat IA (sem persistência por empresa).
 * companyId mantido na assinatura para compatibilidade com chamadores existentes.
 */
export const getChatConfig = async (_companyId: number): Promise<ChatConfig> => {
  return { ...DEFAULT_CONFIG };
};
