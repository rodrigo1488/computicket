import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";

/**
 * Fecha tickets órfãos, cuja conexão WhatsApp foi excluída.
 * Status DISCONNECTED não encerra conversas: uma queda breve não pode zerar a fila.
 */
const CloseStuckTicketsFromDisconnectedWhatsAppService = async (): Promise<{
  disconnectedClosed: number;
  orphanClosed: number;
  total: number;
}> => {
  let disconnectedClosed = 0;
  let orphanClosed = 0;

  try {
    // Queda ou status DISCONNECTED não encerra a fila. Só some o ticket
    // cuja conexão foi apagada de fato.
    // 2) Tickets órfãos: whatsappId que não existe mais (conexão foi excluída)
    const validWhatsappIds = await Whatsapp.findAll({ attributes: ["id"] });
    const validIds = validWhatsappIds.map((w) => w.id);
    if (validIds.length === 0) {
      // Nenhuma conexão no sistema: fechar todos os tickets abertos que têm whatsappId
      const [orphanCount] = await Ticket.update(
        { status: "closed" },
        {
          where: {
            status: { [Op.ne]: "closed" },
            whatsappId: { [Op.ne]: null }
          }
        }
      );
      orphanClosed = orphanCount;
    } else {
      const [orphanCount] = await Ticket.update(
        { status: "closed" },
        {
          where: {
            status: { [Op.ne]: "closed" },
            whatsappId: { [Op.notIn]: validIds }
          }
        }
      );
      orphanClosed = orphanCount;
    }

    const total = disconnectedClosed + orphanClosed;
    if (total > 0) {
      logger.info(
        `CloseStuckTicketsFromDisconnectedWhatsApp: ${disconnectedClosed} por conexão desconectada, ${orphanClosed} órfãos (conexão excluída). Total: ${total} ticket(s) fechado(s).`
      );
    }

    return { disconnectedClosed, orphanClosed, total };
  } catch (error: any) {
    logger.error(
      "Erro ao fechar tickets de conexões desconectadas/excluídas:",
      error
    );
    throw error;
  }
};

export default CloseStuckTicketsFromDisconnectedWhatsAppService;
