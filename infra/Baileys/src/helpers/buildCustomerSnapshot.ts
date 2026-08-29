import FormField from "../models/FormField";
import { buildAnswersMap, isFieldVisible } from "./isFieldVisible";

type AnswerLike = { fieldId: number; answer?: string | string[] | null };

const answerToString = (answer: string | string[] | null | undefined): string => {
  if (answer == null) return "";
  if (Array.isArray(answer)) return answer.map(String).filter(Boolean).join(", ").trim();
  return String(answer).trim();
};

function findByAutoFieldType(
  fields: FormField[] | undefined,
  answers: AnswerLike[] | undefined,
  autoFieldType: string
): string {
  if (!fields?.length || !answers?.length) return "";
  for (const field of fields) {
    const meta = (field.metadata || {}) as Record<string, unknown>;
    if (meta.autoFieldType !== autoFieldType) continue;
    const ans = answers.find((a) => Number(a.fieldId) === Number(field.id));
    const value = answerToString(ans?.answer);
    if (value) return value;
  }
  return "";
}

function findByLabelPatterns(
  fields: FormField[] | undefined,
  answers: AnswerLike[] | undefined,
  patterns: RegExp[]
): string {
  if (!fields?.length || !answers?.length) return "";
  for (const field of fields) {
    const label = String(field.label || "").toLowerCase();
    if (!patterns.some((p) => p.test(label))) continue;
    const ans = answers.find((a) => Number(a.fieldId) === Number(field.id));
    const value = answerToString(ans?.answer);
    if (value) return value;
  }
  return "";
}

export interface CustomerSnapshot {
  customerName: string;
  phone: string;
  endereco: string;
  endereconumero: string;
  enderecobairro: string;
  enderecocomplemento: string;
  enderecoreferencia: string;
  documento: string;
  orderNotes: string;
}

export function buildCustomerSnapshot(
  fields: FormField[] | undefined,
  answers: AnswerLike[] | undefined,
  meta: Record<string, unknown> | null | undefined,
  contactName?: string | null,
  contactPhone?: string | null
): CustomerSnapshot {
  const m = meta || {};
  const endereco =
    findByAutoFieldType(fields, answers, "address") ||
    findByLabelPatterns(fields, answers, [/^endereco$/, /endereço/, /rua/]) ||
    String(m.endereco || "");
  const endereconumero =
    findByAutoFieldType(fields, answers, "number") ||
    findByLabelPatterns(fields, answers, [/n[uú]mero/, /^numero$/]) ||
    String(m.endereconumero || "");
  const enderecobairro =
    findByAutoFieldType(fields, answers, "neighborhood") ||
    findByLabelPatterns(fields, answers, [/bairro/]) ||
    String(m.enderecobairro || "");
  const enderecocomplemento =
    findByAutoFieldType(fields, answers, "complement") ||
    findByLabelPatterns(fields, answers, [/complemento/]) ||
    String(m.enderecocomplemento || "");
  const enderecoreferencia =
    findByAutoFieldType(fields, answers, "reference") ||
    findByLabelPatterns(fields, answers, [/refer[eê]ncia/, /referencia/]) ||
    String(m.enderecoreferencia || "");
  const documento =
    findByAutoFieldType(fields, answers, "document") ||
    findByLabelPatterns(fields, answers, [/cpf/, /cnpj/, /documento/]) ||
    String(m.documento || "");
  const nomeFromAnswers =
    findByAutoFieldType(fields, answers, "name") ||
    findByLabelPatterns(fields, answers, [/nome\s*do\s*cliente/, /nome\s*completo/, /^nome$/, /\bnome\b/]);
  let customerName = String(
    contactName || m.customerName || m.clienteNome || nomeFromAnswers || ""
  ).trim();
  if (!customerName) customerName = "Cliente";
  const phone = String(contactPhone || m.customerPhone || m.phone || "").trim();
  const orderNotes = String(m.orderNotes || m.observacao || m.notes || "").trim();
  return {
    customerName,
    phone,
    endereco: String(endereco).trim(),
    endereconumero: String(endereconumero).trim(),
    enderecobairro: String(enderecobairro).trim(),
    enderecocomplemento: String(enderecocomplemento).trim(),
    enderecoreferencia: String(enderecoreferencia).trim(),
    documento: String(documento).trim(),
    orderNotes,
  };
}

export function deliveryAddressRequired(
  fields: FormField[] | undefined,
  orderType: string,
  answers: AnswerLike[] | undefined = [],
  fulfillmentMode?: string
): boolean {
  if (orderType !== "delivery") return false;
  if (fulfillmentMode === "pickup") return false;
  if (!fields?.length) return false;
  const answersMap = buildAnswersMap(answers);
  return fields.some((field) => {
    if (!field.isRequired) return false;
    if (
      field.hasConditional &&
      !isFieldVisible(field, answersMap, fields)
    ) {
      return false;
    }
    const meta = (field.metadata || {}) as Record<string, unknown>;
    const auto = String(meta.autoFieldType || "");
    if (auto === "address") return true;
    const label = String(field.label || "").toLowerCase();
    return /endereço/.test(label) || /^endereco$/.test(label) || /rua/.test(label);
  });
}
