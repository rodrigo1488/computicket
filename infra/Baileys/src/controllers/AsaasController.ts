import { Request, Response } from "express";
import * as Yup from "yup";
import moment from "moment";
import { hash } from "bcryptjs";
import { Op } from "sequelize";

import AppError from "../errors/AppError";
import Company from "../models/Company";
import Plan from "../models/Plan";
import User from "../models/User";
import Invoices from "../models/Invoices";
import { logger } from "../utils/logger";
import {
  validateCompanyForAsaasCustomer,
  sanitizeMobilePhoneForAsaas,
} from "../services/PaymentService/asaasCompanyDataValidation";
import UpdateCompanyService from "../services/CompanyService/UpdateCompanyService";
import {
  createCustomer,
  createPixPayment,
  createCardPayment,
  createSubscription,
  createSubscriptionWithCreditCard,
  getSubscriptionFirstPayment,
  getPaymentPixQrCode,
  getPaymentStatus,
  mapRecurrenceToCycle,
  AsaasRecurrence,
} from "../services/PaymentService/AsaasService";
import CreateCompanyService from "../services/CompanyService/CreateCompanyService";
import Setting from "../models/Setting";
import ApplyCompanyModulesBySlugsService from "../services/CompanyModuleServices/ApplyCompanyModulesBySlugsService";
import SumModulesPriceBySlugsService from "../services/CompanyModuleServices/SumModulesPriceBySlugsService";
import { getIO } from "../libs/socket";

const SIGNUP_MODULES_PENDING_KEY = "signupModulesPending";

// ── Helpers ───────────────────────────────────────────────────────────────────

const recurrenceToDays = (recurrence: string): number => {
  const map: Record<string, number> = {
    MENSAL: 30,
    TRIMESTRAL: 90,
    SEMESTRAL: 180,
    ANUAL: 365,
  };
  return map[recurrence] ?? 30;
};

/** Ativa empresa e grava invoice (mesma lógica do webhook) */
async function activateCompanyAfterPayment(
  companyId: number,
  paymentValue?: number
): Promise<void> {
  const company = await Company.findByPk(companyId, {
    include: [{ model: Plan }],
  });
  if (!company) return;

  const recurrence = company.recurrence || "MENSAL";
  const daysToAdd = recurrenceToDays(recurrence);
  const currentDue = company.dueDate ? moment(company.dueDate) : moment();
  const newDueDate = currentDue.add(daysToAdd, "days").format();

  await company.update({
    status: true,
    dueDate: newDueDate,
    lastRenewalAttempt: new Date(),
    renewalAttempts: 0,
  });

  const detail = `Assinatura ${recurrence} - ${company.plan?.name ?? "Plano"} (Asaas)`;
  await Invoices.create({
    detail,
    status: "paid",
    value: paymentValue ?? company.plan?.value ?? 0,
    dueDate: newDueDate,
    companyId: company.id,
  });

  logger.info(
    `[Asaas] Empresa ${companyId} ativada após pagamento. dueDate: ${newDueDate}`
  );

  // Aplicar módulos escolhidos na assinatura (gravados antes do pagamento)
  const pending = await Setting.findOne({
    where: { companyId, key: SIGNUP_MODULES_PENDING_KEY },
  });
  if (pending?.value) {
    try {
      const slugs = JSON.parse(pending.value);
      if (Array.isArray(slugs) && slugs.length > 0) {
        await ApplyCompanyModulesBySlugsService(companyId, slugs);
        logger.info(`[Asaas] Módulos aplicados à empresa ${companyId}:`, slugs);
      }
    } catch (e) {
      logger.warn("[Asaas] Falha ao aplicar módulos pendentes:", e);
    }
    await pending.destroy();
  }
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }
  return req.socket.remoteAddress?.replace(/^::ffff:/, "") || "127.0.0.1";
}

// ── Controller: criar assinatura Asaas + empresa inativa ─────────────────────

