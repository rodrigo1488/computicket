import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import AppError from "../../errors/AppError";
import SendOrderStatusNotificationService from "./SendOrderStatusNotificationService";
import RegisterGourmetVendaService from "../GourmetFinanceiroServices/RegisterGourmetVendaService";
import {
  buildMeiosPagamentoForValor,
  extractPaymentMethodFromResponse,
} from "../../helpers/paymentMethodUtils";

const calcTotalFromMenuItems = (metadata: any): number => {
  const items = metadata?.menuItems || [];
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum: number, item: any) => {
    const qty = Number(item.quantity) || 0;
    const val = Number(item.productValue) ?? 0;
    return sum + qty * val;
  }, 0);
};

const DEFAULT_ORDER_STATUSES = [
  "novo",
  "confirmado",
  "em_preparo",
  "pronto",
  "saiu_entrega",
  "entregue",
  "cancelado",
  "faturado",
];

const isValidStatus = (s: string): boolean => {
  if (!s || typeof s !== "string") return false;
  const normalized = s.toLowerCase().trim();
  if (DEFAULT_ORDER_STATUSES.includes(normalized)) return true;
  // Permite estágios customizados: apenas letras, números e underscore
  return /^[a-z0-9_]+$/.test(normalized);
};

interface Request {
  formId: number;
  responseId: number;
  orderStatus: string;
  companyId: number;
}

const UpdateOrderStatusService = async ({
  formId,
  responseId,
  orderStatus,
  companyId,
}: Request): Promise<FormResponse> => {
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formSettings = form.settings as any;
  if (formSettings?.formType !== "cardapio") {
    throw new AppError("ERR_FORM_NOT_MENU", 400);
  }

  const normalizedStatus = orderStatus?.toLowerCase()?.trim();
  if (!isValidStatus(normalizedStatus)) {
    throw new AppError("ERR_INVALID_ORDER_STATUS", 400);
  }

  const response = await FormResponse.findOne({
    where: { id: responseId, formId },
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "form" },
    ],
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.update({ orderStatus: normalizedStatus });

  if (normalizedStatus === "entregue") {
    const meta = (response.metadata || {}) as Record<string, unknown>;
    if (meta?.orderType === "delivery") {
      const valor = calcTotalFromMenuItems(response.metadata);
      if (valor > 0 && (form as any).companyId) {
        try {
          const paymentMethod = extractPaymentMethodFromResponse(response);
          await RegisterGourmetVendaService({
            companyId: (form as any).companyId,
            tipo: "delivery",
            valor,
            formResponseId: response.id,
            protocol: (response as any).protocol ?? null,
            entregadorUserId: meta.entregadorUserId as number | undefined,
            entregadorNome: (meta.entregadorName as string) ?? null,
            meiosPagamento: buildMeiosPagamentoForValor(paymentMethod, valor),
          });
        } catch (err) {
          console.error("RegisterGourmetVendaService (delivery):", err);
        }
      }
    }
  }

  // Enviar notificação WhatsApp para status pronto, saiu_entrega, entregue
  try {
    await SendOrderStatusNotificationService({
      form,
      response,
      newStatus: normalizedStatus,
    });
  } catch (err) {
    console.error("UpdateOrderStatus: notification error", err);
  }

  await response.reload({
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact" },
      { association: "form" },
    ],
  });

  return response;
};

export default UpdateOrderStatusService;
