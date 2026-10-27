import { Op } from "sequelize";
import Ticket from "../../models/Ticket"
import Whatsapp from "../../models/Whatsapp"
import { getIO } from "../../libs/socket"
import formatBody from "../../helpers/Mustache";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import moment from "moment";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { verifyMessage } from "./wbotMessageListener";
import TicketTraking from "../../models/TicketTraking";
import { isAutoCloseEnabled } from "../../helpers/companyFeatureFlags";
import { shouldCloseForConnectionExpiry } from "../../helpers/helpdeskAutomationGuards";
import { logger } from "../../utils/logger";

export const ClosedAllOpenTickets = async (companyId: number): Promise<void> => {
  if (!(await isAutoCloseEnabled(companyId))) return;

  // @ts-ignore: Unreachable code error
  const closeTicket = async (ticket: any, currentStatus: any, body: any) => {
    if (currentStatus === 'nps') {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else if (currentStatus === 'open') {

      await ticket.update({
        status: "closed",
        //  userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        unreadMessages: 0
      });
    }
  };

  const io = getIO();
  try {

    const { rows: tickets } = await Ticket.findAndCountAll({
      where: { status: { [Op.in]: ["open"] }, companyId },
      order: [["updatedAt", "DESC"]]
    });

    for (const ticket of tickets) {
      try {
      const showTicket = await ShowTicketService(ticket.id, companyId);
      const whatsapp = await Whatsapp.findByPk(showTicket?.whatsappId);
      const ticketTraking = await TicketTraking.findOne({
        where: {
          ticketId: ticket.id,
          finishedAt: null,
        }
      })

      if (!whatsapp || !ticketTraking) continue;

      const {
        expiresInactiveMessage,
        expiresTicket
      } = whatsapp;

      const hours = Number(expiresTicket);
      if (!Number.isFinite(hours) || hours <= 0) continue;

      const shouldClose = shouldCloseForConnectionExpiry({
        status: showTicket.status,
        isGroup: showTicket.isGroup,
        fromMe: showTicket.fromMe,
        queueId: showTicket.queueId,
        userId: showTicket.userId,
        chatbot: showTicket.chatbot,
        flowWebhook: showTicket.flowWebhook,
        useIntegration: showTicket.useIntegration,
        updatedAt: new Date(showTicket.updatedAt),
        expiresTicketHours: hours,
        now: new Date()
      });
      if (!shouldClose) continue;

      const bodyExpiresMessageInactive = formatBody(`\u200e ${expiresInactiveMessage}`, showTicket.contact);

      if (expiresInactiveMessage !== "" && expiresInactiveMessage !== undefined) {
        const sentMessage = await SendWhatsAppMessage({ body: bodyExpiresMessageInactive, ticket: showTicket });
        await verifyMessage(sentMessage, showTicket, showTicket.contact);
      }

      await closeTicket(showTicket, showTicket.status, bodyExpiresMessageInactive);

      await ticketTraking.update({
        finishedAt: moment().toDate(),
        closedAt: moment().toDate(),
        whatsappId: ticket.whatsappId,
        userId: ticket.userId,
      })

      io.to("open").emit(`company-${companyId}-ticket`, {
        action: "delete",
        ticketId: showTicket.id
      });
      } catch (err: any) {
        logger.warn({
          msg: "ClosedAllOpenTickets: falha ao processar ticket",
          ticketId: ticket.id,
          companyId,
          error: err?.message || err
        });
      }
    }

  } catch (e: any) {
    console.log('e', e)
  }

}
