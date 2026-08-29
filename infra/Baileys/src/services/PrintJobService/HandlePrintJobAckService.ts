import PrintPedido from "../../models/PrintPedido";
import { logger } from "../../utils/logger";
import { patchFormResponseUniplusMetadata } from "../UniplusServices/patchFormResponseUniplusMetadata";

interface Request {
  jobId: number;
  status: string;
  message?: string;
  companyId: number;
  deviceId: string;
  uniplusContaId?: number | null;
  uniplusAction?: string | null;
  uniplusNumeromesa?: number | null;
  protocol?: string | null;
  permanent?: boolean;
}

const PERMANENT_ERROR_MARKERS = [
  "ERR_UNIPLUS_PRODUCT",
  "ERR_UNIPLUS_USE_CODIGO_NOT_ID",
  "ERR_UNIPLUS_PROTOCOL_CLOSED",
  "ERR_UNIPLUS_PAYLOAD",
  "ERR_UNIPLUS_CONFIG",
  "Produto UniPlus não encontrado",
  "Payload incompleto",
  "Payload sem protocol",
  "Item sem codigoproduto",
  "use o codigo visível",
  "UniPlus desabilitado",
  "uniplus_connection_string",
  "psycopg2 não instalado",
];

function isPermanentUniplusError(message?: string): boolean {
  const m = String(message || "");
  return PERMANENT_ERROR_MARKERS.some((marker) => m.includes(marker));
}

const HandlePrintJobAckService = async ({
  jobId,
  status,
  message,
  companyId,
  deviceId,
  uniplusContaId,
  uniplusAction,
  uniplusNumeromesa,
  permanent,
}: Request): Promise<void> => {
  const job = await PrintPedido.findOne({
    where: {
      id: jobId,
      companyId,
      deviceId,
      status: "printing",
    },
  });

  if (!job) {
    logger.warn(`Print job ack: job ${jobId} not found or not in printing state`);
    return;
  }

  const isUniplus = (job.tipo || "print") === "uniplus";

  if (status === "done") {
    if (isUniplus && (uniplusContaId == null || !Number.isFinite(Number(uniplusContaId)))) {
      // Sucesso sem contaId é inválido — trata como erro retryable
      await job.update({
        status: "pending",
        errorMessage: message || "ERR_UNIPLUS_ACK_MISSING_CONTA_ID",
      });
      await patchFormResponseUniplusMetadata(job.formResponseId, {
        uniplusStatus: "error",
        uniplusLastError: "ERR_UNIPLUS_ACK_MISSING_CONTA_ID",
        uniplusLastErrorAt: new Date().toISOString(),
        uniplusJobId: job.id,
      });
      logger.warn(
        `Print job ${jobId}: uniplus done sem uniplusContaId — voltando para pending`
      );
      return;
    }

    const updates: Partial<PrintPedido> = {
      status: "done",
      printedAt: new Date(),
      errorMessage: null,
    };
    if (isUniplus && uniplusContaId != null) {
      updates.uniplusContaId = Number(uniplusContaId);
    }
    await job.update(updates);
    logger.info(
      `Print job ${jobId} completed successfully (tipo=${job.tipo || "print"})`
    );

    if (!isUniplus && job.formResponseId) {
      await patchFormResponseUniplusMetadata(job.formResponseId, {
        printStatus: "synced",
        printSyncedAt: new Date().toISOString(),
        printLastError: null,
      });
    }

    if (isUniplus && job.formResponseId && uniplusContaId != null) {
      await patchFormResponseUniplusMetadata(job.formResponseId, {
        uniplusStatus: "synced",
        uniplusContaId: Number(uniplusContaId),
        uniplusSyncedAt: new Date().toISOString(),
        uniplusAction: uniplusAction || null,
        uniplusNumeromesa:
          uniplusNumeromesa != null ? Number(uniplusNumeromesa) : null,
        uniplusJobId: job.id,
        uniplusLastError: null,
        uniplusLastErrorAt: null,
      });
    }
  } else if (status === "error") {
    // tentativas já foi incrementada no dispatchJob — não incrementar de novo
    const tentativas = job.tentativas;
    const permanentError =
      permanent === true || (isUniplus && isPermanentUniplusError(message));
    const newStatus =
      permanentError || tentativas >= job.maxTentativas ? "error" : "pending";

    await job.update({
      status: newStatus,
      errorMessage: message || "Print failed",
    });
    logger.info(
      `Print job ${jobId} failed (attempt ${tentativas}/${job.maxTentativas}, permanent=${permanentError}): ${message || "unknown"}`
    );

    if (job.formResponseId) {
      if (isUniplus) {
        await patchFormResponseUniplusMetadata(job.formResponseId, {
          uniplusStatus: "error",
          uniplusLastError: message || "UniPlus failed",
          uniplusLastErrorAt: new Date().toISOString(),
          uniplusJobId: job.id,
        });
      } else {
        await patchFormResponseUniplusMetadata(job.formResponseId, {
          printStatus: newStatus === "error" ? "error" : "pending",
          printLastError: message || "Print failed",
        });
      }
    }
  }
};

export default HandlePrintJobAckService;
