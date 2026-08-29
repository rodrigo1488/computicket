import Form from "../../models/Form";
import FormField from "../../models/FormField";
import FormResponse from "../../models/FormResponse";
import ResponseAnswer from "../../models/ResponseAnswer";
import PrintDevice from "../../models/PrintDevice";
import AppError from "../../errors/AppError";
import CreateAndDispatchPrintJobService from "../PrintJobService/CreateAndDispatchPrintJobService";
import {
  buildPrintConteudoFromResponse,
  mapResponseAnswers,
} from "../../helpers/buildPrintConteudo";

export interface DispatchFreshDeliveryPrintResult {
  dispatched: number;
  jobs: Array<{ deviceId: string; jobId: number; dispatched: boolean }>;
}

/** Envia impressão delivery com conteúdo reconstruído do pedido atual. */
const DispatchFreshDeliveryPrintService = async ({
  companyId,
  formId,
  formResponseId,
}: {
  companyId: number;
  formId: number;
  formResponseId: number;
}): Promise<DispatchFreshDeliveryPrintResult> => {
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });
  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id: formResponseId, formId },
    include: [{ association: "answers", include: [{ association: "field" }] }],
  });
  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  const meta = (response.metadata || {}) as Record<string, unknown>;
  if (meta.orderType !== "delivery") {
    throw new AppError("Pedido não é delivery.", 400);
  }

  const menuItems = (meta.menuItems || []) as Record<string, unknown>[];
  if (!menuItems.length) {
    throw new AppError("Pedido sem itens para imprimir.", 400);
  }

  const fields = await FormField.findAll({
    where: { formId: form.id },
    order: [["order", "ASC"]],
  });

  const answers = mapResponseAnswers(response.answers || [], fields);
  const triggered = Array.isArray(meta.triggeredOrderMessages)
    ? (meta.triggeredOrderMessages as string[])
    : [];

  const conteudo = buildPrintConteudoFromResponse({
    form,
    response,
    fields,
    menuItems,
    answers,
    contactName: response.responderName,
    contactPhone: response.responderPhone,
    contactEmail: response.responderEmail,
    triggeredOrderMessages: triggered,
  });

  const formSettings = (form.settings || {}) as Record<string, unknown>;
  const printDeviceId = Number(formSettings.printDeviceId) || 0;
  const deliveryPrintDeviceIds = Array.isArray(formSettings.deliveryPrintDeviceIds)
    ? (formSettings.deliveryPrintDeviceIds as number[]).filter((id) => id > 0)
    : [];
  const deviceIds: number[] = deliveryPrintDeviceIds.length
    ? deliveryPrintDeviceIds
    : printDeviceId > 0
      ? [printDeviceId]
      : [];

  if (!deviceIds.length) {
    throw new AppError(
      "Nenhuma impressora configurada para pedidos delivery neste cardápio.",
      422
    );
  }

  const jobs: DispatchFreshDeliveryPrintResult["jobs"] = [];
  let dispatched = 0;

  for (const id of deviceIds) {
    const printDevice = await PrintDevice.findOne({
      where: { id, companyId },
    });
    if (!printDevice) continue;

    const { job, dispatched: ok } = await CreateAndDispatchPrintJobService({
      companyId,
      deviceId: printDevice.deviceId,
      formId: form.id,
      formResponseId: response.id,
      conteudo,
    });
    jobs.push({ deviceId: printDevice.deviceId, jobId: job.id, dispatched: ok });
    if (ok) dispatched += 1;
  }

  if (!jobs.length) {
    throw new AppError("Impressoras delivery não encontradas.", 422);
  }

  return { dispatched, jobs };
};

export default DispatchFreshDeliveryPrintService;
