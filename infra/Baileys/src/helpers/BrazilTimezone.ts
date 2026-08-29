/**
 * Retorna início e fim do dia no fuso de Brasília (America/Sao_Paulo, UTC-3).
 * Usado para protocolo PED-YYYYMMDD, vendas do dia e qualquer filtro por "hoje".
 * O banco guarda submittedAt em UTC; ao filtrar por "dia no Brasil" usamos estes limites.
 */
const BRASIL_UTC_OFFSET_HOURS = 3; // 00:00 BRT = 03:00 UTC

export function getBrazilDayBounds(now: Date = new Date()): { startOfDay: Date; endOfDay: Date } {
  const ms = now.getTime() - BRASIL_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const brazil = new Date(ms);
  const y = brazil.getUTCFullYear();
  const m = brazil.getUTCMonth();
  const d = brazil.getUTCDate();
  const startOfDay = new Date(Date.UTC(y, m, d, BRASIL_UTC_OFFSET_HOURS, 0, 0, 0));
  const endOfDay = new Date(
    Date.UTC(y, m, d + 1, BRASIL_UTC_OFFSET_HOURS - 1, 59, 59, 999)
  );
  return { startOfDay, endOfDay };
}

/** Retorna YYYYMMDD do dia atual no fuso de Brasília (para protocolo PED-YYYYMMDD-NNNN). */
export function getBrazilDateString(now: Date = new Date()): string {
  const ms = now.getTime() - BRASIL_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const brazil = new Date(ms);
  const y = brazil.getUTCFullYear();
  const m = brazil.getUTCMonth() + 1;
  const d = brazil.getUTCDate();
  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

/** Retorna YYYY-MM-DD do dia atual no fuso de Brasília. */
export function getBrazilISODateString(now: Date = new Date()): string {
  const ms = now.getTime() - BRASIL_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const brazil = new Date(ms);
  const y = brazil.getUTCFullYear();
  const m = brazil.getUTCMonth() + 1;
  const d = brazil.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Retorna YYYY-MM-01 (início do mês) no fuso de Brasília. */
export function getBrazilMonthStartString(now: Date = new Date()): string {
  const ms = now.getTime() - BRASIL_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const brazil = new Date(ms);
  const y = brazil.getUTCFullYear();
  const m = brazil.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * Dado um date string YYYY-MM-DD (ex.: do frontend), retorna início e fim desse dia no fuso de Brasília em UTC.
 * Útil para filtrar por "dia" quando o usuário seleciona uma data no calendário.
 */
export function getBrazilDayBoundsForDateString(isoDate: string): { startOfDay: Date; endOfDay: Date } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const startOfDay = new Date(Date.UTC(y, m - 1, d, BRASIL_UTC_OFFSET_HOURS, 0, 0, 0));
  const endOfDay = new Date(
    Date.UTC(y, m - 1, d + 1, BRASIL_UTC_OFFSET_HOURS - 1, 59, 59, 999)
  );
  return { startOfDay, endOfDay };
}
