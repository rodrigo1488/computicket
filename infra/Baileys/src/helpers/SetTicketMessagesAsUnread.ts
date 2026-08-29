import { getIO } from "../libs/socket";
import Ticket from "../models/Ticket";

const SetTicketMessagesAsUnread = async (ticket: Ticket): Promise<void> => {
  await ticket.update({ unreadMessages: Math.max(1, (ticket.unreadMessages || 0) + 1) });
  const updatedTicket = await ticket.reload();

  const io = getIO();
  io.to(`company-${ticket.companyId}-mainchannel`)
    .to(`company-${ticket.companyId}-notification`)
    .to(ticket.status)
    .to(`queue-${ticket.queueId}-${ticket.status}`)
    .emit(`company-${ticket.companyId}-ticket`, {
      action: "update",
      ticket: updatedTicket
    });
};

export default SetTicketMessagesAsUnread;
