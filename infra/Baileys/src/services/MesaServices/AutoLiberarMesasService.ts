import { Op } from "sequelize";
import Mesa from "../../models/Mesa";
import Ticket from "../../models/Ticket";
import FormResponse from "../../models/FormResponse";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

const AutoLiberarMesasService = async (): Promise<{ total: number; mesas: Mesa[] }> => {
  // Calcular data de 24 horas atrás
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  // Buscar mesas ocupadas há mais de 24 horas
  const mesasOcupadas = await Mesa.findAll({
    where: {
      status: "ocupada",
      occupiedAt: {
        [Op.lt]: twentyFourHoursAgo,
      },
    },
  });

  if (mesasOcupadas.length === 0) {
    return { total: 0, mesas: [] };
  }

  const mesasLiberadas: Mesa[] = [];

  for (const mesa of mesasOcupadas) {
    try {
      // Atualizar pedidos relacionados
      if (mesa.sessionId) {
        await FormResponse.update(
          { orderStatus: "faturado" },
          { where: { mesaSessionId: mesa.sessionId, orderStatus: { [Op.ne]: "faturado" } } }
        );
      }

      // Fechar ticket relacionado se existir
      if (mesa.ticketId) {
        const ticket = await Ticket.findOne({
          where: { id: mesa.ticketId, companyId: mesa.companyId },
        });
        if (ticket && ticket.status !== "closed") {
          await ticket.update({ status: "closed" });
        }
      }

      // Liberar a mesa
      mesa.status = "livre";
      mesa.contactId = null;
      mesa.ticketId = null;
      mesa.occupiedAt = null;
      mesa.sessionId = null;
      await mesa.save();

      mesasLiberadas.push(mesa);

      // Emitir evento via socket
      const io = getIO();
      io.to(`company-${mesa.companyId}-mainchannel`).emit(`company-${mesa.companyId}-mesa`, {
        action: "liberar",
        mesa,
      });

      logger.info(`Mesa ${mesa.id} (${mesa.number || mesa.name}) liberada automaticamente após 24 horas`);
    } catch (err: any) {
      logger.error(`Erro ao liberar mesa ${mesa.id} automaticamente:`, err);
    }
  }

  return { total: mesasLiberadas.length, mesas: mesasLiberadas };
};

export default AutoLiberarMesasService;
