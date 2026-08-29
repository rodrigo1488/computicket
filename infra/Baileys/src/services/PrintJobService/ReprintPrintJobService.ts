import { Op } from "sequelize";
import PrintPedido from "../../models/PrintPedido";
import Form from "../../models/Form";
import FormField from "../../models/FormField";
import FormResponse from "../../models/FormResponse";
import PrintDevice from "../../models/PrintDevice";
import AppError from "../../errors/AppError";
import { applyPrintSettingsToConteudo } from "../../helpers/printFields";
import { dispatchJob } from "./CreateAndDispatchPrintJobService";
import DispatchFreshDeliveryPrintService from "../OrderServices/DispatchFreshDeliveryPrintService";
import { logger } from "../../utils/logger";

const JOB_EXPIRY_HOURS = 24;
/** Evita loop acidental / abuso: contagem por pedido (formResponse) na última hora. */
const MAX_PRINT_JOBS_PER_RESPONSE_PER_HOUR = 25;

export interface ReprintPrintJobResult {
  job: PrintPedido;
  dispatched: boolean;
}

function cloneConteudo(conteudo: unknown): object {
  if (conteudo === null || conteudo === undefined) {
    throw new AppError("Conteúdo do job de impressão ausente.", 422);
  }
  if (typeof conteudo !== "object" || Array.isArray(conteudo)) {
    throw new AppError("Conteúdo do job de impressão em formato inválido.", 422);
  }
  try {
    const copy = JSON.parse(JSON.stringify(conteudo)) as object;
    if (!copy || Object.keys(copy).length === 0) {
      throw new AppError("Conteúdo do pedido vazio; não é possível reimprimir.", 422);
    }
    return copy;
  } catch (e) {
    if (e instanceof AppError) {
      throw e;
    }
    throw new AppError("Não foi possível copiar o conteúdo do pedido para reimpressão.", 422);
  }
}

/**
 * Valida e cria um novo PrintPedido a partir de um job já existente (mesmo conteúdo).
 * Sempre gera novo `id` para não conflitar com ACK do job original.
 */
export async function reprintFromSourceJob(
  source: PrintPedido,
  companyId: number
): Promise<ReprintPrintJobResult> {
  if (source.companyId !== companyId) {
    throw new AppError("Job de impressão não encontrado.", 404);
  }

  if (source.status === "printing" && (source.tipo || "print") !== "uniplus") {
    throw new AppError(
      "Este pedido ainda está em impressão. Aguarde concluir antes de solicitar reimpressão.",
      409
    );
  }

  // Reimprimir = só cupom. Job UniPlus já sincronizado não deve ir de novo ao ERP.
  if ((source.tipo || "print") === "uniplus") {
    return reprintPhysicalOnlyFromFormResponse({
      companyId,
      formId: source.formId,
      formResponseId: source.formResponseId
    });
  }

  const form = await Form.findOne({
    where: { id: source.formId, companyId }
  });
  if (!form) {
    throw new AppError("Formulário deste job não existe ou não pertence à empresa.", 404);
  }

  const formResponse = await FormResponse.findOne({
    where: { id: source.formResponseId, formId: source.formId }
  });
  if (!formResponse) {
    throw new AppError("Resposta do formulário (pedido) não encontrada.", 404);
  }

  const device = await PrintDevice.findOne({
    where: { companyId, deviceId: source.deviceId }
  });
  if (!device) {
    throw new AppError(
      "O dispositivo de impressão associado a este job não existe mais. Ajuste o formulário ou cadastre o dispositivo novamente.",
      422
    );
  }

  const conteudo = cloneConteudo(source.conteudo) as Record<string, unknown>;
  const fields = await FormField.findAll({
    where: { formId: form.id },
    order: [["order", "ASC"]],
  });
  const refreshedConteudo = applyPrintSettingsToConteudo(
    conteudo,
    (form.settings || {}) as Record<string, unknown>,
    fields
  );

  const since = new Date();
  since.setHours(since.getHours() - 1);

  const recentForResponse = await PrintPedido.count({
    where: {
      companyId,
      formResponseId: source.formResponseId,
      createdAt: { [Op.gt]: since }
    }
  });

  if (recentForResponse >= MAX_PRINT_JOBS_PER_RESPONSE_PER_HOUR) {
    throw new AppError(
      "Limite de envios à impressão para este pedido na última hora foi atingido. Tente novamente mais tarde.",
      429
    );
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + JOB_EXPIRY_HOURS);

  const job = await PrintPedido.create({
    companyId: source.companyId,
    deviceId: source.deviceId,
    formId: source.formId,
    formResponseId: source.formResponseId,
    conteudo: refreshedConteudo,
    tipo: "print",
    externalRef: source.externalRef || null,
    status: "pending",
    tentativas: 0,
    maxTentativas: 3,
    expiresAt
  });

  const dispatched = await dispatchJob(job);
  await job.reload();

  logger.info(
    `reprintFromSourceJob: novo job id=${job.id} a partir do job id=${source.id} (companyId=${companyId}, deviceId=${source.deviceId}, dispatched=${dispatched})`
  );

  return { job, dispatched };
}

