import { Op } from "sequelize";
import PrintPedido from "../../models/PrintPedido";
import { isAgentConnected } from "../../libs/printWebSocket";
import { dispatchJob } from "../PrintJobService/CreateAndDispatchPrintJobService";
import { logger } from "../../utils/logger";

/**
 * Redespacha jobs UniPlus pending cujo agente estiver conectado.
 */
const RedispatchPendingUniplusJobsService = async (): Promise<number> => {
  const jobs = await PrintPedido.findAll({
    where: {
      tipo: "uniplus",
      status: "pending",
      expiresAt: { [Op.gt]: new Date() },
      tentativas: { [Op.lt]: 20 },
    },
    order: [["createdAt", "ASC"]],
    limit: 50,
  });

  let dispatched = 0;
  for (const job of jobs) {
    if (!isAgentConnected(job.companyId, job.deviceId)) {
      continue;
    }
    try {
      const ok = await dispatchJob(job);
      if (ok) dispatched += 1;
    } catch (err: any) {
      logger.warn(
        `RedispatchPendingUniplusJobs: job ${job.id} falhou: ${err?.message}`
      );
    }
  }

  if (dispatched > 0) {
    logger.info(`RedispatchPendingUniplusJobs: ${dispatched} job(s) reenviado(s)`);
  }
  return dispatched;
};

export default RedispatchPendingUniplusJobsService;
