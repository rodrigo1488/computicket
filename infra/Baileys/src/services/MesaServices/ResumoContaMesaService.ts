import { Op } from "sequelize";
import FormResponse from "../../models/FormResponse";
import Mesa from "../../models/Mesa";
import AppError from "../../errors/AppError";
import { calcSubtotalFromMenuItems } from "../../helpers/gourmetOrderTotals";

interface PedidoResumo {
  id: number;
  protocol: string;
  submittedAt: Date;
  total: number;
  menuItems: Array<{ productName?: string; quantity: number; productValue?: number; addonsTotal?: number }>;
}

interface Response {
  pedidos: PedidoResumo[];
  total: number;
  subtotal: number;
  mesa: { id: number; number: string; name: string; type?: string };
  cliente?: { id: number; name: string; number: string } | null;
}

const ResumoContaMesaService = async (mesaId: number, companyId: number): Promise<Response> => {
  const mesa = await Mesa.findOne({
    where: { id: mesaId, companyId },
    include: [{ association: "contact", attributes: ["id", "name", "number"] }],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  const cliente =
    mesa.contact != null
      ? { id: (mesa.contact as any).id, name: (mesa.contact as any).name, number: (mesa.contact as any).number }
      : null;

  const mesaInfo = { id: mesa.id, number: mesa.number, name: mesa.name, type: (mesa as any).type || "mesa" };

  if (!mesa.sessionId) {
    return {
      pedidos: [],
      total: 0,
      subtotal: 0,
      mesa: mesaInfo,
      cliente,
    };
  }

  const responses = await FormResponse.findAll({
    where: {
      mesaSessionId: mesa.sessionId,
      [Op.or]: [
        { orderStatus: { [Op.notIn]: ["faturado", "cancelado"] } },
        { orderStatus: null },
      ],
    },
    order: [["submittedAt", "ASC"]],
    attributes: ["id", "protocol", "submittedAt", "metadata"],
  });

  const pedidos: PedidoResumo[] = responses.map((r) => {
    const meta = (r as any).metadata || {};
    const total = calcSubtotalFromMenuItems(meta.menuItems || []);
    return {
      id: r.id,
      protocol: r.protocol || `#${r.id}`,
      submittedAt: r.submittedAt,
      total,
      menuItems: meta.menuItems || [],
    };
  });

  const subtotal = pedidos.reduce((s, p) => s + p.total, 0);

  return {
    pedidos,
    total: subtotal,
    subtotal,
    mesa: mesaInfo,
    cliente,
  };
};

export default ResumoContaMesaService;
