import formatBody from "./Mustache";

/** Remove marcadores invisiveis usados em mensagens automaticas do sistema. */
export const normalizeMessageBodyForComparison = (
  body: string | null | undefined
): string =>
  String(body || "")
    .trim()
    .toLowerCase()
    .replace(/\u200e/g, "")
    .replace(/\u200c/g, "")
    .trim();

/**
 * Detecta mensagens automaticas do ecossistema Compuchat/WA Web.
 * u200e = saudacao/conclusao/fila; u200c = campanha.
 */
export const isAutomatedInboundMessage = (
  body: string | null | undefined
): boolean => {
  const raw = String(body || "");
  return /^\u200c/.test(raw) || raw.startsWith("\u200e");
};

export const matchesAutomatedTemplate = (
  body: string | null | undefined,
  template: string | null | undefined,
  contact?: { name?: string; number?: string }
): boolean => {
  if (!template) {
    return false;
  }
  const formatted = contact ? formatBody(template, contact as any) : template;
  const normBody = normalizeMessageBodyForComparison(body);
  const normTemplate = normalizeMessageBodyForComparison(formatted);
  if (!normTemplate) {
    return false;
  }
  return normBody === normTemplate || normBody.startsWith(normTemplate);
};

export const isDuplicateAutomatedEcho = (
  body: string | null | undefined,
  templates: Array<string | null | undefined>,
  contact?: { name?: string; number?: string }
): boolean =>
  templates.some((template) =>
    matchesAutomatedTemplate(body, template, contact)
  );
