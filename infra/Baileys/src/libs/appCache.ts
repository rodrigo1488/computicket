import * as crypto from "crypto";
import { cacheLayer } from "./cache";
import { logger } from "../utils/logger";

export type CacheNamespace =
  | "dashboard"
  | "tickets"
  | "contacts"
  | "settings"
  | "modules"
  | "users"
  | "company";

export const CACHE_TTL = {
  live: 30,
  warm: 90,
  list: 60,
  inbox: 15,
  settings: 120,
  modules: 600,
  company: 600,
  historical: 300,
  external: 300,
  user: 120,
  super: 300
} as const;

const envTrue = (value: string | undefined): boolean =>
  value === "true" || value === "1";

export const isCacheLoggingEnabled = (): boolean =>
  process.env.NODE_ENV !== "production" || envTrue(process.env.CACHE_LOG_ENABLED);

export const isCacheEnabled = (): boolean =>
  envTrue(process.env.CACHE_ENABLED);

export const isCacheNamespaceEnabled = (namespace: CacheNamespace): boolean => {
  if (!isCacheEnabled()) return false;
  const flag = process.env[`CACHE_${namespace.toUpperCase()}`];
  if (flag === undefined) return true;
  return envTrue(flag);
};

const hashParams = (params: unknown): string => {
  const str = JSON.stringify(params ?? {});
  return crypto.createHash("sha256").update(str).digest("base64url").slice(0, 16);
};

export const buildKey = (
  namespace: CacheNamespace,
  companyId: number | string | null,
  suffix: string,
  params?: unknown
): string => {
  const companyPart =
    companyId === null || companyId === undefined ? "global" : String(companyId);
  const paramsPart = params !== undefined ? `:${hashParams(params)}` : "";
  return `cc:${companyPart}:${namespace}:${suffix}${paramsPart}`;
};

export const buildUserKey = (
  userId: number | string,
  tokenVersion: number,
  suffix = "profile"
): string => `cc:user:${userId}:v${tokenVersion}:${suffix}`;

let lastHitMissLog = 0;
const HIT_MISS_LOG_INTERVAL_MS = 5000;

const logCacheEvent = (
  event: "HIT" | "MISS" | "SKIP" | "ERROR",
  key: string,
  namespace: CacheNamespace,
  durationMs?: number
): void => {
  if (!isCacheLoggingEnabled()) return;

  if (process.env.NODE_ENV === "production") {
    const now = Date.now();
    if (now - lastHitMissLog < HIT_MISS_LOG_INTERVAL_MS) return;
    lastHitMissLog = now;
  }

  logger.debug({
    msg: `[appCache] ${event}`,
    namespace,
    key,
    durationMs
  });
};

export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
  namespace: CacheNamespace = "dashboard"
): Promise<{ value: T; cacheStatus: "HIT" | "MISS" | "SKIP" }> {
  if (!isCacheNamespaceEnabled(namespace)) {
    const value = await fetchFn();
    logCacheEvent("SKIP", key, namespace);
    return { value, cacheStatus: "SKIP" };
  }

  const start = Date.now();

  try {
    const cached = await cacheLayer.get(key);
    if (cached) {
      logCacheEvent("HIT", key, namespace, Date.now() - start);
      return { value: JSON.parse(cached) as T, cacheStatus: "HIT" };
    }
  } catch (err: any) {
    logCacheEvent("ERROR", key, namespace);
    logger.warn(`[appCache] get failed for ${key}: ${err?.message || err}`);
    const value = await fetchFn();
    return { value, cacheStatus: "SKIP" };
  }

  const value = await fetchFn();

  try {
    await cacheLayer.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err: any) {
    logger.warn(`[appCache] set failed for ${key}: ${err?.message || err}`);
  }

  logCacheEvent("MISS", key, namespace, Date.now() - start);
  return { value, cacheStatus: "MISS" };
}

export async function invalidatePattern(pattern: string): Promise<void> {
  try {
    await cacheLayer.delFromPattern(pattern);
  } catch (err: any) {
    logger.warn(`[appCache] invalidate failed for ${pattern}: ${err?.message || err}`);
  }
}

export async function invalidateCompany(
  companyId: number,
  namespaces: CacheNamespace[]
): Promise<void> {
  await Promise.all(
    namespaces.map(ns => invalidatePattern(`cc:${companyId}:${ns}:*`))
  );
}

export async function invalidateUser(userId: number): Promise<void> {
  await invalidatePattern(`cc:user:${userId}:*`);
}

export const appCache = {
  buildKey,
  buildUserKey,
  getOrSet,
  invalidatePattern,
  invalidateCompany,
  invalidateUser,
  isCacheEnabled,
  isCacheNamespaceEnabled,
  CACHE_TTL
};
