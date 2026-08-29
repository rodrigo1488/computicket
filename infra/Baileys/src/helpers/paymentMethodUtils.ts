import FormField from "../models/FormField";
import ResponseAnswer from "../models/ResponseAnswer";
import FormResponse from "../models/FormResponse";

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  carteira_digital: "Carteira digital",
  outro: "Outro",
};

const normalizeText = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const answerToString = (answer: unknown): string => {
  if (answer == null) return "";
  if (Array.isArray(answer)) {
    return answer.map((v) => String(v ?? "").trim()).filter(Boolean).join(", ");
  }
  if (typeof answer === "object") {
    const obj = answer as Record<string, unknown>;
    if (obj.value != null) return answerToString(obj.value);
    if (obj.label != null) return answerToString(obj.label);
    if (obj.answer != null) return answerToString(obj.answer);
    return "";
  }
  return String(answer).trim();
};

export const isPaymentFieldLabel = (label: unknown): boolean => {
  const l = normalizeText(label);
  if (!l) return false;
  return (
    /pagamento/.test(l) ||
    /forma\s*de\s*pag/.test(l) ||
    /meio\s*de\s*pag/.test(l) ||
    /metodo\s*de\s*pag/.test(l) ||
    /tipo\s*de\s*pag/.test(l)
  );
};

export const normalizePaymentMethod = (raw: unknown): string => {
  const v = normalizeText(raw);
  if (!v) return "outro";
  if (v.includes("pix")) return "pix";
  if (v.includes("dinheiro") || v.includes("especie") || v.includes("cash")) return "dinheiro";
  if (
    v.includes("cartao") ||
    v.includes("credito") ||
    v.includes("debito") ||
    v.includes("card")
  ) {
    return "cartao";
  }
  if (v.includes("carteira")) return "carteira_digital";
  if (v.includes("outro")) return "outro";
  return "outro";
};

export const paymentMethodLabel = (metodo: string): string =>
  PAYMENT_METHOD_LABELS[normalizePaymentMethod(metodo)] || PAYMENT_METHOD_LABELS.outro;

export const buildMeiosPagamentoForValor = (
  metodo: string,
  valor: number
): Array<{ metodo: string; valor: number }> => [
  {
    metodo: normalizePaymentMethod(metodo),
    valor: Math.round(Number(valor || 0) * 100) / 100,
  },
];

type AnswerLike = {
  fieldId?: number;
  answer?: unknown;
  answerData?: unknown;
  field?: FormField | null;
};

export const extractPaymentMethodFromAnswers = (
  answers: AnswerLike[] = [],
  fields: FormField[] = []
): string => {
  for (const answer of answers) {
    const field =
      answer.field || fields.find((f) => Number(f.id) === Number(answer.fieldId));
    const autoType = normalizeText((field?.metadata as any)?.autoFieldType);
    const label = field?.label || "";
    if (!isPaymentFieldLabel(label) && autoType !== "payment") continue;

    const raw = answer.answer ?? answer.answerData;
    const text = answerToString(raw);
    if (text) return normalizePaymentMethod(text);
  }
  return "outro";
};

export const extractPaymentMethodFromResponse = (
  response: FormResponse | null | undefined
): string => {
  if (!response) return "outro";
  const meta = (response.metadata || {}) as Record<string, unknown>;
  if (meta.paymentMethod) {
    return normalizePaymentMethod(meta.paymentMethod);
  }
  const answers = ((response as any).answers || []) as ResponseAnswer[];
  const fields = answers
    .map((a) => (a as any).field as FormField | undefined)
    .filter(Boolean) as FormField[];
  return extractPaymentMethodFromAnswers(
    answers.map((a) => ({
      fieldId: a.fieldId,
      answer: a.answer,
      answerData: (a as any).answerData,
      field: (a as any).field,
    })),
    fields
  );
};

export const resolveEntregadorDisplayName = (
  record: { entregadorNome?: string | null; entregadorUserId?: number | null },
  userNames: Map<number, string> = new Map()
): string | null => {
  const nome = String(record.entregadorNome || "").trim();
  if (nome) return nome;
  const uid = Number(record.entregadorUserId);
  if (Number.isFinite(uid) && uid > 0) {
    const fromUser = userNames.get(uid);
    if (fromUser) return fromUser;
  }
  return null;
};

export const isIdentifiedEntregadorName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const n = normalizeText(name);
  return n !== "outro" && n !== "sem nome" && n !== "nao identificado";
};
