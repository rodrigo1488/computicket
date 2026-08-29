import { Op } from "sequelize";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";

/**
 * Fecha automaticamente tickets inativos há 48 horas ou mais.
 * Considera inatividade baseada em updatedAt (última interação).
 * 
 * @returns Número de tickets fechados
 */
const CloseInactiveTicketsService = async (): Promise<number> => {
  try {
    // Calcular data de 48 horas atrás
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

    // Buscar tickets inativos (não fechados) há 48h ou mais
    const inactiveTickets = await Ticket.findAll({
      where: {
        status: { [Op.ne]: "closed" },
        updatedAt: { [Op.lt]: fortyEightHoursAgo }
      },
      include: [
        { model: Contact, as: "contact", attributes: ["id", "name", "number"] },
        { model: User, as: "user", attributes: ["id", "name"], required: false },
        { model: Queue, as: "queue", attributes: ["id", "name"], required: false }
      ]
    });

    if (inactiveTickets.length === 0) {
      logger.debug("CloseInactiveTicketsService: Nenhum ticket inativo há 48h encontrado");
      return 0;
    }

    logger.info(`CloseInactiveTicketsService: Encontrados ${inactiveTickets.length} ticket(s) inativo(s) há 48h+ para fechar`);

    const io = getIO();
    let closedCount = 0;

    for (const ticket of inactiveTickets) {
      try {
        const oldStatus = ticket.status;
        const companyId = ticket.companyId;

        // Fechar o ticket
        await ticket.update({
          status: "closed",
          unreadMessages: 0
        });

        closedCount++;

        // Emitir eventos Socket.IO para atualizar frontend
        // Remover da lista de status antigo
        const roomsToEmit = [`company-${companyId}-${oldStatus}`];
        if (ticket.queueId) {
          roomsToEmit.push(`queue-${ticket.queueId}-${oldStatus}`);
        }
        io.to(roomsToEmit).emit(`company-${companyId}-ticket`, {
          action: "delete",
          ticketId: ticket.id
        });

        // Adicionar à lista de fechados
        await ticket.reload({
          include: [
            { model: Contact, as: "contact" },
            { model: User, as: "user", required: false },
            { model: Queue, as: "queue", required: false }
          ]
        });

        const closedRoomsToEmit = [`company-${companyId}-closed`];
        if (ticket.queueId) {
          closedRoomsToEmit.push(`queue-${ticket.queueId}-closed`);
        }
        io.to(closedRoomsToEmit).emit(`company-${companyId}-ticket`, {
          action: "update",
          ticket,
          ticketId: ticket.id
        });

        logger.debug({
          msg: "Ticket fechado automaticamente por inatividade (48h)",
          ticketId: ticket.id,
          companyId,
          oldStatus,
          lastUpdate: ticket.updatedAt
        });
      } catch (error: any) {
        logger.error({
          msg: "Erro ao fechar ticket inativo",
          ticketId: ticket.id,
          companyId: ticket.companyId,
          error: error?.message || error
        });
        Sentry.captureException(error, {
          tags: {
            service: "CloseInactiveTicketsService",
            ticketId: ticket.id
          }
        });
      }
    }

    logger.info(`CloseInactiveTicketsService: ${closedCount} ticket(s) fechado(s) automaticamente por inatividade (48h)`);
    return closedCount;
  } catch (error: any) {
    logger.error({
      msg: "CloseInactiveTicketsService: Erro crítico ao processar tickets inativos",
      error: error?.message || error
    });
    Sentry.captureException(error, {
      tags: {
        service: "CloseInactiveTicketsService"
      }
    });
    throw error;
  }
};

export default CloseInactiveTicketsService;
