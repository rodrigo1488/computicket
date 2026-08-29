import { logger } from "./logger";
import { parseEnvInt } from "./runWithSemaphore";

/** Inicia sessões Baileys neste processo (false = só API/filas em outro PM2). */
export const isWhatsAppEnabled = (): boolean =>
  process.env.ENABLE_WHATSAPP !== "false";

/** Processa filas Bull neste processo (false em API-only com worker dedicado). */
export const isBullWorkersEnabled = (): boolean =>
  process.env.ENABLE_BULL_WORKERS !== "false";

const shardCount = (): number =>
  parseEnvInt(process.env.WHATSAPP_SHARD_COUNT, 1, 1, 32);

const shardIndex = (): number => {
  const count = shardCount();
  const idx = parseEnvInt(process.env.WHATSAPP_SHARD_INDEX, 0, 0, 31);
  return idx % count;
};

/** Empresa pertence a este shard (companyId % N === índice). */
export const shouldStartCompanyWhatsApp = (companyId: number): boolean => {
  const total = shardCount();
  if (total <= 1) return true;
  return companyId % total === shardIndex();
};

const maxSessionsPerProcess = (): number =>
  parseEnvInt(process.env.WHATSAPP_MAX_SESSIONS_PER_PROCESS, 0, 0, 64);

let sessionsStarted = 0;
let didLogShard = false;

export const canStartAnotherWhatsAppSession = (): boolean => {
  const max = maxSessionsPerProcess();
  if (max <= 0) return true;
  return sessionsStarted < max;
};

export const registerWhatsAppSessionStarted = (): void => {
  sessionsStarted += 1;
};

export const logWhatsAppShardConfig = (): void => {
  if (didLogShard) return;
  didLogShard = true;
  const total = shardCount();
  if (total > 1 || maxSessionsPerProcess() > 0) {
    logger.info({
      msg: "WhatsApp: configuração de shard/limite",
      shardIndex: shardIndex(),
      shardCount: total,
      maxSessionsPerProcess: maxSessionsPerProcess() || "ilimitado",
      enableWhatsApp: isWhatsAppEnabled(),
      enableBullWorkers: isBullWorkersEnabled()
    });
  }
};
