import { logger } from "./logger";

/** Evita repetir o mesmo aviso a cada minuto (vários crons falham juntos) */
let lastDbUnavailableLog = 0;
const THROTTLE_MS = 60_000;

/**
 * Erro de Sequelize/retry-as-promised quando o banco não responde.
 */
export function isDbUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "TimeoutError") return true;
  if (typeof e.message === "string") {
    if (/timed out|timeout|ETIMEDOUT|ECONNREFUSED/i.test(e.message))
      return true;
  }
  return false;
}

/**
 * Log enxuto para crons quando o banco está fora — sem stack gigante a cada minuto.
 */
export function logCronDbUnavailable(jobName: string, _err?: unknown): void {
  const now = Date.now();
  if (now - lastDbUnavailableLog < THROTTLE_MS) return;
  lastDbUnavailableLog = now;
  logger.warn(
    `[cron] Banco indisponível (timeout). Jobs em standby. Suba o MySQL/Postgres e confira DB_HOST no .env. Job que falhou: ${jobName}`
  );
}
