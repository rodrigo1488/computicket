import {
  isPieceAgainFieldStored,
  isPieceAgainStorableField,
  listPieceAgainStorableFields,
} from "./pieceAgainFields";
import { inferFulfillmentMode } from "./fulfillmentMode";

type FormFieldLike = {
  id?: number;
  label?: string;
  order?: number;
  fieldType?: string;
  metadata?: { isAutoField?: boolean; autoFieldType?: string } | null;
};

type PrintAnswer = {
  fieldId?: number;
  label?: string;
  answer?: unknown;
};

export const isPrintStorableField = isPieceAgainStorableField;
export const listPrintStorableFields = listPieceAgainStorableFields;

export const resolvePrintStoredFieldIds = (
  settings: { printStoredFieldIds?: number[] } | null | undefined,
  fields: FormFieldLike[] = []
): number[] => {
  const storable = listPrintStorableFields(fields);
  const storableIds = new Set(storable.map((f) => Number(f.id)));

  const configured = settings?.printStoredFieldIds;
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

export const filterAnswersForPrint = (
  answers: PrintAnswer[],
  fields: FormFieldLike[],
  storedFieldIds: number[]
): PrintAnswer[] =>
  (answers || []).filter((answer) => {
    const fieldId = Number(answer.fieldId);
    if (!Number.isFinite(fieldId)) return false;
    if (fieldId < 0) return true;
    const field = fields.find((f) => Number(f.id) === fieldId);
    if (!field) return false;
    if (!isPrintStorableField(field)) return false;
    return isPieceAgainFieldStored(field, storedFieldIds);
  });

export const resolvePrintQrModuleSize = (
  settings: { printQrModuleSize?: number } | null | undefined
): number => {
  const raw = Number(settings?.printQrModuleSize ?? 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.min(16, Math.max(4, Math.round(raw)));
};

/** 1=normal, 2=altura dupla, 3=largura+altura duplas (ESC/POS GS !). */
export const resolvePrintFontScale = (
  settings: { printFontScale?: number } | null | undefined
): number => {
  const raw = Number(settings?.printFontScale ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(3, Math.max(1, Math.round(raw)));
};

export const resolveMesaQrPrintSize = (
  settings: { mesaQrPrintSize?: number } | null | undefined
): number => {
  const raw = Number(settings?.mesaQrPrintSize ?? 120);
  if (!Number.isFinite(raw)) return 120;
  return Math.min(280, Math.max(80, Math.round(raw)));
};

/** Reaplica configuração atual de impressão ao payload (ex.: reimpressão). */
export const applyPrintSettingsToConteudo = (
  conteudo: Record<string, unknown>,
  formSettings: {
    printStoredFieldIds?: number[];
    printQrModuleSize?: number;
    printFontScale?: number;
  } | null | undefined,
  fields: FormFieldLike[] = []
): Record<string, unknown> => {
  const printStoredFieldIds = resolvePrintStoredFieldIds(formSettings, fields);
  const printQrModuleSize = resolvePrintQrModuleSize(formSettings);
  const printFontScale = resolvePrintFontScale(formSettings);
  const rawAnswers = Array.isArray(conteudo.answers)
    ? (conteudo.answers as PrintAnswer[])
    : [];
  const allAnswers = Array.isArray(conteudo.allAnswers)
    ? (conteudo.allAnswers as PrintAnswer[])
    : rawAnswers;
  const existingMode = String(conteudo.fulfillmentMode || "").trim();
  const orderType =
    existingMode === "mesa" || (conteudo.metadata as any)?.orderType === "mesa"
      ? "mesa"
      : "delivery";
  const fulfillmentMode =
    existingMode || inferFulfillmentMode(orderType, fields, allAnswers as any);
  return {
    ...conteudo,
    answers: filterAnswersForPrint(rawAnswers, fields, printStoredFieldIds),
    allAnswers,
    printQrModuleSize,
    printFontScale,
    fulfillmentMode,
    pickup: fulfillmentMode === "pickup",
    retirada: fulfillmentMode === "pickup",
  };
};
