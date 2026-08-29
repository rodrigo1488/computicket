import { Op } from "sequelize";
import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import FormField from "../../models/FormField";
import ResponseAnswer from "../../models/ResponseAnswer";
import AppError from "../../errors/AppError";
import BuildUniplusDeliveryPayloadService, {
  resolveUniplusDeviceId,
} from "./BuildUniplusDeliveryPayloadService";
import CreateOrReuseUniplusJobService from "./CreateOrReuseUniplusJobService";
import { patchFormResponseUniplusMetadata } from "./patchFormResponseUniplusMetadata";
import PrintPedido from "../../models/PrintPedido";

interface Request {
  companyId: number;
  formResponseId: number;
}

/**
 * Reprocessa sync UniPlus após correção de config/produto.
 * Sem preflight: despacha direto se houver device.
 */
const ReprocessUniplusFormResponseService = async ({
  companyId,
  formResponseId,
}: Request) => {
  const response = await FormResponse.findByPk(formResponseId);
  if (!response) {
    throw new AppError("FormResponse não encontrada", 404);
  }

  const form = await Form.findOne({
    where: { id: response.formId, companyId },
  });
  if (!form) {
    throw new AppError("Formulário não encontrado", 404);
  }

  const meta = (response.metadata || {}) as Record<string, any>;
  if (meta.uniplusContaId) {
    return {
      ok: true,
      reused: true,
      uniplusContaId: meta.uniplusContaId,
      message: "Já sincronizado com UniPlus",
    };
  }

  const existingDone = await PrintPedido.findOne({
    where: {
      companyId,
      formResponseId: response.id,
      tipo: "uniplus",
      status: "done",
      uniplusContaId: { [Op.not]: null },
    },
    order: [["id", "DESC"]],
  });
  if (existingDone?.uniplusContaId) {
    await patchFormResponseUniplusMetadata(response.id, {
      uniplusStatus: "synced",
      uniplusContaId: existingDone.uniplusContaId,
      uniplusSyncedAt: new Date().toISOString(),
      uniplusJobId: existingDone.id,
      uniplusLastError: null,
    });
    return {
      ok: true,
      reused: true,
      uniplusContaId: existingDone.uniplusContaId,
      message: "Job UniPlus já concluído",
    };
  }

  const menuItems = Array.isArray(meta.menuItems) ? meta.menuItems : [];
  if (!menuItems.length) {
    throw new AppError("Pedido sem itens para UniPlus", 422);
  }

  const deviceId = await resolveUniplusDeviceId(companyId, form);
  if (!deviceId) {
    await patchFormResponseUniplusMetadata(response.id, {
      uniplusStatus: "error",
      uniplusLastError: "Sem PrintDevice UniPlus/delivery configurado",
      uniplusLastErrorAt: new Date().toISOString(),
    });
    throw new AppError("Sem PrintDevice UniPlus/delivery configurado", 422);
  }

  const fields = await FormField.findAll({ where: { formId: form.id } });
  const answerRows = await ResponseAnswer.findAll({
    where: { responseId: response.id },
  });
  const answers = answerRows.map((a) => ({
    fieldId: a.fieldId,
    answer: a.answer as string | string[],
  }));

  const payload = await BuildUniplusDeliveryPayloadService({
    companyId,
    form,
    response,
    menuItems,
    contactName: response.responderName,
    contactPhone: response.responderPhone,
    fields,
    answers,
  });

  const result = await CreateOrReuseUniplusJobService({
    companyId,
    deviceId,
    formId: form.id,
    formResponseId: response.id,
    conteudo: payload,
    externalRef: payload.protocol,
  });

  return {
    ok: true,
    reused: result.reused,
    dispatched: result.dispatched,
    jobId: result.job.id,
    status: result.job.status,
    message: result.dispatched
      ? "Job UniPlus reenviado ao agente"
      : result.reused
        ? "Job UniPlus reutilizado"
        : "Job UniPlus criado; aguardando agente",
  };
};

export default ReprocessUniplusFormResponseService;
