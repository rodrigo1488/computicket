import { Op } from "sequelize";
import User from "../../models/User";
import Ticket from "../../models/Ticket";
import UserQueue from "../../models/UserQueue";
import { logger } from "../../utils/logger";

interface FindOnlineAgentParams {
  companyId: number;
  queueId?: number | null;
}

/**
 * Busca um atendente online disponível para transferência
 * Se queueId fornecido, busca apenas atendentes dessa fila
 * Considera carga de trabalho (tickets abertos) para balanceamento
 */
export const findOnlineAgent = async ({
  companyId,
  queueId
}: FindOnlineAgentParams): Promise<User | null> => {
  try {
    logger.info(`Buscando atendente online para empresa ${companyId}${queueId ? ` na fila ${queueId}` : ""}`);

    let users: User[] = [];

    if (queueId) {
      // Buscar usuários que pertencem à fila específica e estão online
      const userQueues = await UserQueue.findAll({
        where: { queueId },
        attributes: ["userId"]
      });

      const userIds = userQueues.map(uq => uq.userId);

      if (userIds.length === 0) {
        logger.info(`Nenhum usuário encontrado na fila ${queueId}`);
        return null;
      }

      // Buscar apenas os usuários que estão na fila e estão online
      users = await User.findAll({
        where: {
          id: { [Op.in]: userIds },
          companyId,
          online: true,
          active: true,
          profile: "user" // Apenas usuários, não admins
        },
        attributes: ["id", "name", "email", "online", "profile", "companyId"]
      });

      logger.info(`Encontrados ${users.length} atendente(s) online na fila ${queueId}`);
    } else {
      // Buscar todos os usuários online da empresa
      users = await User.findAll({
        where: {
          companyId,
          online: true,
          active: true,
          profile: "user" // Apenas usuários, não admins
        },
        attributes: ["id", "name", "email", "online", "profile", "companyId"]
      });

      logger.info(`Encontrados ${users.length} atendente(s) online na empresa ${companyId}`);
    }

    if (users.length === 0) {
      logger.info(`Nenhum atendente online encontrado para empresa ${companyId}${queueId ? ` na fila ${queueId}` : ""}`);
      return null;
    }

    // Calcular carga de trabalho de cada usuário (tickets abertos)
    const usersWithWorkload = await Promise.all(
      users.map(async (user) => {
        const openTicketsCount = await Ticket.count({
          where: {
            userId: user.id,
            status: { [Op.in]: ["open", "pending"] },
            companyId
          }
        });

        return {
          user,
          workload: openTicketsCount
        };
      })
    );

    // Ordenar por carga de trabalho (menor primeiro) e retornar o primeiro
    usersWithWorkload.sort((a, b) => a.workload - b.workload);

    const selectedAgent = usersWithWorkload[0].user;
    logger.info(
      `✅ Atendente online selecionado: ${selectedAgent.name} (ID: ${selectedAgent.id}) com ${usersWithWorkload[0].workload} tickets abertos`
    );

    return selectedAgent;
  } catch (error: any) {
    logger.error(`❌ Erro ao buscar atendente online: ${error.message}`);
    logger.error(error.stack);
    return null;
  }
};

export default findOnlineAgent;

