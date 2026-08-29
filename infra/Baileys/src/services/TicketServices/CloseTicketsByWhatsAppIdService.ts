import { Op } from "sequelize";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

/**
 * Atualiza para status "closed" todos os tickets (chats) que pertencem à conexão WhatsApp informada.
 * Deve ser chamado quando uma conexão é desconectada ou excluída, para que as conversas não fiquem travadas.
 */
const CloseTicketsByWhatsAppIdService = async (
  whatsappId: number
): Promise<number> => {
  const openTickets = await Ticket.findAll({
    where: {
      whatsappId,
      status: { [Op.ne]: "closed" }
    },
    attributes: ["id", "companyId", "status"]
  });

  const idsToNotify = openTickets.map(t => t.id);
  const [affectedCount] = await Ticket.update(
    { status: "closed" },
    {
      where: {
        whatsappId,
        status: { [Op.ne]: "closed" }
      }
    }
  );

  if (affectedCount > 0) {
    logger.info(
      `CloseTicketsByWhatsAppId: ${affectedCount} ticket(s) fechado(s) para conexão whatsappId=${whatsappId}`
    );

    const tickets = await Ticket.findAll({
      where: { id: { [Op.in]: idsToNotify } },
      include: [
        { model: Contact, as: "contact", attributes: ["id", "name", "number", "email", "profilePicUrl"] },
        { model: User, as: "user", attributes: ["id", "name"] },
        { model: Queue, as: "queue", attributes: ["id", "name", "color"] },
        { model: Whatsapp, as: "whatsapp", attributes: ["name"] }
      ]
    });

    const io = getIO();
    const statusByTicketId = new Map(openTickets.map(t => [t.id, t.status]));
    for (const ticket of tickets) {
      const oldStatus = statusByTicketId.get(ticket.id) || "pending";
      io.to(oldStatus).emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticketId: ticket.id
      });
      io.to("closed").emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket
      });
    }
  }

  return affectedCount;
};

export default CloseTicketsByWhatsAppIdService;
