import Form from "../models/Form";
import FormField from "../models/FormField";
import FormResponse from "../models/FormResponse";
import ResponseAnswer from "../models/ResponseAnswer";
import { inferFulfillmentMode } from "./fulfillmentMode";
import {
  filterAnswersForPrint,
  resolvePrintFontScale,
  resolvePrintQrModuleSize,
  resolvePrintStoredFieldIds,
} from "./printFields";

type AnswerLike = {
  fieldId?: number;
  answer?: unknown;
  label?: string;
};

export type BuildPrintConteudoParams = {
  form: Form;
  response: FormResponse;
  fields: FormField[];
  menuItems: Record<string, unknown>[];
  answers?: AnswerLike[];
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  triggeredOrderMessages?: string[];
};

/** Monta payload de impressão a partir do pedido atual (reimpressão / edição). */
export const buildPrintConteudoFromResponse = ({
  form,
  response,
  fields,
  menuItems,
  answers = [],
  contactName,
  contactPhone,
  contactEmail,
  triggeredOrderMessages = [],
}: BuildPrintConteudoParams): Record<string, unknown> => {
  const formSettings = (form.settings || {}) as Record<string, unknown>;
  const meta = (response.metadata || {}) as Record<string, unknown>;
  const orderType = meta.orderType === "delivery" ? "delivery" : "mesa";
  const fulfillmentMode =
    (meta.fulfillmentMode as string) ||
    inferFulfillmentMode(orderType, fields, answers as any);
  const printStoredFieldIds = resolvePrintStoredFieldIds(formSettings, fields);
  const printQrModuleSize = resolvePrintQrModuleSize(formSettings);
  const printFontScale = resolvePrintFontScale(formSettings);

  const mappedAnswers = answers.map((answer) => {
    const field = fields.find((f) => Number(f.id) === Number(answer.fieldId));
    return {
      fieldId: answer.fieldId,
      label: answer.label || field?.label || "",
      answer: answer.answer,
    };
  });

  const answersForPrint = filterAnswersForPrint(
    mappedAnswers.concat(
      triggeredOrderMessages.map((message, index) => ({
        fieldId: -(index + 1),
        label: "Mensagem automática",
        answer: message,
      }))
    ),
    fields,
    printStoredFieldIds
  );

  const menuItemsForPayload = (menuItems || []).map((it: any) => ({
    ...it,
    quantity: it.quantity ?? 1,
    productName: it.productName ?? it.name,
    productValue: it.productValue ?? 0,
    grupo: it.grupo ?? "Outros",
    addons: Array.isArray(it.addons) ? it.addons : [],
    addonsTotal: typeof it.addonsTotal === "number" ? it.addonsTotal : 0,
  }));

  const deliveryFeeRaw =
    orderType === "delivery" ? Number(meta.deliveryFee ?? 0) : 0;
  const deliveryFee =
    Math.round((Number.isFinite(deliveryFeeRaw) ? deliveryFeeRaw : 0) * 100) /
    100;

  const name =
    contactName ||
    response.responderName ||
    String(meta.customerName || "Cliente");
  const phone = contactPhone || response.responderPhone || "";
  const email = contactEmail || response.responderEmail || "";

  const conteudo: Record<string, unknown> = {
    event: "form.submitted",
    formId: form.id,
    formName: form.name,
    responseId: response.id,
    formResponseId: response.id,
    protocol: response.protocol,
    submittedAt: response.submittedAt,
    tableNumber: String(meta.tableNumber || ""),
    garcomName: String(meta.garcomName || ""),
    deliveryFee,
    responder: { name, phone, email },
    answers: answersForPrint,
    allAnswers: mappedAnswers,
    menuItems: menuItemsForPayload,
    printQrModuleSize,
    printFontScale,
    fulfillmentMode,
    pickup: fulfillmentMode === "pickup",
    retirada: fulfillmentMode === "pickup",
    metadata: {
      fulfillmentMode,
      pickup: fulfillmentMode === "pickup",
      retirada: fulfillmentMode === "pickup",
    },
  };

  if (
    orderType === "delivery" &&
    fulfillmentMode !== "pickup" &&
    meta.deliveryScanToken
  ) {
    const token = String(meta.deliveryScanToken);
    conteudo.deliveryScanToken = token;
    const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "";
    if (baseUrl) {
      conteudo.deliveryScanUrl = `${baseUrl.replace(/\/$/, "")}/entregador?t=${encodeURIComponent(token)}`;
    }
  }

  return conteudo;
};

export const mapResponseAnswers = (
  answers: ResponseAnswer[] = [],
  fields: FormField[] = []
): AnswerLike[] =>
  answers.map((a) => {
    const field =
      (a as any).field || fields.find((f) => Number(f.id) === Number(a.fieldId));
    return {
      fieldId: a.fieldId,
      answer: a.answer,
      label: field?.label || "",
    };
  });