export const createAsaasSubscriptionController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  logger.info("=== createAsaasSubscriptionController chamado ===");

  const creditCardSchema = Yup.object().shape({
    holderName: Yup.string().required("Nome no cartão é obrigatório"),
    number: Yup.string()
      .required("Número do cartão é obrigatório")
      .test("len", "Número do cartão inválido", (v) => {
        const d = (v ?? "").replace(/\D/g, "");
        return d.length >= 13 && d.length <= 19;
      }),
    expiryMonth: Yup.string().required("Mês de validade é obrigatório"),
    expiryYear: Yup.string().required("Ano de validade é obrigatório"),
    ccv: Yup.string()
      .required("CVV é obrigatório")
      .min(3, "CVV inválido")
      .max(4, "CVV inválido"),
  });

  const schema = Yup.object().shape({
    name: Yup.string()
      .min(2, "Nome deve ter no mínimo 2 caracteres")
      .required("Nome é obrigatório"),
    email: Yup.string().email("Email inválido").required("Email é obrigatório"),
    phone: Yup.string().required("Telefone é obrigatório"),
    password: Yup.string()
      .min(5, "Senha deve ter no mínimo 5 caracteres")
      .required("Senha é obrigatória"),
    cpfCnpj: Yup.string()
      .required("CPF/CNPJ é obrigatório")
      .test("cpfcnpj-len", "CPF/CNPJ inválido", (v) => {
        const digits = (v ?? "").replace(/\D/g, "");
        return digits.length === 11 || digits.length === 14;
      }),
    planId: Yup.number()
      .required("Plano é obrigatório")
      .integer()
      .positive(),
    recurrence: Yup.string()
      .optional()
      .oneOf(["MENSAL", "ANUAL", "TRIMESTRAL", "SEMESTRAL"]),
    billingType: Yup.string()
      .optional()
      .oneOf(["PIX", "CREDIT_CARD"]),
    // Dados do titular do cartão (endereço exigido pelo Asaas)
    postalCode: Yup.string().when("billingType", {
      is: "CREDIT_CARD",
      then: (s) => s.required("CEP é obrigatório para cartão"),
      otherwise: (s) => s.optional(),
    }),
    addressNumber: Yup.string().when("billingType", {
      is: "CREDIT_CARD",
      then: (s) => s.required("Número do endereço é obrigatório"),
      otherwise: (s) => s.optional(),
    }),
    addressComplement: Yup.string().optional(),
    creditCard: Yup.object().when("billingType", {
      is: "CREDIT_CARD",
      then: () => creditCardSchema.required(),
      otherwise: (s) => s.optional(),
    }),
    modules: Yup.array().of(Yup.string()).optional(),
  });

  try {
    await schema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    const msgs = err.inner?.length
      ? err.inner.map((e: any) => e.message).join(", ")
      : err.message;
    throw new AppError(msgs, 400);
  }

  const {
    name,
    email,
    phone,
    password,
    cpfCnpj,
    planId,
    recurrence = "MENSAL",
    billingType = "PIX",
    postalCode,
    addressNumber,
    addressComplement,
    creditCard,
    modules: moduleSlugsRaw,
  } = req.body;

  const moduleSlugs = Array.isArray(moduleSlugsRaw)
    ? moduleSlugsRaw.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  // Verificar duplicata
  const existing = await Company.findOne({
    where: { [Op.or]: [{ email }, { name }] },
  });
  if (existing) {
    throw new AppError(
      "Já existe uma empresa com este email ou nome.",
      400
    );
  }

  const plan = await Plan.findByPk(planId);
  if (!plan) throw new AppError("Plano não encontrado.", 404);
  if (!plan.value || plan.value <= 0) {
    throw new AppError(
      "Para planos gratuitos, use o endpoint de criação gratuita.",
      400
    );
  }

  // Criar empresa inativa (aguardando pagamento)
  const passwordHash = await hash(password, 8);
  const company = await CreateCompanyService({
    name,
    email,
    phone,
    password,
    planId,
    recurrence,
    status: false,
    dueDate: undefined,
    campaignsEnabled: true,
  });

  // Módulos adquiridos com a assinatura: persistir até confirmação do pagamento
  if (moduleSlugs.length > 0) {
    await Setting.create({
      companyId: company.id,
      key: SIGNUP_MODULES_PENDING_KEY,
      value: JSON.stringify(moduleSlugs),
    });
  }

  const modulesExtra = await SumModulesPriceBySlugsService(moduleSlugs);
  const subscriptionTotal = Number(plan.value) + modulesExtra;
  const subscriptionDescription =
    modulesExtra > 0
      ? `Assinatura ${recurrence} - ${plan.name} + módulos`
      : `Assinatura ${recurrence} - ${plan.name}`;

  try {
    const customer = await createCustomer({
      name,
      cpfCnpj,
      email,
      mobilePhone: phone,
      externalReference: `company_${company.id}`,
    });

    const cycle = mapRecurrenceToCycle(recurrence as AsaasRecurrence);
    const nextDueDate = moment().format("YYYY-MM-DD");

    // ── Cartão: assinatura + 1ª cobrança no Asaas (POST /v3/subscriptions/) ──
    if (billingType === "CREDIT_CARD" && creditCard) {
      const remoteIp = clientIp(req);
      const subscription = await createSubscriptionWithCreditCard({
        customerId: customer.id,
        value: subscriptionTotal,
        nextDueDate,
        cycle,
        description: subscriptionDescription,
        externalReference: `company_${company.id}`,
        creditCard: {
          holderName: creditCard.holderName,
          number: creditCard.number,
          expiryMonth: String(creditCard.expiryMonth),
          expiryYear: String(creditCard.expiryYear),
          ccv: String(creditCard.ccv),
        },
        creditCardHolderInfo: {
          name,
          email,
          cpfCnpj,
          postalCode: postalCode || "00000000",
          addressNumber: addressNumber || "S/N",
          addressComplement,
          phone,
          mobilePhone: phone,
        },
        remoteIp,
      });

      await company.update({
        asaasSubscriptionId: subscription.id,
        asaasCustomerId: customer.id,
      });

      const firstPayment = await getSubscriptionFirstPayment(subscription.id);
      let paymentConfirmed = false;
      if (firstPayment?.id) {
        try {
          const st = await getPaymentStatus(firstPayment.id);
          const status = (st.status || "").toUpperCase();
          if (
            status === "RECEIVED" ||
            status === "CONFIRMED" ||
            status === "RECEIVED_IN_CASH"
          ) {
            paymentConfirmed = true;
          }
        } catch {
          // Se status não disponível, webhook ativa depois
        }
      }

      if (paymentConfirmed) {
        await activateCompanyAfterPayment(company.id, subscriptionTotal);
        return res.status(200).json({
          companyId: company.id,
          subscriptionId: subscription.id,
          billingType: "CREDIT_CARD",
          paymentConfirmed: true,
          value: subscriptionTotal,
          planName: plan.name,
        });
      }

      return res.status(200).json({
        companyId: company.id,
        subscriptionId: subscription.id,
        billingType: "CREDIT_CARD",
        paymentConfirmed: false,
        paymentId: firstPayment?.id,
        value: subscriptionTotal,
        planName: plan.name,
      });
    }

    // ── PIX: assinatura + QR Code ──
    const subscription = await createSubscription({
      customerId: customer.id,
      value: subscriptionTotal,
      nextDueDate,
      cycle,
      description: subscriptionDescription,
      externalReference: `company_${company.id}`,
      billingType: "PIX",
    });

    await company.update({
      asaasSubscriptionId: subscription.id,
      asaasCustomerId: customer.id,
    });

    const firstPayment = await getSubscriptionFirstPayment(subscription.id);
    if (!firstPayment) {
      throw new AppError(
        "Assinatura criada, mas a primeira cobrança ainda não está disponível. Tente novamente em instantes.",
        503
      );
    }

    let pixQrCode;
    try {
      pixQrCode = await getPaymentPixQrCode(firstPayment.id);
    } catch (pixErr: any) {
      // Sem chave PIX no Asaas: devolve só pending para polling/webhook
      logger.warn(
        "[Asaas] PIX QR indisponível; empresa aguarda webhook ou configure chave PIX.",
        pixErr?.message
      );
      return res.status(200).json({
        companyId: company.id,
        subscriptionId: subscription.id,
        paymentId: firstPayment.id,
        billingType: "PIX",
        pixUnavailable: true,
        value: subscriptionTotal,
        planName: plan.name,
      });
    }

    logger.info(`[Asaas] Assinatura PIX criada para empresa ${company.id}`, {
      subscriptionId: subscription.id,
      paymentId: firstPayment.id,
    });

    return res.status(200).json({
      companyId: company.id,
      subscriptionId: subscription.id,
      paymentId: firstPayment.id,
      billingType: "PIX",
      pixQrCode: `data:image/png;base64,${pixQrCode.encodedImage}`,
      pixPayload: pixQrCode.payload,
      expirationDate: pixQrCode.expirationDate,
      value: subscriptionTotal,
      planName: plan.name,
    });
  } catch (error: any) {
    // Rollback: remover empresa e setting de módulos pendentes
    try {
      await Setting.destroy({
        where: { companyId: company.id, key: SIGNUP_MODULES_PENDING_KEY },
      });
    } catch {}
    try {
      await company.destroy();
    } catch (destroyErr) {
      logger.error("[Asaas] Erro ao remover empresa após falha:", destroyErr);
    }
    logger.error("[Asaas] Erro ao criar assinatura:", error.message);
    if (error instanceof AppError) throw error;
    throw new AppError(
      error.message || "Erro ao criar assinatura. Tente novamente.",
      500
    );
  }
};

