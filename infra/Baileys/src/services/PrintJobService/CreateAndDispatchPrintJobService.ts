import PrintPedido from "../../models/PrintPedido";
import { sendPrintJob, isAgentConnected } from "../../libs/printWebSocket";
import { logger } from "../../utils/logger";

export type PrintJobTipo = "print" | "uniplus";

interface Request {
  companyId: number;
  deviceId: string;
  formId: number;
  formResponseId: number;
  conteudo: object;
  tipo?: PrintJobTipo;
  externalRef?: string | null;
}

interface Result {
  job: PrintPedido;
  dispatched: boolean;
}

const JOB_EXPIRY_HOURS = 24;

const CreateAndDispatchPrintJobService = async ({
  companyId,
  deviceId,
  formId,
  formResponseId,
  conteudo,
  tipo = "print",
  externalRef = null,
}: Request): Promise<Result> => {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + JOB_EXPIRY_HOURS);

  const job = await PrintPedido.create({
    companyId,
    deviceId,
    formId,
    formResponseId,
    conteudo,
    tipo,
    externalRef,
    status: "pending",
    tentativas: 0,
    maxTentativas: 3,
    expiresAt,
  });

  const dispatched = await dispatchJob(job);
  return { job, dispatched };
};

export async function dispatchJob(job: PrintPedido): Promise<boolean> {
  if (new Date() > job.expiresAt!) {
    logger.warn(`Print job ${job.id} expired, not dispatching`);
    return false;
  }

  const [affected] = await PrintPedido.update(
    {
      status: "printing",
      tentativas: job.tentativas + 1,
    },
    {
      where: {
        id: job.id,
        status: "pending",
      },
    }
  );

  if (affected === 0) {
    logger.warn(`Print job ${job.id} already taken by another process`);
    return false;
  }

  const isConnected = isAgentConnected(job.companyId, job.deviceId);
  logger.info(
    `Print job ${job.id}: checking agent connection - companyId=${job.companyId}, deviceId=${job.deviceId}, connected=${isConnected}, tipo=${job.tipo || "print"}`
  );

  if (!isConnected) {
    await job.update({
      status: "pending",
      tentativas: job.tentativas,
    });
    logger.warn(
      `Print job ${job.id}: no agent connected for deviceId=${job.deviceId}, will retry later`
    );
    return false;
  }

  logger.info(
    `Print job ${job.id}: sending to deviceId=${job.deviceId}, companyId=${job.companyId}, tipo=${job.tipo || "print"}`
  );
  const sent = sendPrintJob(job.companyId, job.deviceId, {
    id: job.id,
    conteudo: job.conteudo || {},
    tipo: (job.tipo as PrintJobTipo) || "print",
  });

  if (!sent) {
    await job.update({
      status: "pending",
      tentativas: job.tentativas,
    });
    logger.warn(
      `Print job ${job.id}: failed to send via WebSocket to deviceId=${job.deviceId}`
    );
    return false;
  }

  logger.info(
    `Print job ${job.id} dispatched successfully to agent (deviceId=${job.deviceId})`
  );
  return true;
}

export default CreateAndDispatchPrintJobService;
