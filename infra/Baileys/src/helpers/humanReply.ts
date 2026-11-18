/**
 * Utilitários para humanizar o ritmo de resposta da IA no WhatsApp:
 * - Quebra natural por parágrafos e frases longas.
 * - Cálculo de tempo proporcional ao tamanho (~40 chars/s) + variação aleatória.
 */

const CHARS_PER_SECOND = 40;
const SOFT_PARAGRAPH_LIMIT = 320;
const HARD_MESSAGE_LIMIT = 950;

export const sleepMs = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export const randomRangeMs = (minMs: number, maxMs: number): number => {
  const lo = Math.max(0, Math.floor(minMs));
  const hi = Math.max(lo, Math.floor(maxMs));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
};

export const calculateHumanDelayMs = (
  text: string,
  minSeconds = 2,
  maxSeconds = 12
): number => {
  const minMs = Math.max(0, Number(minSeconds ?? 2)) * 1000;
  const maxMs = Math.max(minMs, Number(maxSeconds ?? 12) * 1000);
  if (maxMs === 0) return 0;

  const length = (text || "").trim().length;
  const baseMs = (length / CHARS_PER_SECOND) * 1000;
  // Variação aleatória entre 80% e 120% para evitar ritmo mecânico
  const jitterFactor = 0.8 + Math.random() * 0.4;
  const estimated = Math.round(baseMs * jitterFactor);

  return Math.min(maxMs, Math.max(minMs, estimated));
};

const splitLongParagraphBySentences = (paragraph: string): string[] => {
  const trimmed = paragraph.trim();
  if (trimmed.length <= SOFT_PARAGRAPH_LIMIT) {
    return trimmed ? [trimmed] : [];
  }

  // Preserva listas com marcadores/numeradas juntas quando couberem no limite rígido
  const lines = trimmed.split("\n");
  const looksLikeList = lines.length > 1 && lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l) || !l.trim());
  if (looksLikeList && trimmed.length <= HARD_MESSAGE_LIMIT) {
    return [trimmed];
  }

  const sentences = trimmed.match(/[^.!?]+(?:[.!?]+|$)/g) || [trimmed];
  const chunks: string[] = [];
  let current = "";

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if (!current) {
      current = sentence;
      continue;
    }
    if (`${current} ${sentence}`.length <= SOFT_PARAGRAPH_LIMIT) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [trimmed];
};

export const splitHumanWhatsAppMessages = (text: string): string[] => {
  const normalized = (text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const paragraph of paragraphs) {
    for (const piece of splitLongParagraphBySentences(paragraph)) {
      if (piece.length <= HARD_MESSAGE_LIMIT) {
        parts.push(piece);
      } else {
        // Fallback para trechos sem pontuação
        for (let i = 0; i < piece.length; i += HARD_MESSAGE_LIMIT) {
          parts.push(piece.slice(i, i + HARD_MESSAGE_LIMIT).trim());
        }
      }
    }
  }

  return parts.filter(Boolean);
};
