import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import UpdateOrderStatusService from "./UpdateOrderStatusService";

/**
 * Busca pedidos em status "novo" que devem ser automaticamente
 * avançados para "confirmado". Usa autoConfirmMinutes (aba Quadro) ou,
 * se não definido, autoAdvanceInterval (configuração "Avançar por todos os estágios") em minutos.
 */
const CheckOrderAutoConfirmService = async (): Promise<void> => {
  try {
    const now = new Date();

    const forms = await Form.findAll({
      where: {
        isActive: true,
      },
    });

    for (const form of forms) {
      const formSettings = typeof form.settings === "object" && form.settings !== null
        ? (form.settings as Record<string, unknown>)
        : {};
      if (formSettings.formType !== "cardapio") continue;

      const autoConfirmMinutes = Number(formSettings.autoConfirmMinutes) || 0;
      const autoAdvanceInterval = Number(formSettings.autoAdvanceInterval) || 0;
      const minutesToUse = autoConfirmMinutes > 0 ? autoConfirmMinutes : (autoAdvanceInterval > 0 ? autoAdvanceInterval : 0);
      if (minutesToUse <= 0) continue;

      const cutoffTime = new Date(now.getTime() - minutesToUse * 60 * 1000);

      const responses = await FormResponse.findAll({
        where: {
          formId: form.id,
          orderStatus: "novo",
          submittedAt: { [Op.lte]: cutoffTime },
        },
      });

      for (const response of responses) {
        try {
          await UpdateOrderStatusService({
            formId: form.id,
            responseId: response.id,
            orderStatus: "confirmado",
            companyId: form.companyId,
          });
          logger.info(
            `CheckOrderAutoConfirm: Pedido ${response.id} (${response.protocol || response.id}) avançado para confirmado`
          );
        } catch (err: any) {
          logger.error(`CheckOrderAutoConfirm: Erro ao atualizar pedido ${response.id}:`, err?.message);
        }
      }
    }
  } catch (err: any) {
    logger.error("CheckOrderAutoConfirm: Erro geral:", err?.message);
  }
};

export default CheckOrderAutoConfirmService;