// ── Controller: pagamento de fatura (Financeiro) — usuário autenticado ─────────

/**
 * POST /asaas/invoice-payment
 * Cria cobrança PIX no Asaas para a fatura informada e retorna QR Code.
 * Requer empresa com asaasCustomerId ou cpfCnpj no body para criar cliente.
 */
export const createAsaasInvoicePaymentController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    throw new AppError("Não autorizado", 401);
  }

  const schema = Yup.object().shape({
    invoiceId: Yup.number().required().integer().positive(),
    cpfCnpj: Yup.string().optional(),
  });
  try {
    await schema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    const msgs = err.inner?.length
      ? err.inner.map((e: any) => e.message).join(", ")
      : err.message;
    throw new AppError(msgs, 400);
  }

  const { invoiceId, cpfCnpj } = req.body;
  const invoice = await Invoices.findByPk(invoiceId);
  if (!invoice || invoice.companyId !== companyId) {
    throw new AppError("Fatura não encontrada", 404);
  }
  if (invoice.status === "paid") {
    throw new AppError("Esta fatura já está paga", 400);
  }

  const value = Number(invoice.value);
  if (!value || value <= 0) {
    throw new AppError("Valor da fatura inválido", 400);
  }

  const company = await Company.findByPk(companyId);
  if (!company) throw new AppError("Empresa não encontrada", 404);

  let customerId = company.asaasCustomerId;
  if (!customerId) {
    const cpf = (cpfCnpj || "").replace(/\D/g, "");
    // Clientes anteriores ao Asaas não têm asaasCustomerId — exige CPF/CNPJ no body
    if (cpf.length !== 11 && cpf.length !== 14) {
      logger.info(
        `[Asaas] Fatura ${invoiceId}: empresa ${companyId} precisa de CPF/CNPJ para cadastro Asaas`
      );
      return res.status(200).json({
        requiresCpfCnpj: true,
        message:
          "Informe CPF ou CNPJ para cadastrar o cliente no Asaas e gerar o PIX.",
      });
    }

    const dataCheck = validateCompanyForAsaasCustomer(company);
    if (!dataCheck.valid) {
      logger.info(
        `[Asaas] Fatura ${invoiceId}: empresa ${companyId} com dados incompletos`,
        dataCheck.issues
      );
      return res.status(200).json({
        requiresCompanyData: true,
        issues: dataCheck.issues,
        company: dataCheck.company,
        message:
          "Corrija os dados da empresa antes de gerar o PIX. Campos obrigatórios: nome, e-mail e celular (DDD + número, 10 ou 11 dígitos).",
      });
    }

    try {
      const customer = await createCustomer({
        name: dataCheck.company.name,
        cpfCnpj: cpf,
        email: dataCheck.company.email,
        mobilePhone:
          sanitizeMobilePhoneForAsaas(dataCheck.company.phone) ||
          dataCheck.company.phone,
        externalReference: `company_${companyId}`,
      });
      customerId = customer.id;
      await company.update({ asaasCustomerId: customerId });
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/celular|inv[aá]lido|phone|mobile/i.test(msg)) {
        logger.warn("[Asaas] createCustomer rejeitado — pedir correção:", msg);
        return res.status(200).json({
          requiresCompanyData: true,
          issues: [
            {
              field: "phone" as const,
              message:
                "Asaas recusou o celular informado. Use DDD + número com 11 dígitos (celular).",
            },
          ],
          company: dataCheck.company,
          message: msg,
        });
      }
      throw e;
    }
  }

  const dueDate = moment().format("YYYY-MM-DD");
  let payment;
  try {
    payment = await createPixPayment({
      customerId,
      value,
      dueDate,
      description: invoice.detail || `Fatura #${invoiceId}`,
      externalReference: `invoice_${invoiceId}`,
    });
  } catch (e: any) {
    logger.error("[Asaas] createPixPayment falhou:", e?.message);
    throw new AppError(
      e?.message ||
        "Não foi possível criar cobrança no Asaas. Verifique a configuração.",
      502
    );
  }

  let pixQrCode;
  try {
    pixQrCode = await getPaymentPixQrCode(payment.id);
  } catch (e: any) {
    logger.error("[Asaas] PIX QR fatura:", e?.message);
    throw new AppError(
      "Não foi possível gerar QR Code PIX. Configure a chave PIX na conta Asaas.",
      503
    );
  }

  return res.status(200).json({
    asaas: true,
    paymentId: payment.id,
    pixQrCode: `data:image/png;base64,${pixQrCode.encodedImage}`,
    pixPayload: pixQrCode.payload,
    expirationDate: pixQrCode.expirationDate,
    value,
    invoiceId,
    // compat CheckoutSuccess que espera valor.original
    valor: { original: value },
  });
};

