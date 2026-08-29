import Redis, { RedisOptions } from "ioredis";
import { logger } from "../utils/logger";

export const REDIS_URI_CONNECTION = process.env.REDIS_URI || "";
export const REDIS_OPT_LIMITER_MAX = process.env.REDIS_OPT_LIMITER_MAX || 1;
export const REDIS_OPT_LIMITER_DURATION =
  process.env.REDIS_OPT_LIMITER_DURATION || 3000;

let lastRedisErrorLog = 0;
const REDIS_ERROR_THROTTLE_MS = 30_000;

/**
 * Bull cria vários clientes ioredis sem listener de "error" → Node emite
 * "Unhandled error event" em cada ECONNRESET. Este createClient anexa handler
 * e mantém o mesmo comportamento do Bull (maxRetriesPerRequest null em subscriber).
 * Assinatura compatível com QueueOptions do Bull.
 */
export function createBullRedisClient(
  type: "client" | "subscriber" | "bclient",
  redisOpts?: RedisOptions
): Redis {
  const isBlocking = type === "bclient" || type === "subscriber";
  const config = redisOpts as RedisOptions | string | undefined;
  const opts: RedisOptions | string =
    typeof config === "string"
      ? config
      : config
        ? isBlocking
          ? { ...config, maxRetriesPerRequest: null }
          : config
        : REDIS_URI_CONNECTION || ({} as RedisOptions);

  const client =
    typeof opts === "string"
      ? new Redis(
          opts,
          isBlocking ? { maxRetriesPerRequest: null } : undefined
        )
      : new Redis(opts);

  client.on("error", (err: NodeJS.ErrnoException) => {
    // Evita crash por unhandled; ECONNRESET = Redis fechou o socket (rede/restart)
    const now = Date.now();
    if (now - lastRedisErrorLog > REDIS_ERROR_THROTTLE_MS) {
      lastRedisErrorLog = now;
      logger.warn(
        `[redis/${type}] ${err.code || ""} ${err.message} — filas em standby até reconectar`
      );
    }
  });

  return client;
}
