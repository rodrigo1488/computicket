import { logger } from "./logger";
import { createSemaphore, parseEnvInt } from "./runWithSemaphore";

const concurrency = parseEnvInt(
  process.env.WHATSAPP_MESSAGE_CONCURRENCY,
  5,
  1,
  32
);

const semaphore = createSemaphore(concurrency);
let didLog = false;

/** Limita mensagens WhatsApp processadas em paralelo no event loop. */
export const runWithMessageProcessConcurrency = async <T>(
  fn: () => Promise<T>
): Promise<T> => {
  if (!didLog) {
    didLog = true;
    logger.info({
      msg: "WhatsApp: processamento de mensagens com concorrência limitada",
      concurrency: semaphore.limit
    });
  }
  return semaphore.run(fn);
};
