export const asBool = (value: unknown, fallback = false): boolean => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off", ""].includes(text)) return false;
  return fallback;
};

export const optionalId = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const clampIdleMinutes = (value: unknown, fallback = 30): number => {
  const parsed = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1440, Math.max(5, parsed));
};

export const clampDebounceSeconds = (value: unknown, fallback = 4): number => {
  const parsed = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30, Math.max(0, parsed));
};

export const clampDelaySeconds = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(60, Math.max(0, parsed));
};

export const clampDelayRange = (
  minRaw: unknown,
  maxRaw: unknown,
  fallbackMin = 2,
  fallbackMax = 12
): { min: number; max: number } => {
  const min = clampDelaySeconds(minRaw, fallbackMin);
  const max = Math.max(min, clampDelaySeconds(maxRaw, fallbackMax));
  return { min, max };
};

export const normalizeGroupJid = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const base = raw.replace(/@g\.us$/i, "").replace(/@s\.whatsapp\.net$/i, "").trim();
  if (!base) return null;
  return `${base}@g.us`;
};
