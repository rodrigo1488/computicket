import { logger } from "./logger";
import { createSemaphore, parseEnvInt } from "./runWithSemaphore";

const concurrency = parseEnvInt(
  process.env.FFMPEG_MAX_CONCURRENT,
  2,
  1,
  8
);

const semaphore = createSemaphore(concurrency);
let didLog = false;

/** Limita processos ffmpeg simultâneos (envio/recebimento de áudio e vídeo). */
export const runWithFfmpegConcurrency = async <T>(
  fn: () => Promise<T>
): Promise<T> => {
  if (!didLog) {
    didLog = true;
    logger.info({
      msg: "FFmpeg: concorrência limitada",
      concurrency: semaphore.limit
    });
  }
  return semaphore.run(fn);
};
