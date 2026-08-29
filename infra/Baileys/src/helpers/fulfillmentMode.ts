type FormFieldLike = {
  id?: number;
  label?: string | null;
};

type AnswerLike = {
  fieldId?: number | string;
  answer?: unknown;
};

export type FulfillmentMode = "mesa" | "delivery" | "pickup";

const normalizeValues = (raw: unknown): string[] => {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
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

export const findOrderTypeField = (
  fields: FormFieldLike[] = []
): FormFieldLike | undefined =>
  fields.find((f) => {
    const label = String(f.label || "").toLowerCase();
    return (
      (label.includes("tipo") && (label.includes("pedido") || label.includes("entrega"))) ||
      label.includes("modalidade") ||
      (label.includes("forma") && label.includes("entrega")) ||
      label.includes("retirada")
    );
  });

export const getOrderTypeFieldAnswerText = (
  fields: FormFieldLike[] = [],
  answers: AnswerLike[] = []
): string => {
  const field = findOrderTypeField(fields);
  if (!field?.id) return "";
  const answer = answers.find((a) => Number(a.fieldId) === Number(field.id));
  return normalizeValues(answer?.answer)
    .join(" ")
    .trim()
    .toLowerCase();
};

/** Entrega x retirada x mesa — baseado no campo "Tipo de pedido" e no orderType já resolvido. */
export const inferFulfillmentMode = (
  orderType: "delivery" | "mesa",
  fields: FormFieldLike[] = [],
  answers: AnswerLike[] = []
): FulfillmentMode => {
  if (orderType === "mesa") return "mesa";

  const joined = getOrderTypeFieldAnswerText(fields, answers);
  if (!joined) return "delivery";

  const isPickup =
    joined.includes("retirada") ||
    joined.includes("balcão") ||
    joined.includes("balcao") ||
    joined.includes("local") ||
    joined.includes("pickup") ||
    joined.includes("buscar") ||
    joined.includes("pegar");

  const isDelivery =
    joined.includes("entrega") ||
    joined.includes("delivery") ||
    joined.includes("entregar");

  if (isPickup && !isDelivery) return "pickup";
  if (isDelivery && !isPickup) return "delivery";
  if (isPickup) return "pickup";
  return "delivery";
};
