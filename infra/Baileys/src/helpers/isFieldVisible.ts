type FormFieldLike = {
  id?: number;
  hasConditional?: boolean;
  conditionalFieldId?: number | null;
  conditionalFieldIndex?: number | null;
  conditionalRules?: {
    operator?: string;
    value?: unknown;
  } | null;
  order?: number;
};

const isEmpty = (val: unknown): boolean => {
  if (val === undefined || val === null) return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  return false;
};

const normStr = (val: unknown): string => String(val ?? "").trim().toLowerCase();

export const buildAnswersMap = (
  answers: Array<{ fieldId?: number; answer?: unknown }>
): Record<string, unknown> => {
  const map: Record<string, unknown> = {};
  for (const item of answers) {
    if (item.fieldId == null) continue;
    map[item.fieldId] = item.answer;
    map[String(item.fieldId)] = item.answer;
    map[Number(item.fieldId)] = item.answer;
  }
  return map;
};

const resolveSourceFieldId = (
  field: FormFieldLike,
  allFields: FormFieldLike[] = []
): number | null => {
  if (field.conditionalFieldId != null) {
    return Number(field.conditionalFieldId);
  }
  if (
    typeof field.conditionalFieldIndex === "number" &&
    allFields.length > 0
  ) {
    const sorted = [...allFields].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    const source = sorted[field.conditionalFieldIndex];
    return source?.id != null ? Number(source.id) : null;
  }
  return null;
};

export const isFieldVisible = (
  field: FormFieldLike & { id?: number },
  answersMap: Record<string, unknown>,
  allFields: FormFieldLike[] = []
): boolean => {
  if (!field.hasConditional) return true;

  const sourceFieldId = resolveSourceFieldId(field, allFields);
  if (sourceFieldId == null) return false;

  const rules = field.conditionalRules || {};
  const operator = rules.operator || "equals";
  const expectedValue = rules.value;

  const answerValue =
    answersMap[sourceFieldId] ??
    answersMap[String(sourceFieldId)] ??
    answersMap[Number(sourceFieldId)];

  switch (operator) {
    case "equals":
      if (expectedValue === undefined || expectedValue === null) return false;
      if (Array.isArray(answerValue)) {
        return (answerValue as unknown[]).some(
          (v) => normStr(v) === normStr(expectedValue)
        );
      }
      return normStr(answerValue) === normStr(expectedValue);
    case "notEquals":
      if (expectedValue === undefined || expectedValue === null) return false;
      if (Array.isArray(answerValue)) {
        return !(answerValue as unknown[]).some(
          (v) => normStr(v) === normStr(expectedValue)
        );
      }
      return normStr(answerValue) !== normStr(expectedValue);
    case "contains":
      if (expectedValue === undefined || expectedValue === null) return false;
      return String(answerValue || "")
        .toLowerCase()
        .includes(String(expectedValue || "").toLowerCase());
    case "isEmpty":
      return isEmpty(answerValue);
    case "isNotEmpty":
      return !isEmpty(answerValue);
    case "isTrue": {
      if (Array.isArray(answerValue)) return answerValue.length > 0;
      const strVal = String(answerValue || "").toLowerCase();
      return (
        strVal === "true" ||
        strVal === "sim" ||
        strVal === "yes" ||
        strVal === "1" ||
        answerValue === true
      );
    }
    case "isFalse": {
      if (Array.isArray(answerValue)) return answerValue.length === 0;
      const strVal = String(answerValue || "").toLowerCase();
      return (
        strVal === "false" ||
        strVal === "não" ||
        strVal === "nao" ||
        strVal === "no" ||
        strVal === "0" ||
        answerValue === false ||
        isEmpty(answerValue)
      );
    }
    default:
      return false;
  }
};
