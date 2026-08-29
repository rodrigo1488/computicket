import { Request, Response } from "express";
import express from "express";
import * as Yup from "yup";
import Gerencianet from "gn-api-sdk-typescript";
import AppError from "../errors/AppError";

import getGerencianetConfig from "../config/Gn";
import Company from "../models/Company";
import Invoices from "../models/Invoices";
import { getIO } from "../libs/socket";
import {logger} from "../utils/logger";
import moment from "moment";

const app = express();


export const index = async (req: Request, res: Response): Promise<Response> => {
  try {
    const options = getGerencianetConfig();
    const gerencianet = Gerencianet(options);
    return res.json(gerencianet.getSubscriptions());
  } catch (error: any) {
    logger.error("Erro ao obter configuração do Gerencianet:", error.message);
    throw new AppError("Configuração do Gerencianet não encontrada. Entre em contato com o suporte.", 500);
  }
};

export const createSubscription = async (
  req: Request,
  res: Response
  ): Promise<Response> => {
    // Obter e validar configuração do Gerencianet
    let options;
    try {
      options = getGerencianetConfig();
    } catch (error: any) {
      logger.error("Erro ao obter configuração do Gerencianet:", error.message);
      throw new AppError(
        `Configuração do Gerencianet incompleta: ${error.message}. Entre em contato com o suporte.`,
        500
      );
    }

    const gerencianet = Gerencianet(options);
    const { companyId } = req.user;

  const schema = Yup.object().shape({
    price: Yup.string().required(),
    users: Yup.string().required(),
    connections: Yup.string().required()
  });

  if (!(await schema.isValid(req.body))) {
    throw new AppError("Validation fails 1", 400);
  }

  const {
    firstName,
    price,
    users,
    connections,
    address2,
    city,
    state,
    zipcode,
    country,
    plan,
    invoiceId
  } = req.body;

  const body = {
    calendario: {
      expiracao: 3600
    },
    valor: {
      original: price.toLocaleString("pt-br", { minimumFractionDigits: 2 }).replace(",", ".")
    },
    chave: process.env.GERENCIANET_PIX_KEY,
    solicitacaoPagador: `#Fatura:${invoiceId}`
  };

  try {
    const pix = await gerencianet.pixCreateImmediateCharge(null, body);

    const qrcode = await gerencianet.pixGenerateQRCode({
      id: pix.loc.id
    });

    let bodyWebhook = {
      webhookUrl: `${process.env.BACKEND_URL}/subscription/webhook?ignorar=`
    };

    const params = {
      chave: pix.chave
    };

    await gerencianet.pixConfigWebhook(params, bodyWebhook);

    return res.json({
      ...pix,
      qrcode,

    });
  } catch (error) {
    logger.error(error);
    throw new AppError("Validation fails 2", 400);
  }
};

export const  createWebhook = async (
  req: Request,
  res: Response
): Promise<Response> => {

  const schema = Yup.object().shape({
    chave: Yup.string().required(),
    url: Yup.string().required()
  });

  if (!(await schema.isValid(req.body))) {
    throw new AppError("Validation fails 3", 400);
  }

  const { chave, url } = req.body;

  const body = {
    webhookUrl: url
  };

  const params = {
    chave
  };

  try {
    const options = getGerencianetConfig();
    const gerencianet = Gerencianet(options);
    const create = await gerencianet.pixConfigWebhook(params, body);
    return res.json(create);
  } catch (error: any) {
    logger.error("Erro ao configurar webhook:", error.message);
    throw new AppError(
      `Erro ao configurar webhook: ${error.message}`,
      500
    );
  }
};

