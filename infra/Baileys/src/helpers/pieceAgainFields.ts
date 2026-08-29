type FormFieldLike = {
  id?: number;
  label?: string;
  order?: number;
  fieldType?: string;
  metadata?: { isAutoField?: boolean; autoFieldType?: string } | null;
};

const EXCLUDED_AUTO_TYPES = new Set([
  "name",
  "phone",
  "supplierName",
  "sellerName",
]);

export const isSensitivePieceAgainLabel = (label: string): boolean =>
  /cpf|cart[aã]o|card|senha|password|cvv|cvc|token|c[oó]digo|pin/i.test(
    String(label || "")
  );

/** Campos elegíveis para aparecer na configuração do “Peça de novo”. */
export const isPieceAgainStorableField = (field: FormFieldLike): boolean => {
  const meta = (field.metadata || {}) as { isAutoField?: boolean; autoFieldType?: string };
  const autoType = String(meta.autoFieldType || "");
  if (meta.isAutoField && EXCLUDED_AUTO_TYPES.has(autoType)) return false;
  if (field.fieldType === "phone" || field.fieldType === "email") return false;
  if (field.fieldType === "file") return false;
  const label = String(field.label || "").trim();
  if (!label || isSensitivePieceAgainLabel(label)) return false;
  if (meta.isAutoField) return false;
  if ((field.order ?? 0) < 2) return false;
  return field.id != null;
};

export const listPieceAgainStorableFields = (
  fields: FormFieldLike[] = []
): FormFieldLike[] =>
  [...fields]
    .filter(isPieceAgainStorableField)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const resolvePieceAgainStoredFieldIds = (
  settings: { pieceAgainStoredFieldIds?: number[] } | null | undefined,
  fields: FormFieldLike[] = []
): number[] => {
  const storable = listPieceAgainStorableFields(fields);
  const storableIds = new Set(storable.map((f) => Number(f.id)));

  const configured = settings?.pieceAgainStoredFieldIds;
  if (!Array.isArray(configured)) {
    return storable.map((f) => Number(f.id));
  }
  if (configured.length === 0) {
    return [];
  }
  return configured
    .map((id) => Number(id))
    .filter((id) => id > 0 && storableIds.has(id));
};

export const isPieceAgainFieldStored = (
  field: FormFieldLike,
  storedFieldIds: number[]
): boolean => {
  if (field.id == null) return false;
  return storedFieldIds.includes(Number(field.id));
};

export const toPieceAgainValueString = (val: unknown): string => {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return "__json__:" + JSON.stringify(val);
  return String(val);
};

export const decodePieceAgainValue = (val: unknown): unknown => {
  const str = typeof val === "string" ? val : String(val ?? "");
  if (str.startsWith("__json__:")) {
    try {
      return JSON.parse(str.replace("__json__:", ""));
    } catch {
      return str;
    }
  }
  return str;
};

export const buildPieceAgainEntriesFromAnswers = (
  answers: Array<{ fieldId?: number; answer?: unknown }>,
  fields: FormFieldLike[],
  storedFieldIds: number[]
): Array<{ name: string; value: string }> => {
  const storedSet = new Set(storedFieldIds.map(Number));

  return answers
    .map((answer) => {
      const field = fields.find((f) => f.id === answer.fieldId);
      if (!field || !isPieceAgainFieldStored(field, storedFieldIds)) return null;
      if (!isPieceAgainStorableField(field)) return null;

      const label = String(field.label || "").trim();
      const valueStr = toPieceAgainValueString(answer.answer);
      if (!valueStr || valueStr.trim() === "") return null;
      if (storedSet.has(Number(field.id))) {
        return { name: label, value: valueStr };
      }
      return null;
    })
    .filter((x): x is { name: string; value: string } => x !== null);
};

export const filterPieceAgainPrefillByLabel = (
  prefillByLabel: Record<string, unknown>,
  fields: FormFieldLike[],
  storedFieldIds: number[]
): Record<string, unknown> => {
  const allowedLabels = new Set(
    fields
      .filter((f) => isPieceAgainFieldStored(f, storedFieldIds))
      .map((f) => String(f.label || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const filtered: Record<string, unknown> = {};
  Object.entries(prefillByLabel || {}).forEach(([label, value]) => {
    const key = String(label || "").trim().toLowerCase();
    if (!key || !allowedLabels.has(key)) return;
    if (value == null || String(value).trim() === "") return;
    filtered[label] = value;
  });
  return filtered;
};