/**
 * POST /asaas/invoice-payment-card
 * Cria cobrança no cartão no Asaas para a fatura informada.
 */
export const createAsaasInvoiceCardPaymentController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = req.user?.companyId;
  if (!companyId) throw new AppError("Não autorizado", 401);

  const cardSchema = Yup.object().shape({
    holderName: Yup.string().required("Nome no cartão é obrigatório"),
    number: Yup.string().required("Número do cartão é obrigatório"),
    expiryMonth: Yup.string().required("Mês é obrigatório"),
    expiryYear: Yup.string().required("Ano é obrigatório"),
    ccv: Yup.string().required("CVV é obrigatório"),
  });

  const schema = Yup.object().shape({
    invoiceId: Yup.number().required().integer().positive(),
    cpfCnpj: Yup.string().required("CPF/CNPJ do titular é obrigatório"),
    card: cardSchema.required(),
    billingPostalCode: Yup.string().required("CEP é obrigatório"),
    billingAddressNumber: Yup.string().required("Número é obrigatório"),
    billingAddressComplement: Yup.string().optional(),
    billingName: Yup.string().required("Nome do pagador é obrigatório"),
    billingEmail: Yup.string().required("E-mail do pagador é obrigatório"),
    billingPhone: Yup.string().required("Celular do pagador é obrigatório"),
  });

  try {
    await schema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    const msgs = err.inner?.length
      ? err.inner.map((e: any) => e.message).join(", ")
      : err.message;
    throw new AppError(msgs, 400);
  }

  const {
    invoiceId,
    cpfCnpj,
    card,
    billingPostalCode,
    billingAddressNumber,
    billingAddressComplement,
    billingName,
    billingEmail,
    billingPhone,
  } = req.body;

  const invoice = await Invoices.findByPk(invoiceId);
  if (!invoice || invoice.companyId !== companyId) {
    throw new AppError("Fatura não encontrada", 404);
  }
  if (invoice.status === "paid") {
    throw new AppError("Esta fatura já está paga", 400);
  }

  let value = Number(invoice.value);
  if (!value || value <= 0) {
    const company = await Company.findByPk(companyId, { include: [{ model: Plan }] });
    if (company?.plan?.value) {
      value = Number(company.plan.value);
      await invoice.update({ value }).catch(() => {});
    } else {
      throw new AppError("Valor da fatura inválido", 400);
    }
  }

  const company = await Company.findByPk(companyId);
  if (!company) throw new AppError("Empresa não encontrada", 404);

  let customerId = company.asaasCustomerId;
  if (!customerId) {
    const cpfDigits = String(cpfCnpj || "").replace(/\D/g, "");
    if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      return res.status(200).json({
        requiresCpfCnpj: true,
        message:
          "Informe CPF ou CNPJ para cadastrar o cliente no Asaas e processar o cartão.",
      });
    }

    const dataCheck = validateCompanyForAsaasCustomer(company);
    if (!dataCheck.valid) {
      return res.status(200).json({
        requiresCompanyData: true,
        issues: dataCheck.issues,
        company: dataCheck.company,
        message:
          "Corrija os dados da empresa antes de processar o cartão. Campos obrigatórios: nome, e-mail e celular (DDD + número, 10 ou 11 dígitos).",
      });
    }

    const customer = await createCustomer({
      name: dataCheck.company.name,
      cpfCnpj: cpfDigits,
      email: dataCheck.company.email,
      mobilePhone:
        sanitizeMobilePhoneForAsaas(dataCheck.company.phone) ||
        dataCheck.company.phone,
      externalReference: `company_${companyId}`,
    });
    customerId = customer.id;
    await company.update({ asaasCustomerId: customerId });
  }

  const payment = await createCardPayment({
    customerId,
    value,
    dueDate: moment().format("YYYY-MM-DD"),
    description: invoice.detail || `Fatura #${invoiceId}`,
    externalReference: `invoice_${invoiceId}`,
    creditCard: {
      holderName: String(card.holderName || ""),
      number: String(card.number || ""),
      expiryMonth: String(card.expiryMonth || ""),
      expiryYear: String(card.expiryYear || ""),
      ccv: String(card.ccv || ""),
    },
    creditCardHolderInfo: {
      name: String(billingName || ""),
      email: String(billingEmail || ""),
      cpfCnpj: String(cpfCnpj || "").replace(/\D/g, ""),
      postalCode: String(billingPostalCode || "").replace(/\D/g, ""),
      addressNumber: String(billingAddressNumber || "S/N"),
      addressComplement: billingAddressComplement,
      phone: String(billingPhone || "").replace(/\D/g, ""),
      mobilePhone: String(billingPhone || "").replace(/\D/g, ""),
    },
    remoteIp: clientIp(req),
  });

  const status = String(payment?.status || "").toUpperCase();
  if (
    status === "RECEIVED" ||
    status === "CONFIRMED" ||
    status === "RECEIVED_IN_CASH"
  ) {
    const currentDue = company.dueDate ? moment(company.dueDate) : moment();
    const newDueDate = currentDue.add(30, "days").format();
    await company.update({ dueDate: newDueDate, status: true });
    await invoice.update({ status: "paid" });
    await company.reload();
    await invoice.reload();
    try {
      const io = getIO();
      io.to(`company-${companyId}-mainchannel`).emit(
        `company-${companyId}-payment`,
        { action: "CONCLUIDA", company, invoice }
      );
    } catch (e) {
      logger.warn("[Asaas] Socket emit após cartão aprovado falhou:", e);
    }
    logger.info(
      `[Asaas] Fatura ${invoiceId} paga (cartão aprovado). Company ${companyId} dueDate ${newDueDate}`
    );
  }

  return res.status(200).json({
    asaas: true,
    paymentId: payment.id,
    status: payment.status,
    billingType: "CREDIT_CARD",
    value,
    invoiceId,
  });
};