/** Usa o último job de impressão do pedido como modelo (útil na UI por formResponseId). */
export async function ReprintLastPrintJobForFormResponse({
  companyId,
  formId,
  formResponseId
}: {
  companyId: number;
  formId: number;
  formResponseId: number;
}): Promise<ReprintPrintJobResult> {
  if (!Number.isFinite(formId) || formId <= 0 || !Number.isFinite(formResponseId) || formResponseId <= 0) {
    throw new AppError("Parâmetros inválidos.", 400);
  }

  const form = await Form.findOne({ where: { id: formId, companyId } });
  if (!form) {
    throw new AppError("Formulário não encontrado.", 404);
  }

  const formResponse = await FormResponse.findOne({
    where: { id: formResponseId, formId }
  });
  if (!formResponse) {
    throw new AppError("Resposta não encontrada.", 404);
  }

  const source = await PrintPedido.findOne({
    where: {
      companyId,
      formId,
      formResponseId,
      [Op.or]: [{ tipo: "print" }, { tipo: null }],
    },
    order: [["createdAt", "DESC"]],
  });

  if (source) {
    return reprintFromSourceJob(source, companyId);
  }

  const orderType = String(
    ((formResponse.metadata || {}) as Record<string, unknown>).orderType || ""
  );
  if (orderType === "delivery") {
    return reprintPhysicalOnlyFromFormResponse({
      companyId,
      formId,
      formResponseId
    });
  }

  throw new AppError(
    "Nenhuma impressão registrada para este pedido ainda. É necessário que o pedido tenha sido enviado à impressora ao menos uma vez.",
    404
  );
}

async function reprintPhysicalOnlyFromFormResponse({
  companyId,
  formId,
  formResponseId
}: {
  companyId: number;
  formId: number;
  formResponseId: number;
}): Promise<ReprintPrintJobResult> {
  const result = await DispatchFreshDeliveryPrintService({
    companyId,
    formId,
    formResponseId
  });
  const first = result.jobs[0];
  const job = await PrintPedido.findByPk(first.jobId);
  if (!job) {
    throw new AppError("Não foi possível criar o job de reimpressão.", 500);
  }
  logger.info(
    `reprintPhysicalOnly: formResponseId=${formResponseId} jobs=${result.jobs.length} dispatched=${result.dispatched} (sem UniPlus)`
  );
  return { job, dispatched: result.dispatched > 0 };
}

const ReprintPrintJobService = async ({
  companyId,
  sourceJobId
}: {
  companyId: number;
  sourceJobId: number;
}): Promise<ReprintPrintJobResult> => {
  if (!Number.isFinite(sourceJobId) || sourceJobId <= 0) {
    throw new AppError("ID do job inválido.", 400);
  }

  const source = await PrintPedido.findOne({
    where: { id: sourceJobId, companyId }
  });

  if (!source) {
    throw new AppError("Job de impressão não encontrado.", 404);
  }

  return reprintFromSourceJob(source, companyId);
};

export default ReprintPrintJobService;
