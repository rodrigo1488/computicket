/** Chaves de dia alinhadas ao UserController / availabilitySettings */
export const ORDER_HOURS_DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type OrderHoursDayKey = (typeof ORDER_HOURS_DAY_KEYS)[number];

const WEEKDAY_LONG_TO_KEY: Record<string, OrderHoursDayKey> = {
  sunday: "sunday",
  monday: "monday",
  tuesday: "tuesday",
  wednesday: "wednesday",
  thursday: "thursday",
  friday: "friday",
  saturday: "saturday",
};

export interface EvaluateCardapioOrderHoursResult {
  allowed: boolean;
  message: string;
}

const DEFAULT_CLOSED_MESSAGE =
  "No momento não estamos aceitando pedidos. Confira nosso horário de funcionamento.";

function parseTimeToMinutes(timeStr: string | undefined | null): number | null {
  if (!timeStr || typeof timeStr !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** "Agora" no fuso: minutos desde meia-noite, chave do dia (sunday..saturday), data YYYY-MM-DD */
export function getLocalPartsInTimezone(
  date: Date,
  timeZone: string
): { minutes: number; dayKey: OrderHoursDayKey; dateKey: string } {
  const tz = timeZone || "America/Sao_Paulo";
  const dtfDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dtfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  const dtfTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const dateKey = dtfDate.format(date);
  const weekdayLong = dtfWeek.format(date).toLowerCase();
  const dayKey = WEEKDAY_LONG_TO_KEY[weekdayLong];
  if (!dayKey) {
    throw new Error(`Weekday not mapped: ${weekdayLong}`);
  }

  const timeParts = dtfTime.formatToParts(date);
  let hour = 0;
  let minute = 0;
  for (const p of timeParts) {
    if (p.type === "hour") hour = Number(p.value);
    if (p.type === "minute") minute = Number(p.value);
  }

  return {
    minutes: hour * 60 + minute,
    dayKey,
    dateKey,
  };
}

/** Intervalo no mesmo dia; suporta virada (end < start): aberto de start até 24:00 e de 00:00 até end */
function isMinutesWithinOrderWindow(
  currentMinutes: number,
  startStr: string,
  endStr: string
): boolean {
  const start = parseTimeToMinutes(startStr);
  const end = parseTimeToMinutes(endStr);
  if (start == null || end == null) return true;

  if (end >= start) {
    return currentMinutes >= start && currentMinutes < end;
  }
  // Virada de madrugada: [start, 1440) U [0, end)
  return currentMinutes >= start || currentMinutes < end;
}

function getDefaultMessage(settings: Record<string, unknown>): string {
  const custom = String(settings.orderHoursMessage ?? "").trim();
  return custom || DEFAULT_CLOSED_MESSAGE;
}

/**
 * Avalia se novos pedidos do cardápio são permitidos "agora" conforme settings do formulário.
 */
const EvaluateCardapioOrderHours = (
  settings: Record<string, unknown> | null | undefined,
  at: Date = new Date()
): EvaluateCardapioOrderHoursResult => {
  const s = settings || {};
  if (!s.orderHoursEnabled) {
    return { allowed: true, message: "" };
  }

  const tz = String(s.orderHoursTimezone || "America/Sao_Paulo");
  const message = getDefaultMessage(s);

  let parts: { minutes: number; dayKey: OrderHoursDayKey; dateKey: string };
  try {
    parts = getLocalPartsInTimezone(at, tz);
  } catch {
    return { allowed: true, message: "" };
  }

  const closedDates = Array.isArray(s.orderHoursClosedDates)
    ? (s.orderHoursClosedDates as unknown[]).map((d) => String(d).trim()).filter(Boolean)
    : [];
  if (closedDates.includes(parts.dateKey)) {
    return { allowed: false, message };
  }

  const mode = String(s.orderHoursMode || "simple");

  if (mode === "weekly") {
    const weekdays = s.orderHoursWeekdays as Record<string, { enabled?: boolean; startTime?: string; endTime?: string }> | undefined;
    const dayCfg = weekdays?.[parts.dayKey];
    if (!dayCfg || !dayCfg.enabled) {
      return { allowed: false, message };
    }
    const startT = dayCfg.startTime ?? "09:00";
    const endT = dayCfg.endTime ?? "22:00";
    if (!isMinutesWithinOrderWindow(parts.minutes, startT, endT)) {
      return { allowed: false, message };
    }
    return { allowed: true, message: "" };
  }

  const start = String(s.orderHoursStart ?? "09:00");
  const end = String(s.orderHoursEnd ?? "22:00");
  if (!isMinutesWithinOrderWindow(parts.minutes, start, end)) {
    return { allowed: false, message };
  }

  return { allowed: true, message: "" };
};

export default EvaluateCardapioOrderHours;
