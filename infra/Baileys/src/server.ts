import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { initPrintWebSocket } from "./libs/printWebSocket";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import cron from "node-cron";
import RenewSubscriptionService, { findCompaniesNeedingRenewal } from "./services/SubscriptionService/RenewSubscriptionService";
import CloseStuckTicketsFromDisconnectedWhatsAppService from "./services/TicketServices/CloseStuckTicketsFromDisconnectedWhatsAppService";
import AutoLiberarMesasService from "./services/MesaServices/AutoLiberarMesasService";
import { Op } from "sequelize";
import PrintPedido from "./models/PrintPedido";
import FormResponse from "./models/FormResponse";
import {
  isDbUnavailableError,
  logCronDbUnavailable,
} from "./utils/dbUnavailable";
import runMinuteCronJobs from "./services/MinuteCronJobsService";
import {
  isWhatsAppEnabled,
  isBullWorkersEnabled,
  shouldStartCompanyWhatsApp,
  logWhatsAppShardConfig
} from "./utils/whatsappShard";

const listenPort = Number(process.env.PORT) || 4000;
const listenHost =
  process.env.DEV_NETWORK === "true" || process.env.DEV_NETWORK === "1"
    ? "0.0.0.0"
    : undefined;

const onListen = async () => {
  if (listenHost) {
    logger.info(`DEV_NETWORK ativo — backend escutando em 0.0.0.0:${listenPort}`);
  }
  logWhatsAppShardConfig();
  let companies: Company[] = [];
  try {
    companies = await Company.findAll();
  } catch (err: any) {
    // Evita derrubar o processo se o banco não estiver acessível (timeout, rede, credenciais)
    logger.error(
      "Falha ao carregar empresas na inicialização — verifique PostgreSQL e DATABASE_URL/host. WhatsApp não será iniciado até o banco responder.",
      err?.message || err
    );
    companies = [];
  }

  const allPromises: any[] = [];
  if (isWhatsAppEnabled()) {
    companies.forEach((c) => {
      if (shouldStartCompanyWhatsApp(c.id)) {
        allPromises.push(StartAllWhatsAppsSessions(c.id));
      }
    });
  } else {
    logger.info(
      "ENABLE_WHATSAPP=false — sessões Baileys não serão iniciadas neste processo."
    );
  }

  const startWorkers = () => {
    if (isBullWorkersEnabled()) {
      startQueueProcess();
    } else {
      logger.info(
        "ENABLE_BULL_WORKERS=false — filas Bull não serão processadas neste processo."
      );
    }
  };

  if (allPromises.length === 0) {
    startWorkers();
  } else {
    Promise.all(allPromises)
      .then(() => startWorkers())
      .catch((e) => {
        logger.error("Erro ao iniciar sessões WhatsApp na subida:", e);
        startWorkers();
      });
  }
  
  // Fechar tickets travados por conexões WhatsApp desconectadas ou excluídas
  setTimeout(async () => {
    try {
      const result = await CloseStuckTicketsFromDisconnectedWhatsAppService();
      if (result.total > 0) {
        logger.info(`Inicialização: ${result.total} ticket(s) travado(s) foram fechados.`);
      }
    } catch (err: any) {
      if (isDbUnavailableError(err))
        logCronDbUnavailable("CloseStuckTickets init");
      else logger.error("Erro ao fechar tickets travados na inicialização:", err);
    }
  }, 3000);

  // Permitir pedidos longos (IA local pode levar vários minutos)
  server.timeout = 360_000;         // 6 min — prazo total do socket HTTP
  server.keepAliveTimeout = 365_000; // ligeiramente acima do timeout de pedido

  logger.info(`Server started on port: ${listenPort}`);
};

const server = listenHost
  ? app.listen(listenPort, listenHost, onListen)
  : app.listen(listenPort, onListen);

// Jobs por minuto unificados (transferência, lembretes, pedidos, impressão)
cron.schedule("* * * * *", async () => {
  await runMinuteCronJobs();
});