/**
 * PUT /asaas/company-profile
 * Atualiza nome, e-mail e telefone da própria empresa (para cadastro Asaas / PIX).
 */
export const updateCompanyProfileForPaymentController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    throw new AppError("Não autorizado", 401);
  }

  const schema = Yup.object().shape({
    name: Yup.string().required().min(2, "Nome muito curto"),
    email: Yup.string().required().email("E-mail inválido"),
    phone: Yup.string().required(),
  });
  try {
    await schema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    const msgs = err.inner?.length
      ? err.inner.map((e: any) => e.message).join(", ")
      : err.message;
    throw new AppError(msgs, 400);
  }

  const { name, email, phone } = req.body;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 11) {
    throw new AppError(
      "Celular inválido. Informe DDD + número (10 ou 11 dígitos).",
      400
    );
  }

  await UpdateCompanyService({
    id: companyId,
    name: String(name).trim(),
    email: String(email).trim(),
    phone: digits,
  });

  const company = await Company.findByPk(companyId);
  return res.status(200).json({
    success: true,
    company: {
      name: company?.name,
      email: company?.email,
      phone: company?.phone,
    },
  });
};

// ── Controller: webhook Asaas ─────────────────────────────────────────────────

export const asaasWebhookController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    logger.info("[Asaas Webhook] Recebido:", {
      event: req.body.event,
      paymentId: req.body.payment?.id,
    });

    const { event, payment } = req.body;

    // Processar apenas pagamentos confirmados/recebidos
    if (event !== "PAYMENT_CONFIRMED" && event !== "PAYMENT_RECEIVED") {
      return res.status(200).json({ received: true });
    }

    if (!payment || !payment.externalReference) {
      logger.warn("[Asaas Webhook] Pagamento sem externalReference, ignorando");
      return res.status(200).json({ received: true });
    }

    const ref = String(payment.externalReference);

    // Pagamento de fatura (Financeiro) — externalReference = "invoice_123"
    const invoiceMatch = ref.match(/^invoice_(\d+)$/);
    if (invoiceMatch) {
      const invoiceId = parseInt(invoiceMatch[1], 10);
      const invoice = await Invoices.findByPk(invoiceId);
      if (!invoice || invoice.status === "paid") {
        return res.status(200).json({ received: true });
      }
      const companyId = invoice.companyId;
      const company = await Company.findByPk(companyId);
      if (!company) {
        return res.status(200).json({ received: true });
      }
      const currentDue = company.dueDate ? moment(company.dueDate) : moment();
      const newDueDate = currentDue.add(30, "days").format();
      await company.update({ dueDate: newDueDate, status: true });
      await invoice.update({ status: "paid" });
      await company.reload();
      await invoice.reload();
      try {
        const io = getIO();
        io.to(`company-${companyId}-mainchannel`).emit(
          `company-${companyId}-payment`,
          { action: "CONCLUIDA", company, invoice }
        );
      } catch (e) {
        logger.warn("[Asaas Webhook] Socket emit falhou:", e);
      }
      logger.info(
        `[Asaas Webhook] Fatura ${invoiceId} paga. Company ${companyId} dueDate ${newDueDate}`
      );
      return res.status(200).json({ received: true });
    }

    // Ativação de empresa no signup — externalReference = "company_123"
    const match = ref.match(/^company_(\d+)$/);
    if (!match) {
      logger.warn(
        "[Asaas Webhook] externalReference não reconhecido:",
        payment.externalReference
      );
      return res.status(200).json({ received: true });
    }

    const companyId = parseInt(match[1], 10);
    const company = await Company.findByPk(companyId);
    if (!company) {
      logger.error(`[Asaas Webhook] Empresa ${companyId} não encontrada`);
      return res.status(200).json({ received: true });
    }

    await activateCompanyAfterPayment(companyId, payment.value);

    return res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error("[Asaas Webhook] Erro:", error.message);
    // Retornar 200 para evitar reenvio do webhook
    return res.status(200).json({ received: false, error: error.message });
  }
};

// ── Controller: status do pagamento / empresa ─────────────────────────────────

export const getAsaasPaymentStatusController = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.params;

  try {
    const company = await Company.findByPk(Number(companyId), {
      attributes: ["id", "status", "dueDate", "name", "email"],
    });

    if (!company) {
      throw new AppError("Empresa não encontrada", 404);
    }

    return res.status(200).json({
      companyId: company.id,
      status: company.status ? "active" : "pending",
      dueDate: company.dueDate,
    });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError("Erro ao consultar status", 500);
  }
};
