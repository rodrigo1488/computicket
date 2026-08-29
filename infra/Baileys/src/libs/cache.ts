import Redis from "ioredis";
import { REDIS_URI_CONNECTION } from "../config/redis";
import { logger } from "../utils/logger";
import * as crypto from "crypto";

const redis = REDIS_URI_CONNECTION
  ? new Redis(REDIS_URI_CONNECTION)
  : new Redis({ host: "127.0.0.1", port: 6379 });

redis.on("error", (err: NodeJS.ErrnoException) => {
  logger.warn(`[redis/cache] ${err.code || ""} ${err.message}`);
});

function encryptParams(params: any) {
  const str = JSON.stringify(params);
  return crypto.createHash("sha256").update(str).digest("base64");
}

export function setFromParams(
  key: string,
  params: any,
  value: string,
  option?: string,
  optionValue?: string | number
) {
  const finalKey = `${key}:${encryptParams(params)}`;
  if (option !== undefined && optionValue !== undefined) {
    return set(finalKey, value, option, optionValue);
  }
  return set(finalKey, value);
}

export function getFromParams(key: string, params: any) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return get(finalKey);
}

export function delFromParams(key: string, params: any) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return del(finalKey);
}

export function set(
  key: string,
  value: string,
  option?: string,
  optionValue?: string | number
) {
  if (option !== undefined && optionValue !== undefined) {
    return redis.set(key, value, option as any, optionValue as any);
  }

  return redis.set(key, value);
}

export function get(key: string) {
  return redis.get(key);
}

export function getKeys(pattern: string) {
  return redis.keys(pattern);
}

export function del(key: string) {
  return redis.del(key);
}

export async function delFromPattern(pattern: string) {
  const all = await getKeys(pattern);
  for (let item of all) {
    del(item);
  }
}

export const cacheLayer = {
  set,
  setFromParams,
  get,
  getFromParams,
  getKeys,
  del,
  delFromParams,
  delFromPattern
};
