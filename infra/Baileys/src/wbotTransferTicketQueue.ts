import { Op } from "sequelize";
import TicketTraking from "./models/TicketTraking";
import moment from "moment";
import Ticket from "./models/Ticket";
import Whatsapp from "./models/Whatsapp";
import Queue from "./models/Queue";
import { getIO } from "./libs/socket";
import { logger } from "./utils/logger";
import ShowTicketService from "./services/TicketServices/ShowTicketService";

/** Evita log repetido no mesmo job quando transferQueueId aponta para fila inexistente. */
const invalidTransferConfigLogged = new Set<number>();

export const TransferTicketQueue = async (): Promise<void> => {
  const io = getIO();
  const batchSize = 50; // Processa em lotes de 50 tickets por vez
  let offset = 0;
  let hasMore = true;
  let totalProcessed = 0;
  let totalTransferred = 0;
  let totalSkippedInvalidQueue = 0;

  invalidTransferConfigLogged.clear();

  try {
    while (hasMore) {
      // Buscar tickets em lotes para evitar sobrecarga de memória
      const tickets = await Ticket.findAll({
        where: {
          status: "pending",
          queueId: {
            [Op.is]: null
          },
        },
        limit: batchSize,
        offset: offset,
        attributes: ['id', 'whatsappId', 'companyId', 'status', 'updatedAt'], // Apenas campos necessários
        order: [['updatedAt', 'ASC']]
      });

      if (tickets.length === 0) {
        hasMore = false;
        break;
      }

      // Processar tickets sequencialmente para evitar sobrecarga
      for (const ticket of tickets) {
        try {
          const wpp = await Whatsapp.findOne({
            where: {
              id: ticket.whatsappId
            },
            attributes: ["id", "companyId", "timeToTransfer", "transferQueueId"]
          });

          if (!wpp || !wpp.timeToTransfer || !wpp.transferQueueId || wpp.timeToTransfer == 0) {
            continue;
          }

          let dataLimite = new Date(ticket.updatedAt);
          dataLimite.setMinutes(dataLimite.getMinutes() + wpp.timeToTransfer);

          if (new Date() > dataLimite) {
            const targetQueue = await Queue.findOne({
              where: {
                id: wpp.transferQueueId,
                companyId: ticket.companyId
              },
              attributes: ["id"]
            });

            if (!targetQueue) {
              totalSkippedInvalidQueue++;
              if (!invalidTransferConfigLogged.has(wpp.id)) {
                invalidTransferConfigLogged.add(wpp.id);
                logger.warn(
                  `TransferTicketQueue: conexão WhatsApp ${wpp.id} com transferQueueId=${wpp.transferQueueId} inválido (fila inexistente ou de outra empresa). Ajuste a configuração da conexão.`
                );
              }
              continue;
            }

            await ticket.update({
              queueId: wpp.transferQueueId,
            });

            const ticketTraking = await TicketTraking.findOne({
              where: {
                ticketId: ticket.id
              },
              order: [["createdAt", "DESC"]],
              attributes: ["id", "ticketId", "queuedAt"]
            });

            if (ticketTraking) {
              await ticketTraking.update({
                queuedAt: moment().toDate()
              });
            }

            // Carregar ticket completo apenas quando necessário para emitir via socket
            const currentTicket = await ShowTicketService(ticket.id, ticket.companyId);

            io.to(ticket.status)
              .to("notification")
              .to(ticket.id.toString())
              .emit(`company-${ticket.companyId}-ticket`, {
                action: "update",
                ticket: currentTicket,
                traking: "created ticket 33"
              });

            totalTransferred++;
            logger.info(`Transferencia de ticket automatica ticket id ${ticket.id} para a fila ${wpp.transferQueueId}`);
          }
        } catch (err: any) {
          logger.error(
            `Erro ao processar transferência do ticket ${ticket.id}: ${err?.message || err}`,
            err?.stack
          );
          // Continua com o próximo ticket mesmo se houver erro
        }
        
        totalProcessed++;
      }

      offset += tickets.length;
      
      // Se retornou menos que o batchSize, chegamos ao fim
      if (tickets.length < batchSize) {
        hasMore = false;
      }

      // Pequena pausa entre lotes para dar tempo ao GC
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (totalProcessed > 0) {
      logger.info(
        `[📊] TransferTicketQueue concluído: ${totalProcessed} tickets processados, ${totalTransferred} transferidos` +
          (totalSkippedInvalidQueue > 0
            ? `, ${totalSkippedInvalidQueue} ignorados (fila de destino inválida)`
            : "")
      );
    }
  } catch (err: any) {
    logger.error(`[🚨] Erro crítico em TransferTicketQueue:`, err.message);
    throw err;
  }
}