// Job para verificar e processar renovações de assinaturas
// Roda diariamente às 9h da manhã
cron.schedule("0 9 * * *", async () => {
  try {
    logger.info("Iniciando verificação de renovações de assinaturas...");
    
    const companiesNeedingRenewal = await findCompaniesNeedingRenewal();
    
    logger.info(`Encontradas ${companiesNeedingRenewal.length} empresas que precisam de renovação`);
    
    for (const company of companiesNeedingRenewal) {
      try {
        const result = await RenewSubscriptionService(company.id);
        
        if (result.success) {
          logger.info(`Renovação processada com sucesso para empresa ${company.id} via ${result.method}`);
        } else {
          logger.warn(`Falha ao renovar empresa ${company.id}: ${result.message || result.error}`);
        }
      } catch (error: any) {
        logger.error(`Erro ao processar renovação para empresa ${company.id}:`, error);
        // Continuar com as próximas empresas mesmo se uma falhar
      }
    }
    
    logger.info("Verificação de renovações concluída");
  } catch (error: any) {
    if (isDbUnavailableError(error))
      logCronDbUnavailable("renewal");
    else logger.error("Erro no job de renovação de assinaturas:", error);
  }
});

// Cleanup de jobs expirados (done/error com mais de 24h)
cron.schedule("0 2 * * *", async () => {
  try {
    const result = await PrintPedido.destroy({
      where: {
        status: { [Op.in]: ["done", "error"] },
        expiresAt: { [Op.lt]: new Date() }
      }
    });
    if (result > 0) {
      logger.info(`Cleaned up ${result} expired print job(s)`);
    }
  } catch (error: any) {
    if (isDbUnavailableError(error)) logCronDbUnavailable("PrintPedido cleanup");
    else logger.error("Erro no cleanup de jobs de impressão:", error);
  }
});

// Cleanup de respostas/pedidos de formulário com mais de 24h
cron.schedule("0 3 * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await FormResponse.destroy({
      where: { submittedAt: { [Op.lt]: cutoff } }
    });
    if (result > 0) {
      logger.info(`Removidas ${result} resposta(s) de formulário com mais de 24h`);
    }
  } catch (error: any) {
    if (isDbUnavailableError(error)) logCronDbUnavailable("FormResponse cleanup");
    else logger.error("Erro no cleanup de respostas de formulário:", error);
  }
});

// Fechar tickets travados por conexão WhatsApp desconectada ou excluída — diariamente às 00:00
cron.schedule("0 0 * * *", async () => {
  try {
    logger.info("Iniciando verificação diária de tickets travados (conexões desconectadas/excluídas)...");
    const result = await CloseStuckTicketsFromDisconnectedWhatsAppService();
    if (result.total > 0) {
      logger.info(`Verificação diária: ${result.total} ticket(s) travado(s) foram fechados.`);
    } else {
      logger.info("Verificação diária de tickets travados concluída (nenhum ticket para fechar).");
    }
  } catch (error: any) {
    if (isDbUnavailableError(error))
      logCronDbUnavailable("CloseStuckTickets");
    else logger.error("Erro no job de fechamento de tickets travados:", error);
  }
});

// Job para liberar automaticamente mesas/comandas ocupadas há mais de 24 horas
// Roda a cada hora
cron.schedule("0 * * * *", async () => {
  try {
    logger.info("Iniciando verificação de mesas ocupadas há mais de 24 horas...");
    const result = await AutoLiberarMesasService();
    if (result.total > 0) {
      logger.info(`Liberação automática: ${result.total} mesa(s) liberada(s) automaticamente após 24 horas.`);
    } else {
      logger.info("Verificação de mesas concluída (nenhuma mesa para liberar).");
    }
  } catch (error: any) {
    if (isDbUnavailableError(error)) logCronDbUnavailable("AutoLiberarMesas");
    else logger.error("Erro no job de liberação automática de mesas:", error);
  }
});

initIO(server);
initPrintWebSocket(server);
gracefulShutdown(server);
