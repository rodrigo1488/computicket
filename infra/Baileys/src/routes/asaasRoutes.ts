import express from "express";
import isAuth from "../middleware/isAuth";
import * as AsaasController from "../controllers/AsaasController";

const asaasRoutes = express.Router();

// Webhook do Asaas (público — sem autenticação, validado pelo event payload)
asaasRoutes.post("/asaas/webhook", AsaasController.asaasWebhookController);

// Criar empresa + assinatura Asaas via landing page (público)
asaasRoutes.post(
  "/companies/create-asaas-subscription",
  AsaasController.createAsaasSubscriptionController
);

// Consulta de status do pagamento/empresa para polling do frontend (público)
asaasRoutes.get(
  "/companies/asaas-payment-status/:companyId",
  AsaasController.getAsaasPaymentStatusController
);

// Pagamento de fatura via PIX Asaas (Financeiro — autenticado)
asaasRoutes.post(
  "/asaas/invoice-payment",
  isAuth,
  AsaasController.createAsaasInvoicePaymentController
);

// Pagamento de fatura via cartão Asaas (Financeiro — autenticado)
asaasRoutes.post(
  "/asaas/invoice-payment-card",
  isAuth,
  AsaasController.createAsaasInvoiceCardPaymentController
);

// Atualizar dados da empresa para cadastro Asaas (nome, e-mail, celular)
asaasRoutes.put(
  "/asaas/company-profile",
  isAuth,
  AsaasController.updateCompanyProfileForPaymentController
);

export default asaasRoutes;
