import { Op, Sequelize } from "sequelize";
import Form from "../../models/Form";
import FormField from "../../models/FormField";
import FormResponse from "../../models/FormResponse";
import ResponseAnswer from "../../models/ResponseAnswer";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import CreateTicketService from "../TicketServices/CreateTicketService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import FormatMenuOrderMessage from "./FormatMenuOrderMessage";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import AppError from "../../errors/AppError";
import PrintDevice from "../../models/PrintDevice";
import CreateAndDispatchPrintJobService from "../PrintJobService/CreateAndDispatchPrintJobService";
import BuildUniplusDeliveryPayloadService, {
  resolveUniplusDeviceId,
} from "../UniplusServices/BuildUniplusDeliveryPayloadService";
import CreateOrReuseUniplusJobService from "../UniplusServices/CreateOrReuseUniplusJobService";
import { patchFormResponseUniplusMetadata } from "../UniplusServices/patchFormResponseUniplusMetadata";
import { logger } from "../../utils/logger";
import OcuparMesaService from "../MesaServices/OcuparMesaService";
import Mesa from "../../models/Mesa";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import Ticket from "../../models/Ticket";
import { verifyOrderToken, createDeliveryScanToken, createOrderTrackingToken } from "../../helpers/MesaLinkSign";
import ValidateCouponService from "../CouponServices/ValidateCouponService";
import AddOnGroup from "../../models/AddOnGroup";
import AddOnSubgroup from "../../models/AddOnSubgroup";
import Product from "../../models/Product";
import Appointment from "../../models/Appointment";
import AppointmentService from "../../models/AppointmentService";
import FormatAppointmentConfirmationMessage from "./FormatAppointmentConfirmationMessage";
import { createAppointmentToken } from "../../helpers/MesaLinkSign";
import ProductVariation from "../../models/ProductVariation";
import ProductVariationOption from "../../models/ProductVariationOption";
import ProductComboItem from "../../models/ProductComboItem";
import AddOnItem from "../../models/AddOnItem";
import GrupoAddOn from "../../models/GrupoAddOn";
import { normalizeBrazilPhoneForWhatsapp } from "../../helpers/NormalizeBrazilPhone";
import { getBrazilDayBounds, getBrazilDateString } from "../../helpers/BrazilTimezone";
import EvaluateCardapioOrderHours from "./EvaluateCardapioOrderHours";
import ResolveDeliveryFee from "./ResolveDeliveryFee";
import { inferFulfillmentMode } from "../../helpers/fulfillmentMode";
import sequelize from "../../database";
import {
  buildCustomerSnapshot,
  deliveryAddressRequired,
} from "../../helpers/buildCustomerSnapshot";
import { generateOrderProtocol } from "../../helpers/generateOrderProtocol";
import { buildAnswersMap, isFieldVisible } from "../../helpers/isFieldVisible";
import {
  buildPieceAgainEntriesFromAnswers,
  resolvePieceAgainStoredFieldIds,
} from "../../helpers/pieceAgainFields";
import {
  filterAnswersForPrint,
  resolvePrintFontScale,
  resolvePrintQrModuleSize,
  resolvePrintStoredFieldIds,
} from "../../helpers/printFields";

interface Answer {
  fieldId: number;
  answer: string | string[];
  answerData?: object;
  fileUrl?: string;
}

interface OrderTriggerMessageRule {
  fieldId: number;
  optionValue: string;
  message: string;
}

interface Request {
  formId: number;
  answers: Answer[];
  quotationItems?: object[];
  menuItems?: Array<{
    productId: number;
    quantity: number;
    productName?: string;
    productValue?: number;
    grupo?: string;
    observation?: string;
    addons?: Array<{ addOnItemId: number; label?: string; value?: number }>;
  }>;
  responderPhone?: string;
  responderEmail?: string;
  responderName?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: object;
  clientOrderId?: string;
  /** Token de sessão da mesa (retornado ao abrir link assinado). Garante que o pedido vá para a mesa correta. */
  orderToken?: string;
  /** true quando o submit vem com JWT da mesma empresa (ex.: PDV Mesas) — ignora bloqueio de horário do cardápio. */
  orderHoursBypass?: boolean;
}

type MenuItemInput = {
  productId?: number;
  quantity: number;
  productName?: string;
  productValue?: number;
  grupo?: string;
  type?: string;
  half1ProductId?: number;
  half2ProductId?: number;
  half1OptionId?: number | null;
  half2OptionId?: number | null;
  observation?: string;
  addons?: Array<{ addOnItemId: number; label?: string; value?: number }>;
  comboItems?: Array<{
    productId: number;
    productName?: string;
    value: number;
    quantity: number;
    idUniplus?: string | null;
    variationOptionId?: number | null;
  }>;
};

/** Observação do cliente por item: texto simples, limitado. */
const sanitizeObservation = (value: unknown): string =>
  String(value ?? "").trim().slice(0, 200);

/** Resolve o addOnGroupId de um produto (próprio ou herdado da categoria). */
const resolveAddOnGroupIdForProduct = async (
  productId: number,
  companyId: number
): Promise<number | null> => {
  const product = await Product.findOne({
    where: { id: productId, companyId },
    attributes: ["id", "addOnGroupId", "grupo"],
  });
  if (!product) return null;
  let addOnGroupId: number | null = (product as any).addOnGroupId;
  if (addOnGroupId == null && (product as any).grupo) {
    const ga = await GrupoAddOn.findOne({
      where: { companyId, grupo: (product as any).grupo },
      attributes: ["addOnGroupId"],
    });
    if (ga) addOnGroupId = ga.addOnGroupId;
  }
  return addOnGroupId;
};

/**
 * Valida regras de adicionais obrigatórios (min/max) por subgrupo e no grupo raiz.
 * `addons` chega expandido (uma entrada por unidade), então a contagem por unidade
 * é o total do subgrupo dividido pela quantidade do item.
 */
const validateAddonRules = async (
  addOnGroupId: number,
  addons: Array<{ addOnItemId: number }>,
  quantity: number,
  productName: string
): Promise<void> => {
  const group = await AddOnGroup.findByPk(addOnGroupId, {
    include: [
      { model: AddOnSubgroup, as: "subgroups", include: [{ model: AddOnItem, as: "items" }] },
      { model: AddOnItem, as: "items" },
    ],
  });
  if (!group) return;

  const qty = Math.max(1, quantity || 1);
  const countByItemId = new Map<number, number>();
  for (const a of addons || []) {
    countByItemId.set(a.addOnItemId, (countByItemId.get(a.addOnItemId) || 0) + 1);
  }
  const countForItems = (items: Array<{ id: number }>) =>
    (items || []).reduce((sum, it) => sum + (countByItemId.get(it.id) || 0), 0) / qty;

  const checkRules = (
    label: string,
    perUnit: number,
    required: boolean,
    minItems: number,
    maxItems: number | null
  ) => {
    const min = required ? Math.max(1, minItems || 0) : minItems || 0;
    if (min > 0 && perUnit < min) {
      throw new AppError(
        `${productName}: escolha pelo menos ${min} em "${label}".`,
        400
      );
    }
    if (maxItems != null && maxItems > 0 && perUnit > maxItems) {
      throw new AppError(
        `${productName}: escolha no máximo ${maxItems} em "${label}".`,
        400
      );
    }
  };

  for (const sg of (group.subgroups || []) as any[]) {
    if (!sg.required && !(Number(sg.minItems) > 0) && sg.maxItems == null) continue;
    checkRules(
      sg.name,
      countForItems(sg.items || []),
      sg.required === true,
      Number(sg.minItems) || 0,
      sg.maxItems != null ? Number(sg.maxItems) : null
    );
  }

  const rootItems = ((group.items || []) as any[]).filter((it) => !it.addOnSubgroupId);
  const g = group as any;
  if (rootItems.length > 0 && (g.required === true || Number(g.minItems) > 0 || g.maxItems != null)) {
    checkRules(
      group.name,
      countForItems(rootItems),
      g.required === true,
      Number(g.minItems) || 0,
      g.maxItems != null ? Number(g.maxItems) : null
    );
  }
};

