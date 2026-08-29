/**
 * Semáforo genérico para limitar trabalho CPU-bound em paralelo (ffmpeg, mensagens, etc.).
 */
export const createSemaphore = (maxConcurrent: number) => {
  const limit = Math.min(64, Math.max(1, maxConcurrent));
  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < limit) {
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
    if (next) next();
  };

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return { run, limit };
};

export const parseEnvInt = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  if (!raw?.trim()) return fallback;
  const n = parseInt(raw.trim(), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
