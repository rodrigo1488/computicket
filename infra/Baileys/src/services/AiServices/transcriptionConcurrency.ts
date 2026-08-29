import { logger } from "../../utils/logger";

/**
 * Limita quantas transcrições chamam o Whisper/LM Studio em paralelo.
 * Evita centenas de HTTP simultâneos (timeouts, fila no GPU, 503).
 * Ajuste com TRANSCRIPTION_MAX_CONCURRENT (padrão 3).
 */
const parseConcurrency = (): number => {
  const raw = process.env.TRANSCRIPTION_MAX_CONCURRENT?.trim();
  const fallback = 3;
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(32, Math.max(1, n));
};

const concurrency = parseConcurrency();

/** Tempo máximo à espera na fila + execução do HTTP ao Whisper. */
const jobTimeoutMs = (() => {
  const raw = process.env.TRANSCRIPTION_JOB_TIMEOUT_MS?.trim();
  const fallback = 180_000;
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(900_000, Math.max(30_000, n));
})();

let active = 0;
const waiting: Array<() => void> = [];

const acquire = (): Promise<void> => {
  if (active < concurrency) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
};

const release = (): void => {
  active -= 1;
  const next = waiting.shift();
  if (next) {
    next();
  }
};

let didLog = false;

/**
 * Executa a tarefa com no máximo N transcrições em paralelo e limite de tempo (fila + HTTP).
 */
export async function runWithTranscriptionConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (!didLog) {
    didLog = true;
    logger.info({
      msg: "Transcrição: concorrência limitada (semáforo interno)",
      concurrency,
      jobTimeoutMs
    });
  }

  await acquire();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `Timeout na transcrição após ${jobTimeoutMs}ms (fila ou servidor lento). Aumente TRANSCRIPTION_JOB_TIMEOUT_MS ou TRANSCRIPTION_MAX_CONCURRENT.`
          )
        );
      }, jobTimeoutMs);
    });
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    release();
  }
}
