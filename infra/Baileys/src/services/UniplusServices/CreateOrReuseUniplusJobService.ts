import { Op } from "sequelize";
import PrintPedido from "../../models/PrintPedido";
import CreateAndDispatchPrintJobService, {
  dispatchJob,
} from "../PrintJobService/CreateAndDispatchPrintJobService";
import { patchFormResponseUniplusMetadata } from "./patchFormResponseUniplusMetadata";
import { logger } from "../../utils/logger";

interface Request {
  companyId: number;
  deviceId: string;
  formId: number;
  formResponseId: number;
  conteudo: object;
  externalRef: string;
}

interface Result {
  job: PrintPedido;
  dispatched: boolean;
  reused: boolean;
}

/**
 * Cria job uniplus com idempotência por externalRef / metadata.
 */
const CreateOrReuseUniplusJobService = async ({
  companyId,
  deviceId,
  formId,
  formResponseId,
  conteudo,
  externalRef,
}: Request): Promise<Result> => {
  const ref = String(externalRef || "").trim();
  if (!ref) {
    throw new Error("ERR_UNIPLUS_EXTERNAL_REF_MISSING");
  }

  const existingDone = await PrintPedido.findOne({
    where: {
      companyId,
      tipo: "uniplus",
      externalRef: ref,
      status: "done",
      uniplusContaId: { [Op.not]: null },
    },
    order: [["id", "DESC"]],
  });
  if (existingDone) {
    await patchFormResponseUniplusMetadata(formResponseId, {
      uniplusStatus: "synced",
      uniplusContaId: existingDone.uniplusContaId,
      uniplusSyncedAt: new Date().toISOString(),
      uniplusJobId: existingDone.id,
      uniplusLastError: null,
    });
    logger.info(
      `Uniplus job reuse done externalRef=${ref} jobId=${existingDone.id} conta=${existingDone.uniplusContaId}`
    );
    return { job: existingDone, dispatched: false, reused: true };
  }

  const existingActive = await PrintPedido.findOne({
    where: {
      companyId,
      tipo: "uniplus",
      externalRef: ref,
      status: { [Op.in]: ["pending", "printing"] },
    },
    order: [["id", "DESC"]],
  });
  if (existingActive) {
    await patchFormResponseUniplusMetadata(formResponseId, {
      uniplusStatus: "pending",
      uniplusJobId: existingActive.id,
      uniplusLastError: null,
    });
    let dispatched = false;
    // printing preso (agent caiu no meio) — libera para redispatch após 2 min
    if (existingActive.status === "printing") {
      const ageMs =
        Date.now() - new Date(existingActive.updatedAt as Date).getTime();
      if (ageMs > 2 * 60 * 1000) {
        await existingActive.update({
          status: "pending",
          errorMessage: "stale_printing_reset",
        });
        dispatched = await dispatchJob(existingActive);
        await existingActive.reload();
      }
    } else if (existingActive.status === "pending") {
      dispatched = await dispatchJob(existingActive);
      await existingActive.reload();
    }
    logger.info(
      `Uniplus job reuse active externalRef=${ref} jobId=${existingActive.id} status=${existingActive.status} dispatched=${dispatched}`
    );
    return { job: existingActive, dispatched, reused: true };
  }

  const { job, dispatched } = await CreateAndDispatchPrintJobService({
    companyId,
    deviceId,
    formId,
    formResponseId,
    conteudo,
    tipo: "uniplus",
    externalRef: ref,
  });

  await patchFormResponseUniplusMetadata(formResponseId, {
    uniplusStatus: "pending",
    uniplusJobId: job.id,
    uniplusLastError: null,
  });

  return { job, dispatched, reused: false };
};

export default CreateOrReuseUniplusJobService;
