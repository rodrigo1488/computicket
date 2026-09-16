/** ID AnyDesk: 9 dígitos, ou 9/10 com separador no estilo 123 456 789. */
const ANYDESK_ID_RE = /(?<!\d)(\d{3}[\s.\-]\d{3}[\s.\-]\d{3,4}|\d{9})(?!\d)/g;

export type AnyDeskTextPart =
  | { kind: "text"; raw: string }
  | { kind: "anydesk"; raw: string; digits: string };

export function anydeskDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function isAnyDeskId(digits: string) {
  return digits.length === 9 || digits.length === 10;
}

export function findAnyDeskIds(text: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of splitAnyDeskParts(text)) {
    if (part.kind !== "anydesk" || seen.has(part.digits)) continue;
    seen.add(part.digits);
    ids.push(part.digits);
  }
  return ids;
}

export function splitAnyDeskParts(text: string): AnyDeskTextPart[] {
  if (!text) return [];
  const parts: AnyDeskTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(ANYDESK_ID_RE)) {
    const raw = match[1];
    const digits = anydeskDigits(raw);
    if (!isAnyDeskId(digits)) continue;
    const idx = match.index ?? 0;
    if (idx > last) parts.push({ kind: "text", raw: text.slice(last, idx) });
    parts.push({ kind: "anydesk", raw, digits });
    last = idx + raw.length;
  }
  if (last < text.length) parts.push({ kind: "text", raw: text.slice(last) });
  if (!parts.length) parts.push({ kind: "text", raw: text });
  return parts;
}

export function anydeskHref(id: string) {
  return `anydesk:${anydeskDigits(id)}`;
}

export function openAnyDesk(id: string) {
  const digits = anydeskDigits(id);
  if (!isAnyDeskId(digits) || typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = anydeskHref(digits);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