/** Normaliza menuItems: halfAndHalf / combo recalculam productValue e snapshot no backend. */
export const normalizeMenuItems = async (
  items: MenuItemInput[],
  companyId: number
): Promise<any[]> => {
  const result: any[] = [];
  for (const item of items) {
    // Combo: snapshot dos integrantes com valores cadastrados no combo
    if ((item as any).type === "combo" && item.productId) {
      const product = await Product.findOne({
        where: { id: item.productId, companyId },
        attributes: ["id", "name", "value", "grupo", "isCombo"],
        include: [
          {
            model: ProductComboItem,
            as: "comboItems",
            include: [
              {
                model: Product,
                as: "product",
                attributes: ["id", "name", "idUniplus"],
              },
              {
                association: "variationOption",
                attributes: ["id", "label", "value", "idUniplus"],
              },
            ],
          },
        ],
      });

      if (!product || !(product as any).isCombo) {
        result.push({
          ...item,
          type: "combo",
          productName: item.productName || "Combo (produto não encontrado)",
          productValue: 0,
          comboItems: [],
        });
        continue;
      }

      const rawItems = ((product as any).comboItems || [])
        .slice()
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      const comboItemsSnapshot = rawItems.map((ci: any) => {
        const baseName = ci.product?.name || `Produto #${ci.productId}`;
        const optLabel = ci.variationOption?.label;
        const productName = optLabel ? `${baseName} - ${optLabel}` : baseName;
        const idUniplus =
          ci.variationOption?.idUniplus || ci.product?.idUniplus || null;
        return {
          productId: ci.productId,
          variationOptionId: ci.variationOptionId || null,
          productName,
          value: Math.round((Number(ci.value) || 0) * 100) / 100,
          quantity: Math.max(1, Number(ci.quantity) || 1),
          idUniplus,
        };
      });

      const productValue =
        Math.round(
          comboItemsSnapshot.reduce(
            (sum: number, ci: any) => sum + ci.value * ci.quantity,
            0
          ) * 100
        ) / 100;

      const comboObservation = sanitizeObservation(item.observation);
      result.push({
        type: "combo",
        productId: item.productId,
        quantity: item.quantity,
        productName: item.productName || (product as any).name,
        productValue,
        grupo: item.grupo || (product as any).grupo || "Outros",
        comboItems: comboItemsSnapshot,
        ...(comboObservation && { observation: comboObservation }),
      });
      continue;
    }

    if ((item as any).type === "halfAndHalf" && item.productId && item.half1ProductId && item.half2ProductId) {
      const [base, half1, half2] = await Promise.all([
        Product.findOne({ 
          where: { id: item.productId, companyId }, 
          attributes: ["id", "name", "value", "halfAndHalfPriceRule"],
          include: [{
            model: ProductVariation,
            as: "variations",
            include: [{
              model: ProductVariationOption,
              as: "options"
            }]
          }]
        }),
        Product.findOne({ 
          where: { id: item.half1ProductId, companyId }, 
          attributes: ["id", "name", "value"],
          include: [{
            model: ProductVariation,
            as: "variations",
            include: [{
              model: ProductVariationOption,
              as: "options"
            }]
          }]
        }),
        Product.findOne({ 
          where: { id: item.half2ProductId, companyId }, 
          attributes: ["id", "name", "value"],
          include: [{
            model: ProductVariation,
            as: "variations",
            include: [{
              model: ProductVariationOption,
              as: "options"
            }]
          }]
        }),
      ]);
      if (!base || !half1 || !half2) {
        result.push({ ...item, productName: item.productName || "Meio a meio (produto não encontrado)", productValue: 0 });
        continue;
      }
      
      // Obter valores das variações se disponíveis
      let v1 = Number((half1 as any).value) || 0;
      let v2 = Number((half2 as any).value) || 0;
      
      if ((item as any).half1OptionId && (half1 as any).variations && (half1 as any).variations.length > 0) {
        const firstVariation = (half1 as any).variations[0];
        const option = firstVariation?.options?.find((o: any) => o.id === (item as any).half1OptionId);
        if (option) v1 = Number(option.value) || 0;
      }
      
      if ((item as any).half2OptionId && (half2 as any).variations && (half2 as any).variations.length > 0) {
        const firstVariation = (half2 as any).variations[0];
        const option = firstVariation?.options?.find((o: any) => o.id === (item as any).half2OptionId);
        if (option) v2 = Number(option.value) || 0;
      }
      
      const rule = (base as any).halfAndHalfPriceRule || "max";
      let productValue = 0;
      if (rule === "max") productValue = Math.max(v1, v2);
      else if (rule === "fixed") {
        // Para fixed, usar a variação selecionada do produto base se disponível
        const baseOptionId = (item as any).baseOptionId;
        if (baseOptionId && (base as any).variations && (base as any).variations.length > 0) {
          const firstVariation = (base as any).variations[0];
          const option = firstVariation?.options?.find((o: any) => o.id === baseOptionId);
          if (option) {
            productValue = Number(option.value) || 0;
          } else {
            productValue = Number((base as any).value) || 0;
          }
        } else {
          productValue = Number((base as any).value) || 0;
        }
      }
      else if (rule === "average") productValue = (v1 + v2) / 2;
      else productValue = Math.max(v1, v2);
      const half1Name = String((half1 as any).name || "").trim() || "Sabor 1";
      const half2Name = String((half2 as any).name || "").trim() || "Sabor 2";
      const productName =
        item.productName || `Meio a meio: ${half1Name} / ${half2Name}`;
      const halfObservation = sanitizeObservation(item.observation);
      result.push({
        type: "halfAndHalf",
        productId: item.productId,
        quantity: item.quantity,
        half1ProductId: item.half1ProductId,
        half2ProductId: item.half2ProductId,
        half1OptionId: (item as any).half1OptionId || null,
        half2OptionId: (item as any).half2OptionId || null,
        baseOptionId: (item as any).baseOptionId || null,
        half1Name,
        half2Name,
        productName,
        productValue: Math.round(productValue * 100) / 100,
        grupo: item.grupo || (base as any).grupo,
        ...(halfObservation && { observation: halfObservation }),
      });

      // Adicionais do meio a meio (grupo do produto base / categoria)
      const halfResult = result[result.length - 1];
      const halfAddOnGroupId = await resolveAddOnGroupIdForProduct(item.productId, companyId);
      if (halfAddOnGroupId) {
        const itemAddons = Array.isArray((item as any).addons) ? (item as any).addons : [];
        await validateAddonRules(halfAddOnGroupId, itemAddons, item.quantity, productName);
        if (itemAddons.length > 0) {
          const validItems = await AddOnItem.findAll({
            where: { addOnGroupId: halfAddOnGroupId },
            attributes: ["id", "label", "value"],
          });
          const validMap = new Map(validItems.map((i) => [i.id, i]));
          const validatedAddons: Array<{ addOnItemId: number; label: string; value: number }> = [];
          let addonsTotal = 0;
          for (const a of itemAddons) {
            const v = validMap.get(a.addOnItemId);
            if (v) {
              validatedAddons.push({
                addOnItemId: v.id,
                label: a.label ?? v.label,
                value: Number(a.value ?? v.value) || 0,
              });
              addonsTotal += Number(v.value) || 0;
            }
          }
          halfResult.addons = validatedAddons;
          halfResult.addonsTotal = Math.round(addonsTotal * 100) / 100;
        }
      }
    } else {
      const normalItem = { ...item } as any;
      const normalObservation = sanitizeObservation(item.observation);
      if (normalObservation) normalItem.observation = normalObservation;
      else delete normalItem.observation;
      if (item.productId) {
        const addOnGroupId = await resolveAddOnGroupIdForProduct(item.productId, companyId);
        if (addOnGroupId) {
          const itemAddons = Array.isArray((item as any).addons) ? (item as any).addons : [];
          await validateAddonRules(
            addOnGroupId,
            itemAddons,
            item.quantity,
            item.productName || "Item"
          );
          if (itemAddons.length > 0) {
            const validItems = await AddOnItem.findAll({
              where: { addOnGroupId },
              attributes: ["id", "label", "value"],
            });
            const validMap = new Map(validItems.map((i) => [i.id, i]));
            const validatedAddons: Array<{ addOnItemId: number; label: string; value: number }> = [];
            let addonsTotal = 0;
            for (const a of itemAddons) {
              const v = validMap.get(a.addOnItemId);
              if (v) {
                validatedAddons.push({
                  addOnItemId: v.id,
                  label: a.label ?? v.label,
                  value: Number(a.value ?? v.value) || 0,
                });
                addonsTotal += Number(v.value) || 0;
              }
            }
            normalItem.addons = validatedAddons;
            normalItem.addonsTotal = Math.round(addonsTotal * 100) / 100;
          }
        }
      }
      result.push(normalItem);
    }
  }
  return result;
};

