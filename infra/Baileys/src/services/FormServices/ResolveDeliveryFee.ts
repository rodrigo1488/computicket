type FormLike = {
  settings?: any;
  fields?: Array<{ id?: number; label?: string | null }>;
};

type AnswerLike = {
  fieldId: number | string;
  answer?: any;
};

const normalizeValues = (raw: any): string[] => {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v ?? "").trim())
      .filter(Boolean);
  }
  if (typeof raw === "object") {
    try {
      return [JSON.stringify(raw)];
    } catch {
      return [String(raw)];
    }
  }
  const text = String(raw).trim();
  if (!text) return [];
  if (text.includes(",") && !text.startsWith("{") && !text.startsWith("[")) {
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [text];
};

const getAnswerValues = (answers: AnswerLike[] | undefined, fieldId: number | string): string[] => {
  const answer = (answers || []).find((a) => Number(a.fieldId) === Number(fieldId));
  return normalizeValues(answer?.answer);
};

const isEmptyAnswer = (values: string[]): boolean => values.length === 0;

const isConditionMet = (
  condition: { fieldId?: number | string; operator?: string; value?: string } | null | undefined,
  answers: AnswerLike[] | undefined
): boolean => {
  if (!condition?.fieldId) return true;
  const rawValues = getAnswerValues(answers, condition.fieldId);
  const values = rawValues.map((v) => v.toLowerCase());
  const expected = String(condition.value ?? "").trim().toLowerCase();
  const op = String(condition.operator || "equals");

  switch (op) {
    case "notEquals":
    case "not_equals":
      if (!expected) return false;
      return !values.includes(expected);
    case "contains":
      if (!expected) return false;
      return values.some((v) => v.includes(expected));
    case "isEmpty":
      return isEmptyAnswer(rawValues);
    case "isNotEmpty":
      return !isEmptyAnswer(rawValues);
    case "isTrue":
      return values.some((v) => ["true", "sim", "yes", "1"].includes(v));
    case "isFalse":
      return isEmptyAnswer(rawValues) || values.some((v) => ["false", "não", "nao", "no", "0"].includes(v));
    case "equals":
    default:
      if (!expected) return !isEmptyAnswer(rawValues);
      return values.includes(expected);
  }
};

const inferOrderTypeFromAnswers = (
  form: FormLike,
  answers: AnswerLike[] | undefined
): "delivery" | "mesa" | null => {
  const fields = form.fields || [];
  const tipoField = fields.find((f) => {
    const label = String(f.label || "").toLowerCase();
    return label.includes("tipo") && (label.includes("pedido") || label.includes("entrega"));
  });
  if (!tipoField?.id) return null;

  const values = getAnswerValues(answers, tipoField.id).map((v) => v.toLowerCase());
  const joined = values.join(" ");
  if (joined.includes("mesa")) {
    return "mesa";
  }
  if (
    joined.includes("delivery") ||
    joined.includes("entrega") ||
    joined.includes("retirada") ||
    joined.includes("balcão") ||
    joined.includes("balcao") ||
    joined.includes("local")
  ) {
    return "delivery";
  }
  return null;
};

/**
 * Resolve orderType + deliveryFee from form settings and answers.
 * Prefer server-side calculation so the fee does not depend only on client metadata.
 */
const ResolveDeliveryFee = (
  form: FormLike,
  answers: AnswerLike[] | undefined,
  metadata?: Record<string, any> | null
): { orderType: "delivery" | "mesa"; deliveryFee: number } => {
  const settings = form?.settings || {};
  const mesasEnabled = settings.mesas !== false;
  const deliveryEnabled = settings.delivery !== false;
  const configuredFee = Number(settings.deliveryFee) || 0;
  const feeCondition = settings.deliveryFeeCondition || null;
  const fields = form.fields || [];

  let orderType: "delivery" | "mesa" | null = null;

  // Mesa via QR/garçom — tableId sozinho (localStorage) não força mesa
  if (
    (metadata?.orderToken || metadata?.placedByGarcom || metadata?.garcomName) &&
    (metadata?.tableId || metadata?.tableNumber)
  ) {
    orderType = "mesa";
  } else {
    // Preferir resposta do cliente (tipo de pedido) ao metadata do front —
    // metadata.orderType já veio errado em alguns casos (condição da taxa).
    orderType = inferOrderTypeFromAnswers(form, answers);
    if (!orderType) {
      if (metadata?.orderType === "mesa" || metadata?.orderType === "delivery") {
        orderType = metadata.orderType;
      }
    }
  }

  if (!orderType) {
    if (deliveryEnabled) orderType = "delivery";
    else if (mesasEnabled) orderType = "mesa";
    else orderType = "delivery";
  }

  if (orderType !== "delivery" || configuredFee <= 0) {
    return { orderType, deliveryFee: 0 };
  }

  // Condition only applies when the referenced field still exists on the form.
  // Stale fieldIds (after remaps) must not silently zero the delivery fee.
  if (feeCondition?.fieldId) {
    const fieldExists = fields.some((f) => Number(f.id) === Number(feeCondition.fieldId));
    if (fieldExists && !isConditionMet(feeCondition, answers)) {
      return { orderType, deliveryFee: 0 };
    }
  }

  return { orderType, deliveryFee: configuredFee };
};

export default ResolveDeliveryFee;
