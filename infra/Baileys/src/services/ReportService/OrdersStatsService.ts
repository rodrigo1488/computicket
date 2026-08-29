import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import { Op } from "sequelize";
import { getBrazilDayBounds } from "../../helpers/BrazilTimezone";

const RESPONSES_MAX_AGE_HOURS = 24;
const getCutoff = () => new Date(Date.now() - RESPONSES_MAX_AGE_HOURS * 60 * 60 * 1000);

export interface OrdersStats {
  pedidosHoje: number;
  pedidosEmAndamento: number;
  pedidosConfirmados: number;
  firstCardapioFormId?: number;
}

const QUEUE_STATUSES = ["novo", "confirmado", "em_preparo"];

const OrdersStatsService = async (companyId: number | string): Promise<OrdersStats> => {
  const now = new Date();
  const { startOfDay, endOfDay } = getBrazilDayBounds(now);

  const cardapioForms = await Form.findAll({
    where: {
      companyId,
      isActive: true,
    },
    attributes: ["id"],
  });
  const cardapioFormIds = cardapioForms
    .filter((f) => (f.settings as any)?.formType === "cardapio")
    .map((f) => f.id);
  const firstCardapioFormId = cardapioFormIds[0] || undefined;

  if (cardapioFormIds.length === 0) {
    return { pedidosHoje: 0, pedidosEmAndamento: 0, pedidosConfirmados: 0, firstCardapioFormId };
  }

  const cutoff = getCutoff();
  const [pedidosHoje, pedidosEmAndamento, pedidosConfirmados] = await Promise.all([
    FormResponse.count({
      where: {
        formId: { [Op.in]: cardapioFormIds },
        submittedAt: { [Op.between]: [startOfDay, endOfDay] } as any,
      },
    }),
    FormResponse.count({
      where: {
        formId: { [Op.in]: cardapioFormIds },
        orderStatus: { [Op.in]: QUEUE_STATUSES },
        submittedAt: { [Op.gte]: cutoff } as any,
      },
    }),
    FormResponse.count({
      where: {
        formId: { [Op.in]: cardapioFormIds },
        orderStatus: "confirmado",
        submittedAt: { [Op.gte]: cutoff } as any,
      },
    }),
  ]);

  return {
    pedidosHoje,
    pedidosEmAndamento,
    pedidosConfirmados,
    firstCardapioFormId,
  };
};

export default OrdersStatsService;