const normalizeAnswerValues = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v ?? "").trim())
      .filter((v) => v !== "");
  }
  const single = String(value ?? "").trim();
  return single ? [single] : [];
};

const resolveTriggeredOrderMessages = (
  rules: OrderTriggerMessageRule[],
  answers: Answer[]
): string[] => {
  const triggered = new Set<string>();
  for (const rule of rules) {
    const expected = String(rule.optionValue || "").trim().toLowerCase();
    const message = String(rule.message || "").trim();
    if (!rule.fieldId || !expected || !message) continue;
    const answer = answers.find((a) => Number(a.fieldId) === Number(rule.fieldId));
    if (!answer) continue;
    const values = normalizeAnswerValues(answer.answer).map((v) => v.toLowerCase());
    if (values.includes(expected)) {
      triggered.add(message);
    }
  }
  return Array.from(triggered);
};

const ProcessFormResponseService = async ({
  formId,
  answers,
  quotationItems,
  menuItems,
  responderPhone,
  responderEmail,
  responderName,
  ipAddress,
  userAgent,
  metadata,
  clientOrderId,
  orderToken,
  orderHoursBypass,
}: Request): Promise<FormResponse> => {
  // Load form with fields
  const form = await Form.findByPk(formId, {
    include: [
      {
        association: "fields",
        order: [["order", "ASC"]],
      },
    ],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  // Log para debug - verificar o que foi carregado do banco
  const loadedSettings = form.settings as any;
  console.log("ProcessFormResponseService: Loaded form settings from DB:", JSON.stringify(loadedSettings, null, 2));
  console.log("ProcessFormResponseService: Loaded mesaPrintConfig from DB:", loadedSettings?.mesaPrintConfig);
  console.log("ProcessFormResponseService: Loaded deliveryPrintDeviceIds from DB:", loadedSettings?.deliveryPrintDeviceIds);

  if (!form.isActive) {
    throw new AppError("ERR_FORM_INACTIVE", 400);
  }

  const isMenuFormEarly = (form.settings as any)?.formType === "cardapio";
  const incomingClientOrderId = String(
    clientOrderId || (metadata as any)?.clientOrderId || ""
  ).trim();
  if (isMenuFormEarly && incomingClientOrderId) {
    const existingByClient = await FormResponse.findOne({
      where: Sequelize.where(
        Sequelize.literal("metadata->>'clientOrderId'"),
        incomingClientOrderId
      ),
      include: [
        {
          model: Form,
          as: "form",
          required: true,
          where: { companyId: form.companyId },
          attributes: ["id"],
        },
      ],
    });
    if (existingByClient) {
      logger.info(
        `ProcessFormResponseService: idempotente clientOrderId=${incomingClientOrderId} formResponseId=${existingByClient.id}`
      );
      return existingByClient;
    }
  }

  // Validate required fields (apenas os visíveis pela lógica condicional)
  const fields = form.fields || [];
  const answersMap = buildAnswersMap(answers);
  const requiredFields = fields.filter(
    (f) => f.isRequired && isFieldVisible(f, answersMap, fields)
  );

  for (const field of requiredFields) {
    const answer = answers.find((a) => a.fieldId === field.id);
    if (
      !answer ||
      !answer.answer ||
      (Array.isArray(answer.answer) && answer.answer.length === 0) ||
      (typeof answer.answer === "string" && answer.answer.trim() === "")
    ) {
      throw new AppError(`ERR_FIELD_REQUIRED: ${field.label}`, 400);
    }
  }

  // Extract contact info from answers
  let contactName = responderName || "";
  let contactPhone = responderPhone || "";
  let contactEmail = responderEmail || "";

  const toStr = (v: unknown): string =>
    v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);

  // Try to find name, phone, email in form fields
  for (const answer of answers) {
    const field = fields.find((f) => f.id === answer.fieldId);
    if (field) {
      const fieldMetadata = field.metadata as any;
      const val = toStr(answer.answer).trim();
      const labelLower = String(field.label || "").toLowerCase();
      if (fieldMetadata?.autoFieldType === "supplierName" || labelLower.includes("nome do fornecedor")) {
        if (val) contactName = val;
      } else if (
        fieldMetadata?.autoFieldType === "name" ||
        (labelLower.includes("nome") && !labelLower.includes("sobrenome") && !labelLower.includes("fornecedor"))
      ) {
        // Aceita autoField name em qualquer fieldType (garçom/mesas enviam pelo autoField)
        if (val) contactName = val;
      }
      if (fieldMetadata?.autoFieldType === "phone" || field.fieldType === "phone") {
        if (val) contactPhone = val;
      }
      if (field.fieldType === "email") {
        if (val) contactEmail = val;
      }
    }
  }

  // Normalizar telefone: só dígitos, garantir 55 para Brasil se tiver 10+ dígitos
  if (contactPhone) {
    contactPhone = normalizeBrazilPhoneForWhatsapp(contactPhone);
  }

  // Check if form is quotation or menu type and process items
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  const isMenuForm = formSettings?.formType === "cardapio";
  const isAgendamentoForm = formSettings?.formType === "agendamento";
  const orderTriggerMessageRules: OrderTriggerMessageRule[] = Array.isArray(formSettings?.orderTriggerMessages)
    ? formSettings.orderTriggerMessages
        .map((rule: any) => ({
          fieldId: Number(rule?.fieldId),
          optionValue: String(rule?.optionValue ?? ""),
          message: String(rule?.message ?? ""),
        }))
        .filter((rule: OrderTriggerMessageRule) => !!rule.fieldId && !!rule.optionValue.trim() && !!rule.message.trim())
    : [];
  const triggeredOrderMessages = resolveTriggeredOrderMessages(orderTriggerMessageRules, answers);

  if (
    isMenuForm &&
    menuItems &&
    menuItems.length > 0 &&
    !orderHoursBypass
  ) {
    const hoursCheck = EvaluateCardapioOrderHours(formSettings);
    if (!hoursCheck.allowed) {
      throw new AppError(hoursCheck.message, 400);
    }
  }

  // Prepare metadata with quotationItems or menuItems if applicable
  const responseMetadata: any = metadata || {};
  if (isAgendamentoForm && metadata) {
    const meta = metadata as any;
    if (meta.appointmentServiceId != null) responseMetadata.appointmentServiceId = meta.appointmentServiceId;
    if (meta.assignedUserId != null) responseMetadata.assignedUserId = meta.assignedUserId;
    if (meta.startTime != null) responseMetadata.startTime = meta.startTime;
    if (meta.endTime != null) responseMetadata.endTime = meta.endTime;
  }
  if (isQuotationForm && quotationItems && quotationItems.length > 0) {
    responseMetadata.quotationItems = quotationItems;
    console.log("ProcessFormResponseService: Saving quotationItems:", quotationItems);
  } else if (isQuotationForm) {
    console.log("ProcessFormResponseService: Form is quotation but no quotationItems received");
  }
  
  let normalizedMenuItems: any[] | null = null;
  let appliedCouponDiscount = 0;
  if (isMenuForm && menuItems && menuItems.length > 0) {
    normalizedMenuItems = await normalizeMenuItems(menuItems, form.companyId);
    responseMetadata.menuItems = normalizedMenuItems;
    let subtotal = 0;
    for (const it of normalizedMenuItems) {
      const pv = Number(it.productValue) || 0;
      const addonsTotal = Number(it.addonsTotal) || 0;
      subtotal += (pv + addonsTotal) * (it.quantity || 0);
    }
    subtotal = Math.round(subtotal * 100) / 100;

    // Recalcula orderType + taxa no servidor (não confiar só no metadata do cliente)
    const resolvedDelivery = ResolveDeliveryFee(
      { settings: formSettings, fields: (form as any).fields || [] },
      answers,
      {
        ...(metadata as any),
        ...responseMetadata,
        orderToken,
        placedByGarcom:
          (metadata as any)?.placedByGarcom || (metadata as any)?.garcomName,
      }
    );
    responseMetadata.orderType = resolvedDelivery.orderType;
    const fulfillmentMode = inferFulfillmentMode(
      resolvedDelivery.orderType,
      fields,
      answers
    );
    responseMetadata.fulfillmentMode = fulfillmentMode;
    responseMetadata.pickup = fulfillmentMode === "pickup";
    responseMetadata.retirada = fulfillmentMode === "pickup";
    const deliveryFeeResolved = resolvedDelivery.deliveryFee;

    const customerSnapshot = buildCustomerSnapshot(
      fields,
      answers,
      { ...(metadata as any), ...responseMetadata },
      contactName,
      contactPhone
    );
    responseMetadata.customerName = customerSnapshot.customerName;
    responseMetadata.customerPhone = customerSnapshot.phone;
    responseMetadata.endereco = customerSnapshot.endereco;
    responseMetadata.endereconumero = customerSnapshot.endereconumero;
    responseMetadata.enderecobairro = customerSnapshot.enderecobairro;
    responseMetadata.enderecocomplemento = customerSnapshot.enderecocomplemento;
    responseMetadata.enderecoreferencia = customerSnapshot.enderecoreferencia;
    responseMetadata.documento = customerSnapshot.documento;
    if (customerSnapshot.orderNotes) {
      responseMetadata.orderNotes = customerSnapshot.orderNotes;
    }
    if (incomingClientOrderId) {
      responseMetadata.clientOrderId = incomingClientOrderId;
    }
    responseMetadata.printStatus = "pending";
    responseMetadata.uniplusStatus = responseMetadata.uniplusStatus || "pending";

    if (
      deliveryAddressRequired(
        fields,
        resolvedDelivery.orderType,
        answers,
        fulfillmentMode
      ) &&
      !customerSnapshot.endereco
    ) {
      throw new AppError("ERR_DELIVERY_ADDRESS_REQUIRED", 400);
    }

    // Pedido mínimo (aplica-se a pedidos delivery)
    const minOrderValue = Number(formSettings?.minOrderValue) || 0;
    if (
      minOrderValue > 0 &&
      resolvedDelivery.orderType === "delivery" &&
      subtotal < minOrderValue &&
      !orderHoursBypass
    ) {
      throw new AppError(
        `Pedido mínimo de R$ ${minOrderValue.toFixed(2).replace(".", ",")} para delivery.`,
        400
      );
    }

    // Cupom de desconto: revalida no servidor e incrementa uso
    const couponCode = String((metadata as any)?.couponCode || "").trim();
    if (couponCode) {
      const couponResult = await ValidateCouponService({
        companyId: form.companyId,
        code: couponCode,
        subtotal,
      });
      if (!couponResult.valid) {
        throw new AppError(couponResult.reason || "Cupom inválido.", 400);
      }
      appliedCouponDiscount = couponResult.discount;
      responseMetadata.couponCode = couponResult.coupon!.code;
      responseMetadata.couponDiscount = appliedCouponDiscount;
      await couponResult.coupon!.increment("usageCount");
    }

    responseMetadata.subtotal = subtotal;
    responseMetadata.total = Math.round((subtotal + deliveryFeeResolved - appliedCouponDiscount) * 100) / 100;
    responseMetadata.deliveryFee = deliveryFeeResolved;
    console.log("ProcessFormResponseService: Saving menuItems:", responseMetadata.menuItems);
  } else if (isMenuForm) {
    console.log("ProcessFormResponseService: Form is menu but no menuItems received");
  }
  if (triggeredOrderMessages.length > 0) {
    responseMetadata.triggeredOrderMessages = triggeredOrderMessages;
  }

  let tableId = (metadata as any)?.tableId ?? (responseMetadata as any)?.tableId;
  if (orderToken) {
    const decoded = verifyOrderToken(orderToken);
    if (!decoded || decoded.formId !== form.id) {
      throw new AppError("ERR_MESA_LINK_INVALID", 403);
    }
    tableId = decoded.mesaId;
  }

  // QR público: quando validação por palavra-chave está ativa, não permitir pedido direto em mesa livre.
  // A mesa deve ser ocupada/confirmada antes de enviar pedidos.
  if (isMenuForm && tableId != null) {
    const mesaId = typeof tableId === "string" ? parseInt(tableId, 10) : Number(tableId);
    if (!Number.isNaN(mesaId)) {
      const mesa = await Mesa.findOne({
        where: { id: mesaId, companyId: form.companyId },
        attributes: ["id", "status"],
      });
      const requireMesaOccupation = formSettings?.requireMesaOccupation !== false;
      const mesaKeywordValidation = formSettings?.mesaOccupationKeywordValidation === true;
      const orderType = (responseMetadata.orderType ?? (metadata as any)?.orderType) as string | undefined;
      const placedByGarcom = !!(responseMetadata.garcomName ?? responseMetadata.placedByGarcom ?? (metadata as any)?.placedByGarcom);
      const isGarcomOrder = orderType === "mesa" && placedByGarcom;

      if (
        mesa &&
        !isGarcomOrder &&
        requireMesaOccupation &&
        mesaKeywordValidation &&
        mesa.status === "livre"
      ) {
        throw new AppError("Mesa requer confirmação de ocupação antes de realizar pedidos pelo QR Code.", 409);
      }
    }
  }

  // Create FormResponse (orderStatus "novo" for menu/cardapio forms)
  const createPayload: any = {
    formId: form.id,
    responderPhone: contactPhone,
    responderEmail: contactEmail,
    responderName: contactName,
    ipAddress,
    userAgent,
    metadata: responseMetadata,
  };
  if (isMenuForm) {
    // Mesa: pedido pelo garçom → confirmado; pedido direto pelo QR da mesa → novo
    const orderType = (responseMetadata.orderType ?? (metadata as any)?.orderType) as string | undefined;
    const placedByGarcom = !!(responseMetadata.garcomName ?? responseMetadata.placedByGarcom ?? (metadata as any)?.placedByGarcom);
    if (orderType === "mesa" && placedByGarcom) {
      createPayload.orderStatus = "confirmado";
    } else {
      createPayload.orderStatus = "novo";
    }
  }
  let response: FormResponse;
  if (isMenuForm) {
    response = await sequelize.transaction(async (transaction) => {
      createPayload.protocol = await generateOrderProtocol(form.companyId, transaction);
      return FormResponse.create(createPayload, { transaction });
    });
  } else {
    response = await FormResponse.create(createPayload);
  }

  // Pedido delivery: gerar token único para QR do entregador
  if (isMenuForm && responseMetadata.orderType === "delivery") {
    const scanToken = createDeliveryScanToken(form.companyId, form.id, response.id);
    const updatedMeta = { ...(response.metadata as object || {}), deliveryScanToken: scanToken };
    await response.update({ metadata: updatedMeta });
  }

  // Create ResponseAnswers (normalizar telefones para formato de disparo antes de salvar)
  const answersToCreate = answers.map((answer) => {
    let answerStr = Array.isArray(answer.answer)
      ? answer.answer.join(", ")
      : String(answer.answer);
    const field = fields.find((f) => f.id === answer.fieldId);
    const isPhoneField = field && (
      (field as any).fieldType === "phone" ||
      ((field as any).metadata as any)?.autoFieldType === "phone"
    );
    if (isPhoneField && answerStr) {
      answerStr = normalizeBrazilPhoneForWhatsapp(answerStr);
    }
    return {
      responseId: response.id,
      fieldId: answer.fieldId,
      answer: answerStr,
      answerData: answer.answerData || { value: answer.answer },
      fileUrl: answer.fileUrl,
    };
  });

  await ResponseAnswer.bulkCreate(answersToCreate);

  let contact = null;
  let ticket = null;

  // Reutilizar contact/ticket da mesa quando pedido é para mesa já ocupada (ex.: Garçom adiciona pedido)
  if (isMenuForm && tableId != null) {
    const mesaIdNum = typeof tableId === "string" ? parseInt(tableId, 10) : Number(tableId);
    if (!Number.isNaN(mesaIdNum)) {
      const mesa = await Mesa.findOne({
        where: { id: mesaIdNum, companyId: form.companyId },
      });
      if (mesa && mesa.status === "ocupada" && mesa.contactId) {
        contact = await Contact.findOne({
          where: { id: mesa.contactId, companyId: form.companyId },
        });
        if (contact) {
          ticket = mesa.ticketId
            ? await Ticket.findOne({ where: { id: mesa.ticketId, companyId: form.companyId } })
            : null;
          const updatePayload: { contactId: number; ticketId?: number | null; mesaSessionId?: string } = {
            contactId: contact.id,
            ticketId: ticket?.id ?? null,
          };
          if (mesa.sessionId) updatePayload.mesaSessionId = mesa.sessionId;
          await response.update(updatePayload);
        }
      }
    }
  }

  // Create/Update Contact if configured
  if (form.createContact && contactPhone && !contact) {
    try {
      contact = await CreateOrUpdateContactService({
        name: contactName || "Sem nome",
        number: contactPhone,
        email: contactEmail,
        isGroup: false,
        companyId: form.companyId,
      });
      
      await response.update({ contactId: contact.id });
    } catch (err) {
      console.error("Error creating contact from form:", err);
    }
  }

  // "Peça de novo" / Auto-preenchimento: persistir respostas no contato (ContactCustomFields)
  // Guardamos por label (name = field.label) e deduplicamos removendo os registros anteriores do mesmo name.
  // Apenas quando habilitado em settings.enablePieceAgain e para formType=cardapio.
  const enablePieceAgain = formSettings?.enablePieceAgain === true;
  if (enablePieceAgain && isMenuForm && contact) {
    try {
      const storedFieldIds = resolvePieceAgainStoredFieldIds(formSettings, fields);
      const entries = buildPieceAgainEntriesFromAnswers(answers, fields, storedFieldIds);

      if (entries.length > 0) {
        const names = Array.from(new Set(entries.map((e) => e.name)));
        await ContactCustomField.destroy({
          where: {
            contactId: contact.id,
            name: { [Op.in]: names } as any,
          },
        });
        await ContactCustomField.bulkCreate(
          entries.map((e) => ({
            contactId: contact!.id,
            name: e.name,
            value: e.value,
          }))
        );
      }
    } catch (err: any) {
      console.warn("ProcessFormResponseService - Falha ao salvar ContactCustomFields:", err?.message || err);
    }
  }

  // Create Ticket if configured
  if (form.createTicket && contact && !ticket) {
    try {
      // Use form creator as userId, or 0 if not set (ticket will be unassigned)
      const userId = form.createdBy || 0;
      ticket = await CreateTicketService({
        contactId: contact.id,
        status: "pending",
        userId,
        companyId: form.companyId,
      });
      
      await response.update({ ticketId: ticket.id });
    } catch (err) {
      console.error("Error creating ticket from form:", err);
    }
  }

  // Agendamento: criar Appointment e validar slot
  if (isAgendamentoForm) {
    const meta = (response.metadata || responseMetadata) as any;
    const appointmentServiceId = meta?.appointmentServiceId != null ? Number(meta.appointmentServiceId) : null;
    const assignedUserId = meta?.assignedUserId != null ? Number(meta.assignedUserId) : null;
    const startTime = meta?.startTime ? new Date(meta.startTime) : null;
    const endTime = meta?.endTime ? new Date(meta.endTime) : null;

    if (!appointmentServiceId || !assignedUserId || !startTime || !endTime) {
      throw new AppError("ERR_AGENDAMENTO_METADATA_REQUIRED", 400);
    }

    const overlapping = await Appointment.count({
      where: {
        companyId: form.companyId,
        assignedUserId,
        status: { [Op.in]: ["pending", "confirmed"] },
        startTime: { [Op.lt]: endTime },
        endTime: { [Op.gt]: startTime },
      },
    });
    if (overlapping > 0) {
      throw new AppError("ERR_AGENDAMENTO_SLOT_CONFLICT", 409);
    }

    const service = await AppointmentService.findOne({
      where: { id: appointmentServiceId, companyId: form.companyId },
      include: [{ association: "user", attributes: ["id", "name"] }],
    });
    if (!service) {
      throw new AppError("ERR_APPOINTMENT_SERVICE_NOT_FOUND", 404);
    }

    await Appointment.create({
      companyId: form.companyId,
      formId: form.id,
      formResponseId: response.id,
      contactId: contact?.id ?? null,
      appointmentServiceId,
      assignedUserId,
      startTime,
      endTime,
      status: "pending",
      responderName: contactName || null,
      responderPhone: contactPhone || null,
      metadata: responseMetadata,
    });
  }

  // Para cardápio com mesa: garantir contact antes do auto-ocupar (mesmo se createContact estiver desligado)
  if (isMenuForm && tableId != null && !contact && contactPhone) {
    try {
      contact = await CreateOrUpdateContactService({
        name: contactName || "Sem nome",
        number: contactPhone,
        email: contactEmail,
        isGroup: false,
        companyId: form.companyId,
      });
      await response.update({ contactId: contact.id });
      if (form.createTicket) {
        const userId = form.createdBy || 0;
        ticket = await CreateTicketService({
          contactId: contact.id,
          status: "pending",
          userId,
          companyId: form.companyId,
        });
        await response.update({ ticketId: ticket.id });
      }
    } catch (err) {
      console.error("Error ensuring contact for mesa auto-occupy:", err);
    }
  }

  // Auto-ocupação de mesa: quando cliente pede via cardápio com mesa livre (?mesa=X)
  // Verificar se requireMesaOccupation está habilitado (padrão: true para compatibilidade)
  const requireMesaOccupationRaw = formSettings?.requireMesaOccupation;
  const requireMesaOccupation = requireMesaOccupationRaw !== false; // Default true
  console.log("ProcessFormResponseService: requireMesaOccupation check:", {
    raw: requireMesaOccupationRaw,
    final: requireMesaOccupation,
    formSettingsKeys: Object.keys(formSettings || {}),
  });
  
  if (tableId != null && contact) {
    try {
      const mesaId = typeof tableId === "string" ? parseInt(tableId, 10) : Number(tableId);
      if (!Number.isNaN(mesaId)) {
        const mesa = await Mesa.findOne({
          where: { id: mesaId, companyId: form.companyId },
        });
        if (mesa) {
          console.log("ProcessFormResponseService: Mesa found for order:", {
            mesaId: mesa.id,
            mesaStatus: mesa.status,
            requireMesaOccupation,
            willOccupy: requireMesaOccupation && mesa.status === "livre",
          });
          
          if (requireMesaOccupation && mesa.status === "livre") {
            // Modo tradicional: ocupar mesa automaticamente
            console.log("ProcessFormResponseService: Ocupando mesa automaticamente");
            const mesaOcupada = await OcuparMesaService({
              mesaId: mesa.id,
              companyId: form.companyId,
              contactId: contact.id,
              ticketId: ticket?.id,
            });
            const updatedMeta = { ...(response.metadata as object || {}), tableNumber: mesa.name || mesa.number };
            await response.update({
              metadata: updatedMeta,
              ...(mesaOcupada.sessionId && { mesaSessionId: mesaOcupada.sessionId }),
            });
          } else if (!requireMesaOccupation) {
            // Modo sem controle: apenas associar mesa ao pedido sem ocupar
            console.log("ProcessFormResponseService: Modo sem ocupação - apenas associando mesa ao pedido");
            const updatedMeta = { ...(response.metadata as object || {}), tableNumber: mesa.name || mesa.number };
            const updatePayload: any = { metadata: updatedMeta };
            
            // Se mesa já estiver ocupada, usar sessionId existente
            if (mesa.status === "ocupada" && mesa.sessionId) {
              updatePayload.mesaSessionId = mesa.sessionId;
            }
            
            await response.update(updatePayload);
          } else if (mesa.status === "ocupada" && mesa.sessionId) {
            // Mesa já ocupada: associar pedido à sessão existente
            const updatedMeta = { ...(response.metadata as object || {}), tableNumber: mesa.name || mesa.number };
            await response.update({
              metadata: updatedMeta,
              mesaSessionId: mesa.sessionId,
            });
          }
        }
      }
    } catch (err: any) {
      // Não quebrar o fluxo se mesa já ocupada ou outro erro
      console.warn("ProcessFormResponseService - Auto-ocupar mesa:", err?.message || err);
    }
  }

  // Create print job(s) for menu form according to mesaPrintConfig / deliveryPrintDeviceIds
  if (isMenuForm && menuItems && menuItems.length > 0) {
    try {
      const formSettings = form.settings as any;
      console.log("ProcessFormResponseService: formSettings at print job creation:", JSON.stringify(formSettings, null, 2));
      
      const printDeviceId = formSettings?.printDeviceId as number | undefined;
      const mesaPrintConfig = formSettings?.mesaPrintConfig as Array<{ printDeviceId: number; groupNames: string[] }> | undefined;
      const deliveryPrintDeviceIds = formSettings?.deliveryPrintDeviceIds as number[] | undefined;
      
      console.log("ProcessFormResponseService: Extracted values - printDeviceId:", printDeviceId, "mesaPrintConfig:", mesaPrintConfig, "deliveryPrintDeviceIds:", deliveryPrintDeviceIds);

      let meta = {
        ...((metadata || {}) as Record<string, unknown>),
        ...((response.metadata || {}) as Record<string, unknown>),
      } as Record<string, unknown>;
      if (meta?.orderType === "delivery") {
        const fresh = await FormResponse.findByPk(response.id, { attributes: ["metadata"] });
        if (fresh?.metadata) {
          meta = { ...meta, ...(fresh.metadata as Record<string, unknown>) };
        }
        let scanToken = meta?.deliveryScanToken as string | undefined;
        if (!scanToken) {
          scanToken = createDeliveryScanToken(form.companyId, form.id, response.id);
          await response.update({
            metadata: { ...meta, deliveryScanToken: scanToken },
          });
          meta = { ...meta, deliveryScanToken: scanToken };
        }
      }

      const tableNumber = (meta?.tableNumber as string) || "";
      const garcomName = (meta?.garcomName as string) || "";
      const allMenuItems = normalizedMenuItems && normalizedMenuItems.length > 0 ? normalizedMenuItems : menuItems;
      const orderType = meta?.orderType === "delivery" ? "delivery" : "mesa";
      const fulfillmentMode =
        (meta?.fulfillmentMode as string) ||
        inferFulfillmentMode(orderType, fields, answers);
      const printStoredFieldIds = resolvePrintStoredFieldIds(formSettings, fields);
      const printQrModuleSize = resolvePrintQrModuleSize(formSettings);
      const printFontScale = resolvePrintFontScale(formSettings);

      // Payload de impressão: menuItems com addons e addonsTotal explícitos para o agente de impressão
      const buildConteudo = (menuItemsForJob: typeof allMenuItems): Record<string, unknown> => {
        const mappedAnswers = answers
          .map((answer) => {
            const field = fields.find((f) => f.id === answer.fieldId);
            return {
              fieldId: answer.fieldId,
              label: field?.label || "",
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
        const menuItemsForPayload = (menuItemsForJob || []).map((it: any) => ({
          ...it,
          quantity: it.quantity ?? 1,
          productName: it.productName ?? it.name,
          productValue: it.productValue ?? 0,
          grupo: it.grupo ?? "Outros",
          addons: Array.isArray(it.addons) ? it.addons : [],
          addonsTotal: typeof it.addonsTotal === "number" ? it.addonsTotal : 0,
        }));
        // Taxa de entrega: usar meta (ou response.metadata) para garantir que vai no payload de impressão
        const deliveryFeeRaw =
          orderType === "delivery"
            ? Number(meta?.deliveryFee ?? (response.metadata as any)?.deliveryFee ?? 0)
            : 0;
        const deliveryFee = Math.round((Number.isFinite(deliveryFeeRaw) ? deliveryFeeRaw : 0) * 100) / 100;
        const conteudo: Record<string, unknown> = {
          event: "form.submitted",
          formId: form.id,
          formName: form.name,
          responseId: response.id,
          protocol: response.protocol,
          submittedAt: response.submittedAt,
          tableNumber,
          garcomName,
          deliveryFee,
          responder: {
            name: contactName,
            phone: contactPhone,
            email: contactEmail,
          },
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
          meta?.deliveryScanToken
        ) {
          const token = meta.deliveryScanToken as string;
          conteudo.deliveryScanToken = token;
          const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "";
          if (baseUrl) {
            conteudo.deliveryScanUrl = `${baseUrl.replace(/\/$/, "")}/entregador?t=${encodeURIComponent(token)}`;
          }
        }
        return conteudo;
      };

      if (orderType === "delivery") {
        // Configuração de impressão para pedidos de delivery
        const deviceIds: number[] = deliveryPrintDeviceIds?.length
          ? deliveryPrintDeviceIds
          : printDeviceId
            ? [printDeviceId]
            : [];
        
        console.log(`ProcessFormResponseService: Delivery order - printing to ${deviceIds.length} device(s): ${deviceIds.join(", ")}`);
        
        for (const id of deviceIds) {
          if (!id || id <= 0) {
            console.warn(`ProcessFormResponseService: Invalid device ID for delivery: ${id}`);
            continue;
          }
          
          const printDevice = await PrintDevice.findOne({
            where: { id, companyId: form.companyId },
          });
          if (printDevice) {
            console.log(`ProcessFormResponseService: Creating delivery print job for device ${printDevice.deviceId} (deviceId: ${printDevice.deviceId})`);
            await CreateAndDispatchPrintJobService({
              companyId: form.companyId,
              deviceId: printDevice.deviceId,
              formId: form.id,
              formResponseId: response.id,
              conteudo: buildConteudo(allMenuItems),
            });
          } else {
            console.warn(`ProcessFormResponseService: PrintDevice not found for delivery: id=${id}, companyId=${form.companyId}`);
          }
        }
      } else {
        // Configuração de impressão para pedidos de mesa/garçom
        console.log(`ProcessFormResponseService: Raw mesaPrintConfig:`, JSON.stringify(mesaPrintConfig, null, 2));
        
        const config: Array<{ printDeviceId: number; groupNames: string[] }> =
          mesaPrintConfig?.length
            ? mesaPrintConfig
            : printDeviceId
              ? [{ printDeviceId, groupNames: ["*"] }]
              : [];
        
        console.log(`ProcessFormResponseService: Parsed config has ${config.length} row(s):`, config);
        
        // Agrupar grupos por dispositivo (evita duplicação se mesma impressora tem múltiplas linhas)
        const byDevice = new Map<number, Set<string>>();
        for (const row of config) {
          // Validar que printDeviceId existe e é válido
          if (!row.printDeviceId || row.printDeviceId <= 0) {
            console.warn(`ProcessFormResponseService: Invalid printDeviceId in config: ${row.printDeviceId}`);
            continue;
          }
          if (!byDevice.has(row.printDeviceId)) {
            byDevice.set(row.printDeviceId, new Set());
          }
          // Garantir que groupNames é um array
          const groupNamesArray = Array.isArray(row.groupNames) ? row.groupNames : [];
          groupNamesArray.forEach((g) => {
            if (g && g.trim()) {
              byDevice.get(row.printDeviceId)!.add(g.trim());
            }
          });
          console.log(`ProcessFormResponseService: Device ${row.printDeviceId} configured with groups: ${groupNamesArray.join(", ")}`);
        }
        
        // Log dos grupos de cada item do menu para debug
        console.log(`ProcessFormResponseService: Menu items and their groups:`, 
          allMenuItems.map((item: any) => ({
            name: item.productName || item.name,
            grupo: (item.grupo || "Outros").trim() || "Outros"
          }))
        );

        // Processar cada dispositivo configurado
        console.log(`ProcessFormResponseService: Processing mesa order with ${allMenuItems.length} total items`);
        console.log(`ProcessFormResponseService: Config has ${byDevice.size} device(s) configured`);
        
        for (const [devId, groupNames] of byDevice.entries()) {
          const printDevice = await PrintDevice.findOne({
            where: { id: devId, companyId: form.companyId },
          });
          if (!printDevice) {
            console.warn(`ProcessFormResponseService: PrintDevice not found: id=${devId}, companyId=${form.companyId}`);
            continue;
          }
          
          const names = Array.from(groupNames);
          const allGroups = names.includes("*");
          
          console.log(`ProcessFormResponseService: Processing device ${printDevice.deviceId} (id=${devId}) with groups: ${names.join(", ")} (allGroups=${allGroups})`);
          
          // Filtrar itens do menu que pertencem aos grupos configurados para esta impressora
          const filtered = allMenuItems.filter((item: any) => {
            const itemGrupo = (item.grupo || "Outros").trim() || "Outros";
            const matches = allGroups || names.some(g => g.trim().toLowerCase() === itemGrupo.toLowerCase());
            
            if (matches) {
              console.log(`ProcessFormResponseService: Item "${item.productName || item.name}" (grupo="${itemGrupo}") matches device ${printDevice.deviceId}`);
            }
            
            return matches;
          });
          
          if (filtered.length === 0) {
            console.log(`ProcessFormResponseService: No items to print for device ${printDevice.deviceId} (groups: ${names.join(", ")})`);
            continue;
          }
          
          console.log(`ProcessFormResponseService: Creating print job for device ${printDevice.deviceId} (deviceId: ${printDevice.deviceId}) with ${filtered.length} items out of ${allMenuItems.length} total (groups: ${names.join(", ")})`);
          console.log(`ProcessFormResponseService: Filtered items: ${filtered.map((item: any) => `${item.productName || item.name} (${(item.grupo || "Outros").trim()})`).join(", ")}`);
          
          await CreateAndDispatchPrintJobService({
            companyId: form.companyId,
            deviceId: printDevice.deviceId,
            formId: form.id,
            formResponseId: response.id,
            conteudo: buildConteudo(filtered),
          });
        }
      }
    } catch (err) {
      console.error("Error creating print job:", err);
    }
  }

  // UniPlus: despacha job direto (sem preflight) — best-effort, nunca bloqueia o pedido.
  // Delivery e mesa (garçom / QR / tela Mesas) usam o mesmo fluxo CONTAMESA.
  const orderTypeForUniplus = String(
    ((response.metadata || metadata || {}) as any)?.orderType || ""
  );
  if (
    isMenuForm &&
    menuItems &&
    menuItems.length > 0 &&
    (orderTypeForUniplus === "delivery" || orderTypeForUniplus === "mesa")
  ) {
    try {
      const allMenuItems =
        normalizedMenuItems && normalizedMenuItems.length > 0
          ? normalizedMenuItems
          : menuItems;
      const metaNow = (response.metadata || {}) as Record<string, unknown>;
      if (!metaNow.uniplusContaId) {
        const deviceId = await resolveUniplusDeviceId(form.companyId, form);
        if (!deviceId) {
          logger.warn(
            `Uniplus: sem PrintDevice para despacho formResponseId=${response.id} companyId=${form.companyId}`
          );
          await patchFormResponseUniplusMetadata(response.id, {
            uniplusStatus: "error",
            uniplusLastError: "Sem PrintDevice UniPlus/delivery configurado",
            uniplusLastErrorAt: new Date().toISOString(),
          });
        } else {
          const payload = await BuildUniplusDeliveryPayloadService({
            companyId: form.companyId,
            form,
            response,
            menuItems: allMenuItems,
            contactName,
            contactPhone,
            fields,
            answers,
          });
          await CreateOrReuseUniplusJobService({
            companyId: form.companyId,
            deviceId,
            formId: form.id,
            formResponseId: response.id,
            conteudo: payload,
            externalRef: payload.protocol,
          });
          logger.info(
            `Uniplus job despachado formResponseId=${response.id} deviceId=${deviceId} protocol=${payload.protocol} orderType=${payload.orderType} tipopedido=${payload.tipopedido} numeromesa=${payload.numeromesa ?? "-"}`
          );
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Error creating UniPlus job:", msg);
      await patchFormResponseUniplusMetadata(response.id, {
        uniplusStatus: "error",
        uniplusLastError: msg,
        uniplusLastErrorAt: new Date().toISOString(),
      });
    }
  }

  // Process menu form: send WhatsApp message to customer em segundo plano (não bloqueia a resposta)
  const disableWhatsAppMessages = formSettings?.disableWhatsAppMessages === true;
  console.log("ProcessFormResponseService - Checking menu form:", {
    isMenuForm,
    menuItemsCount: menuItems?.length || 0,
    contactPhone: contactPhone ? "present" : "missing",
    disableWhatsAppMessages,
  });

  if (isMenuForm && menuItems && menuItems.length > 0 && contactPhone && !disableWhatsAppMessages) {
    (async () => {
      try {
        console.log("ProcessFormResponseService (background) - Starting WhatsApp send");
        const formSettings = form.settings as any;
        const selectedWhatsappId = formSettings?.whatsappId;
        let whatsappToUse;
        if (selectedWhatsappId) {
          const Whatsapp = (await import("../../models/Whatsapp")).default;
          whatsappToUse = await Whatsapp.findOne({
            where: { id: selectedWhatsappId, companyId: form.companyId, status: "CONNECTED" },
          });
          if (!whatsappToUse) whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        } else {
          whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        }
        if (!whatsappToUse) {
          console.warn("ProcessFormResponseService (background) - Nenhuma conexão WhatsApp disponível");
          return;
        }
        let contactForSend = contact;
        if (!contactForSend && contactPhone) {
          contactForSend = await CreateOrUpdateContactService({
            name: contactName || "Sem nome",
            number: contactPhone,
            email: contactEmail,
            isGroup: false,
            companyId: form.companyId,
          });
        }
        if (!contactForSend) return;
        // Garantir número normalizado (12 dígitos) no contato antes do envio: contato de mesa pode ter 13 dígitos
        if (contactPhone && contactForSend.number !== contactPhone) {
          await contactForSend.update({ number: contactPhone });
        }
        const ticket = await FindOrCreateTicketService(
          contactForSend,
          whatsappToUse.id,
          0,
          form.companyId
        );
        const customFields = answers
          .map((answer) => {
            const field = fields.find((f) => f.id === answer.fieldId);
            if (field) {
              const fieldMetadata = field.metadata as any;
              if (
                fieldMetadata?.autoFieldType === "name" ||
                fieldMetadata?.autoFieldType === "phone" ||
                field.fieldType === "phone"
              ) return null;
              return {
                label: field.label,
                answer: typeof answer.answer === "string" ? answer.answer : String(answer.answer),
              };
            }
            return null;
          })
          .filter((f): f is { label: string; answer: string } => f !== null);
        if (triggeredOrderMessages.length > 0) {
          customFields.push(
            ...triggeredOrderMessages.map((message) => ({
              label: "Mensagem automática",
              answer: message,
            }))
          );
        }
        const meta = (response.metadata || metadata || {}) as Record<string, unknown>;
        const tableNumberMsg = (meta?.tableNumber as string) || undefined;
        const garcomNameMsg = (meta?.garcomName as string) || undefined;
        const deliveryFee = meta?.deliveryFee != null ? Number(meta.deliveryFee) : undefined;
        const total = meta?.total != null ? Number(meta.total) : undefined;
        const couponCodeMsg = (meta?.couponCode as string) || undefined;
        const couponDiscountMsg = meta?.couponDiscount != null ? Number(meta.couponDiscount) : undefined;
        const orderMessage = await FormatMenuOrderMessage({
          menuItems: normalizedMenuItems && normalizedMenuItems.length > 0 ? normalizedMenuItems : menuItems,
          customerName: contactName || "Cliente",
          customerPhone: contactPhone,
          customFields,
          protocol: response.protocol || undefined,
          tableNumber: tableNumberMsg,
          garcomName: garcomNameMsg,
          deliveryFee: deliveryFee,
          total: total,
          couponCode: couponCodeMsg,
          couponDiscount: couponDiscountMsg,
        });
        const sentMessage = await SendWhatsAppMessage({ body: orderMessage, ticket });
        if (sentMessage) {
          console.log("ProcessFormResponseService (background) - WhatsApp message sent", { messageId: sentMessage?.key?.id });
        }
      } catch (err: any) {
        console.error("ProcessFormResponseService (background) - Error sending WhatsApp:", err?.message);
      }
    })();
  }

  if (isAgendamentoForm && contactPhone) {
    (async () => {
      try {
        const { getIO } = await import("../../libs/socket");
        const appointment = await Appointment.findOne({
          where: { formResponseId: response.id, companyId: form.companyId },
          include: [
            { association: "appointmentService", attributes: ["id", "name"] },
            { association: "assignedUser", attributes: ["id", "name"] },
          ],
        });
        if (!appointment) return;
        const formSettings = form.settings as any;
        const selectedWhatsappId = formSettings?.whatsappId;
        let whatsappToUse;
        if (selectedWhatsappId) {
          const Whatsapp = (await import("../../models/Whatsapp")).default;
          whatsappToUse = await Whatsapp.findOne({
            where: { id: selectedWhatsappId, companyId: form.companyId, status: "CONNECTED" },
          });
          if (!whatsappToUse) whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        } else {
          whatsappToUse = await GetDefaultWhatsApp(form.companyId);
        }
        if (!whatsappToUse) return;
        let contactForSend = contact;
        if (!contactForSend && contactPhone) {
          contactForSend = await CreateOrUpdateContactService({
            name: contactName || "Sem nome",
            number: contactPhone,
            email: contactEmail,
            isGroup: false,
            companyId: form.companyId,
          });
        }
        if (!contactForSend) return;
        const ticket = await FindOrCreateTicketService(
          contactForSend,
          whatsappToUse.id,
          0,
          form.companyId
        );
        const serviceName = (appointment as any).appointmentService?.name || "Serviço";
        const professionalName = (appointment as any).assignedUser?.name || "Profissional";
        const baseUrl = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "";
        const token = createAppointmentToken(appointment.id);
        const cancelUrl = baseUrl ? `${baseUrl}/f/${form.slug}/cancelar?token=${token}` : undefined;
        const rescheduleUrl = baseUrl ? `${baseUrl}/f/${form.slug}/reagendar?token=${token}` : undefined;
        const msg = FormatAppointmentConfirmationMessage({
          serviceName,
          professionalName,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          customerName: contactName || "Cliente",
          cancelUrl,
          rescheduleUrl,
        });
        await SendWhatsAppMessage({ body: msg, ticket });
        getIO().to(`company-${form.companyId}-mainchannel`).emit(`company-${form.companyId}-appointment`, { action: "create" });
      } catch (err: any) {
        console.error("ProcessFormResponseService (background) - Agendamento WhatsApp:", err?.message);
      }
    })();
  }

  await response.reload({
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "ticket" },
    ],
  });

  // Envio WhatsApp é em segundo plano; frontend não deve bloquear (ou desabilitado por configuração)
  if (isMenuForm) {
    (response as any).whatsappSent = disableWhatsAppMessages ? false : "pending";
    // Token para página pública de acompanhamento do pedido (/pedido/:token)
    (response as any).trackingToken = createOrderTrackingToken(
      form.companyId,
      form.id,
      response.id
    );
  }

  // For agendamento form, attach token so frontend can show success page links (reagendar, ical)
  if (isAgendamentoForm) {
    const apt = await Appointment.findOne({
      where: { formResponseId: response.id, companyId: form.companyId },
    });
    if (apt) {
      (response as any).appointmentToken = createAppointmentToken(apt.id);
      (response as any).appointmentId = apt.id;
    }
  }

  return response;
};

export default ProcessFormResponseService;
