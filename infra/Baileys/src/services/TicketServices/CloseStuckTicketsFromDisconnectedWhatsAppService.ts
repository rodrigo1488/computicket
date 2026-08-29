import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";
import Ticket from "../../models/Ticket";
import CloseTicketsByWhatsAppIdService from "./CloseTicketsByWhatsAppIdService";
import { logger } from "../../utils/logger";

/**
 * Fecha todos os tickets (chats) que estão "travados" porque a conexão WhatsApp
 * está desconectada ou foi excluída. Deve rodar na subida do servidor e diariamente (ex.: 00:00).
 */
const CloseStuckTicketsFromDisconnectedWhatsAppService = async (): Promise<{
  disconnectedClosed: number;
  orphanClosed: number;
  total: number;
}> => {
  let disconnectedClosed = 0;
  let orphanClosed = 0;

  try {
    // 1) Conexões com status DISCONNECTED: fechar todos os tickets dessas conexões
    const disconnectedWhatsapps = await Whatsapp.findAll({
      where: { status: "DISCONNECTED" },
      attributes: ["id"]
    });

    for (const w of disconnectedWhatsapps) {
      const count = await CloseTicketsByWhatsAppIdService(w.id);
      disconnectedClosed += count;
    }

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
