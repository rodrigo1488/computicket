const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isTicketUuid = (value: string): boolean =>
  UUID_REGEX.test(value.trim());

/** ID numérico na URL (legado: /tickets/42) */
export const isNumericTicketId = (value: string): boolean =>
  /^\d+$/.test(value.trim());

export type TicketLookup =
  | { field: "uuid"; value: string }
  | { field: "id"; value: number };

/**
 * Aceita UUID ou ID numérico (rotas /tickets/u/:param e /tickets/:ticketId).
 */
export const parseTicketRouteIdentifier = (
  raw: string | undefined | null
): TicketLookup | null => {
  const value = raw != null ? String(raw).trim() : "";
  if (!value || value === "undefined") return null;
  if (isTicketUuid(value)) return { field: "uuid", value };
  if (isNumericTicketId(value)) {
    return { field: "id", value: parseInt(value, 10) };
  }
  return null;
};