export const webhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    logger.info("=== Webhook PIX recebido ===");
    logger.info("Body recebido:", JSON.stringify(req.body, null, 2));

    const { evento } = req.body;

    if (evento === "teste_webhook") {
      logger.info("Webhook de teste recebido");
      return res.json({ ok: true });
    }

    if (!req.body.pix || !Array.isArray(req.body.pix) || req.body.pix.length === 0) {
      logger.warn("Webhook recebido sem array de PIX válido");
      return res.json({ ok: true, message: "Nenhum PIX para processar" });
    }

    // Obter configuração do Gerencianet
    let options;
    try {
      options = getGerencianetConfig();
    } catch (error: any) {
      logger.error("Erro ao obter configuração do Gerencianet no webhook:", error.message);
      // Retornar 200 para evitar reenvio do webhook mesmo com erro de configuração
      return res.status(200).json({ 
        ok: false, 
        error: `Configuração do Gerencianet incompleta: ${error.message}` 
      });
    }

    const gerencianet = Gerencianet(options);
    const processedPix = [];

    for (const pix of req.body.pix) {
      try {
        if (!pix.txid) {
          logger.warn("PIX sem txid, ignorando:", pix);
          continue;
        }

        logger.info(`Processando PIX com txid: ${pix.txid}`);

        const detalhe = await gerencianet.pixDetailCharge({
          txid: pix.txid
        });

        logger.info(`Status do PIX ${pix.txid}: ${detalhe.status}`);

        if (detalhe.status === "CONCLUIDA") {
          const { solicitacaoPagador } = detalhe;

          if (!solicitacaoPagador || !solicitacaoPagador.includes("#Fatura:")) {
            logger.error(`PIX ${pix.txid} sem solicitacaoPagador válido:`, solicitacaoPagador);
            continue;
          }

          const invoiceID = solicitacaoPagador.replace("#Fatura:", "").trim();

          if (!invoiceID || isNaN(Number(invoiceID))) {
            logger.error(`Invoice ID inválido extraído de solicitacaoPagador: ${invoiceID}`);
            continue;
          }

          logger.info(`Buscando invoice ID: ${invoiceID}`);

          const invoice = await Invoices.findByPk(invoiceID);

          if (!invoice) {
            logger.error(`Invoice não encontrado: ${invoiceID}`);
            continue;
          }

          // Verificar se já foi processado
          if (invoice.status === "paid") {
            logger.warn(`Invoice ${invoiceID} já está pago, ignorando duplicação`);
            continue;
          }

          const companyId = invoice.companyId;

          if (!companyId) {
            logger.error(`Invoice ${invoiceID} sem companyId`);
            continue;
          }

          logger.info(`Buscando company ID: ${companyId}`);

          const company = await Company.findByPk(companyId);

          if (!company) {
            logger.error(`Company não encontrada: ${companyId}`);
            continue;
          }

          // Calcular nova data de vencimento
          // Se dueDate existe, adiciona 30 dias. Se não, usa data atual + 30 dias
          const currentDueDate = company.dueDate ? moment(company.dueDate) : moment();
          const newDueDate = currentDueDate.add(30, "days").format();

          logger.info(`Atualizando company ${companyId} e invoice ${invoiceID}`);
          logger.info(`Nova data de vencimento: ${newDueDate}`);

          // Atualizar company
          await company.update({
            dueDate: newDueDate,
            status: true, // Ativar empresa se estiver desativada
          });

          // Atualizar invoice (corrigido: remover id do objeto de update)
          await invoice.update({
            status: "paid",
          });

          await company.reload();

          // Emitir evento via Socket.IO
          const io = getIO();
          const companyUpdate = await Company.findOne({
            where: {
              id: companyId
            }
          });

          if (companyUpdate) {
            io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-payment`, {
              action: "CONCLUIDA",
              company: companyUpdate,
              invoice: await invoice.reload(),
            });

            logger.info(`Pagamento PIX processado com sucesso - Company: ${companyId}, Invoice: ${invoiceID}`);
            processedPix.push({ txid: pix.txid, invoiceId: invoiceID, status: "processed" });
          }
        } else {
          logger.info(`PIX ${pix.txid} com status ${detalhe.status}, não processado`);
        }
      } catch (pixError: any) {
        logger.error(`Erro ao processar PIX ${pix.txid}:`, {
          error: pixError.message,
          stack: pixError.stack,
          txid: pix.txid,
        });
        // Continuar processando outros PIX mesmo se um falhar
      }
    }

    logger.info(`Webhook PIX processado. ${processedPix.length} PIX processados com sucesso`);

    return res.json({ 
      ok: true, 
      processed: processedPix.length,
      pix: processedPix 
    });
  } catch (error: any) {
    logger.error("Erro no webhook PIX:", {
      error: error.message,
      stack: error.stack,
      body: req.body,
    });
    // Retornar 200 para evitar reenvio do webhook
    return res.status(200).json({ 
      ok: false, 
      error: error.message 
    });
  }
};
