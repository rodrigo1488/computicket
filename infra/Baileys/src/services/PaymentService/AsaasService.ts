import axios, { AxiosInstance } from "axios";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

// ── Tipos de entrada ──────────────────────────────────────────────────────────

export interface AsaasCustomerData {
  name: string;
  cpfCnpj: string;
  email?: string;
  mobilePhone?: string;
  externalReference?: string;
}

export interface AsaasSubscriptionData {
  customerId: string;
  value: number;
  nextDueDate: string; // YYYY-MM-DD
  cycle: AsaasSubscriptionCycle;
  description?: string;
  externalReference?: string;
  billingType?: "PIX" | "BOLETO" | "CREDIT_CARD";
}

export type AsaasSubscriptionCycle =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "BIMONTHLY"
  | "QUARTERLY"
  | "SEMIANNUALLY"
  | "YEARLY";

export type AsaasRecurrence = "MENSAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL";

// ── Tipos de resposta ─────────────────────────────────────────────────────────

export interface AsaasCustomer {
  id: string;
  name: string;
  email?: string;
  cpfCnpj: string;
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  status: string;
  cycle: string;
  value: number;
  nextDueDate: string;
}

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  billingType: string;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export interface AsaasPaymentStatus {
  id: string;
  status: string;
}

/** Corpo para POST /v3/subscriptions/ com cartão (assinatura + 1ª cobrança) */
export interface AsaasCreditCardPayload {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface AsaasCreditCardHolderPayload {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  addressComplement?: string;
  phone: string;
  mobilePhone?: string;
}

export interface AsaasSubscriptionWithCardParams {
  customerId: string;
  value: number;
  nextDueDate: string;
  cycle: AsaasSubscriptionCycle;
  description?: string;
  externalReference?: string;
  creditCard: AsaasCreditCardPayload;
  creditCardHolderInfo: AsaasCreditCardHolderPayload;
  /** IP do cliente (obrigatório Asaas — não usar IP do servidor) */
  remoteIp: string;
}

// ── Mapeamento de recorrência ─────────────────────────────────────────────────

export const mapRecurrenceToCycle = (
  recurrence: AsaasRecurrence
): AsaasSubscriptionCycle => {
  const map: Record<AsaasRecurrence, AsaasSubscriptionCycle> = {
    MENSAL: "MONTHLY",
    TRIMESTRAL: "QUARTERLY",
    SEMESTRAL: "SEMIANNUALLY",
    ANUAL: "YEARLY",
  };
  return map[recurrence] ?? "MONTHLY";
};

// ── Cliente HTTP ──────────────────────────────────────────────────────────────

/**
 * Cliente HTTP Asaas.
 *
 * Autenticação: header `access_token` com a API key completa (o $ faz parte da chave).
 * Sandbox: URL https://api-sandbox.asaas.com + chave com prefixo $aact_hmlg_...
 * Produção: URL https://api.asaas.com + chave com prefixo $aact_prod_...
 * Não misture chave de um ambiente com URL do outro — retorna 401.
 *
 * User-Agent é obrigatório para contas criadas a partir de 13/06/2024 (docs Asaas).
 */
const getAsaasClient = (): AxiosInstance => {
  const rawKey = process.env.ASAAS_API_KEY;
  if (!rawKey || !String(rawKey).trim()) {
    throw new AppError(
      "ASAAS_API_KEY não configurada. Configure a variável de ambiente.",
      500
    );
  }

  // Evita 401 por espaço/quebra de linha no final do .env
  const apiKey = String(rawKey).trim();

  const baseURL = (
    process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com"
  ).replace(/\/$/, "");

  // Aviso em log se ambiente e prefixo da chave parecem divergir (sem expor a chave)
  const isSandboxUrl = baseURL.includes("sandbox");
  const looksLikeSandboxKey = apiKey.startsWith("$aact_hmlg");
  const looksLikeProdKey = apiKey.startsWith("$aact_prod");
  if (isSandboxUrl && looksLikeProdKey) {
    logger.warn(
      "[Asaas] ASAAS_API_URL é sandbox mas a chave parece ser de produção ($aact_prod_). Use chave $aact_hmlg_ no sandbox."
    );
  }
  if (!isSandboxUrl && looksLikeSandboxKey) {
    logger.warn(
      "[Asaas] ASAAS_API_URL é produção mas a chave parece ser de sandbox ($aact_hmlg_). Use chave $aact_prod_ em produção."
    );
  }
  if (!apiKey.startsWith("$")) {
    logger.warn(
      "[Asaas] A chave Asaas normalmente começa com $. Confira se não foi cortada no .env."
    );
  }

  const userAgent =
    process.env.ASAAS_USER_AGENT?.trim() || "Compuchat-Backend/1.0";

  return axios.create({
    baseURL,
    headers: {
      access_token: apiKey,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    timeout: 15000,
  });
};

const handleAsaasError = (error: any, context: string): never => {
  if (error.response) {
    const errors: { code?: string; description?: string }[] =
      error.response.data?.errors ?? [];
    const msg =
      errors.map((e) => e.description ?? e.code).join("; ") ||
      error.response.statusText;
    logger.error(`[Asaas] Erro em ${context}: ${msg}`, {
      status: error.response.status,
      data: error.response.data,
    });
    throw new AppError(`Asaas: ${msg}`, error.response.status ?? 400);
  }
  logger.error(`[Asaas] Erro em ${context}:`, error.message);
  throw new AppError(
    `Erro ao comunicar com Asaas (${context}): ${error.message}`,
    500
  );
};

// ── Funções exportadas ────────────────────────────────────────────────────────

/**
 * Cria ou atualiza um cliente no Asaas.
 * Requer name e cpfCnpj.
 */
export const createCustomer = async (
  data: AsaasCustomerData
): Promise<AsaasCustomer> => {
  const client = getAsaasClient();
  try {
    const mobileDigits = data.mobilePhone?.replace(/\D/g, "");
    const payload: Record<string, unknown> = {
      name: data.name,
      cpfCnpj: data.cpfCnpj.replace(/\D/g, ""),
      email: data.email,
      externalReference: data.externalReference,
    };
    // Asaas rejeita celular inválido — só envia se 10 ou 11 dígitos (BR)
    if (mobileDigits && (mobileDigits.length === 10 || mobileDigits.length === 11)) {
      payload.mobilePhone = mobileDigits;
    }
    const response = await client.post<AsaasCustomer>("/v3/customers", payload);
    logger.info("[Asaas] Cliente criado:", { id: response.data.id });
    return response.data;
  } catch (error) {
    handleAsaasError(error, "createCustomer");
  }
};

/**
 * Cria uma assinatura recorrente via PIX (padrão) no Asaas.
 */
export const createSubscription = async (
  data: AsaasSubscriptionData
): Promise<AsaasSubscription> => {
  const client = getAsaasClient();
  try {
    const response = await client.post<AsaasSubscription>("/v3/subscriptions", {
      customer: data.customerId,
      billingType: data.billingType ?? "PIX",
      value: data.value,
      nextDueDate: data.nextDueDate,
      cycle: data.cycle,
      description: data.description,
      externalReference: data.externalReference,
    });
    logger.info("[Asaas] Assinatura criada:", { id: response.data.id });
    return response.data;
  } catch (error) {
    handleAsaasError(error, "createSubscription");
  }
};

/**
 * Retorna o primeiro pagamento gerado para uma assinatura.
 */
export const getSubscriptionFirstPayment = async (
  subscriptionId: string
): Promise<AsaasPayment | null> => {
  const client = getAsaasClient();
  try {
    const response = await client.get<{ data: AsaasPayment[] }>(
      `/v3/subscriptions/${subscriptionId}/payments`
    );
    const payments = response.data?.data ?? [];
    return payments[0] ?? null;
  } catch (error) {
    handleAsaasError(error, "getSubscriptionFirstPayment");
  }
};

/**
 * Cria assinatura com cobrança no cartão (primeira parcela já processada).
 * POST /v3/subscriptions/ — billingType CREDIT_CARD.
 */
export const createSubscriptionWithCreditCard = async (
  params: AsaasSubscriptionWithCardParams
): Promise<AsaasSubscription> => {
  const client = getAsaasClient();
  const body = {
    customer: params.customerId,
    billingType: "CREDIT_CARD" as const,
    value: params.value,
    nextDueDate: params.nextDueDate,
    cycle: params.cycle,
    description: params.description,
    externalReference: params.externalReference,
    creditCard: {
      holderName: params.creditCard.holderName,
      number: params.creditCard.number.replace(/\s/g, ""),
      expiryMonth: params.creditCard.expiryMonth.padStart(2, "0"),
      expiryYear: params.creditCard.expiryYear,
      ccv: params.creditCard.ccv,
    },
    creditCardHolderInfo: {
      name: params.creditCardHolderInfo.name,
      email: params.creditCardHolderInfo.email,
      cpfCnpj: params.creditCardHolderInfo.cpfCnpj.replace(/\D/g, ""),
      postalCode: params.creditCardHolderInfo.postalCode.replace(/\D/g, ""),
      addressNumber: params.creditCardHolderInfo.addressNumber,
      addressComplement: params.creditCardHolderInfo.addressComplement,
      phone: params.creditCardHolderInfo.phone.replace(/\D/g, ""),
      mobilePhone: params.creditCardHolderInfo.mobilePhone?.replace(
        /\D/g,
        ""
      ),
    },
    remoteIp: params.remoteIp,
  };
  try {
    const response = await client.post<AsaasSubscription>(
      "/v3/subscriptions/",
      body
    );
    logger.info("[Asaas] Assinatura com cartão criada:", {
      id: response.data.id,
    });
    return response.data;
  } catch (error) {
    handleAsaasError(error, "createSubscriptionWithCreditCard");
  }
};

/**
 * Cobrança avulsa PIX (ex.: pagamento de fatura no Financeiro).
 * POST /v3/payments
 */
export const createPixPayment = async (params: {
  customerId: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
}): Promise<AsaasPayment> => {
  const client = getAsaasClient();
  try {
    const response = await client.post<AsaasPayment>("/v3/payments", {
      customer: params.customerId,
      billingType: "PIX",
      value: params.value,
      dueDate: params.dueDate,
      description: params.description,
      externalReference: params.externalReference,
    });
    logger.info("[Asaas] Cobrança PIX criada:", { id: response.data.id });
    return response.data;
  } catch (error) {
    handleAsaasError(error, "createPixPayment");
  }
};

/** Parâmetros para cobrança avulsa com cartão (POST /v3/payments, billingType CREDIT_CARD) */
export interface AsaasCardPaymentParams {
  customerId: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
  creditCard: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    addressComplement?: string;
    phone: string;
    mobilePhone?: string;
  };
  remoteIp: string;
}

/**
 * Cobrança avulsa com cartão de crédito (ex.: pagamento de fatura no Financeiro).
 * POST /v3/payments com billingType CREDIT_CARD.
 */
export const createCardPayment = async (
  params: AsaasCardPaymentParams
): Promise<AsaasPayment> => {
  const client = getAsaasClient();
  const number = String(params.creditCard.number || "").replace(/\D/g, "");
  let expiryYear = String(params.creditCard.expiryYear || "").replace(/\D/g, "");
  if (expiryYear.length === 2) expiryYear = `20${expiryYear}`;
  expiryYear = expiryYear.slice(-4);
  const expiryMonth = String(params.creditCard.expiryMonth || "").replace(/\D/g, "").padStart(2, "0").slice(0, 2);
  const phone = String(params.creditCardHolderInfo.phone || params.creditCardHolderInfo.mobilePhone || "").replace(/\D/g, "");
  try {
    const response = await client.post<AsaasPayment>("/v3/payments", {
      customer: params.customerId,
      billingType: "CREDIT_CARD",
      value: params.value,
      dueDate: params.dueDate,
      description: params.description,
      externalReference: params.externalReference,
      creditCard: {
        holderName: params.creditCard.holderName,
        number,
        expiryMonth: expiryMonth || "01",
        expiryYear: expiryYear || "2030",
        ccv: String(params.creditCard.ccv || "").replace(/\D/g, ""),
      },
      creditCardHolderInfo: {
        name: params.creditCardHolderInfo.name,
        email: params.creditCardHolderInfo.email,
        cpfCnpj: String(params.creditCardHolderInfo.cpfCnpj || "").replace(/\D/g, ""),
        postalCode: String(params.creditCardHolderInfo.postalCode || "").replace(/\D/g, ""),
        addressNumber: params.creditCardHolderInfo.addressNumber || "S/N",
        addressComplement: params.creditCardHolderInfo.addressComplement,
        phone,
        mobilePhone: phone,
      },
      remoteIp: params.remoteIp,
    });
    logger.info("[Asaas] Cobrança cartão criada:", { id: response.data.id, status: response.data.status });
    return response.data;
  } catch (error) {
    handleAsaasError(error, "createCardPayment");
  }
};

/**
 * Retorna o QR Code PIX de um pagamento.
 */
export const getPaymentPixQrCode = async (
  paymentId: string
): Promise<AsaasPixQrCode> => {
  const client = getAsaasClient();
  try {
    const response = await client.get<AsaasPixQrCode>(
      `/v3/payments/${paymentId}/pixQrCode`
    );
    return response.data;
  } catch (error) {
    handleAsaasError(error, "getPaymentPixQrCode");
  }
};

/**
 * Retorna o status atual de um pagamento.
 */
export const getPaymentStatus = async (
  paymentId: string
): Promise<AsaasPaymentStatus> => {
  const client = getAsaasClient();
  try {
    const response = await client.get<AsaasPaymentStatus>(
      `/v3/payments/${paymentId}/status`
    );
    return response.data;
  } catch (error) {
    handleAsaasError(error, "getPaymentStatus");
  }
};
