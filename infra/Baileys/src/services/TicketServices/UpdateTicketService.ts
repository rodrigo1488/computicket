import moment from "moment";
import * as Sentry from "@sentry/node";
import CheckContactOpenTickets from "../../helpers/CheckContactOpenTickets";
import SetTicketMessagesAsRead from "../../helpers/SetTicketMessagesAsRead";
import { getIO } from "../../libs/socket";
import Ticket from "../../models/Ticket";
import Setting from "../../models/Setting";
import Queue from "../../models/Queue";
import ShowTicketService from "./ShowTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import { verifyMessage, getChatJid } from "../WbotServices/wbotMessageListener";
import ListSettingsServiceOne from "../SettingServices/ListSettingsServiceOne"; //NOVO PLW DESIGN//
import ShowUserService from "../UserServices/ShowUserService"; //NOVO PLW DESIGN//
import { isNil } from "lodash";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import Company from "../../models/Company";
import { logger } from "../../utils/logger";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

interface TicketData {
  status?: string;
  userId?: number | null;
  queueId?: number | null;
  chatbot?: boolean;
  queueOptionId?: number;
  whatsappId?: string;
  useIntegration?: boolean;
  integrationId?: number | null;
  promptId?: number | null;
}

interface Request {
  ticketData: TicketData;
  ticketId: string | number;
  companyId: number;
  actionUserId?: string | null;
}

interface Response {
  ticket: Ticket;
  oldStatus: string;
  oldUserId: number | undefined;
}

const UpdateTicketService = async ({
  ticketData,
  ticketId,
  companyId,
  actionUserId = null
}: Request): Promise<Response> => {

  try {
    let { status } = ticketData;
    let { queueId, userId, whatsappId } = ticketData;
    let chatbot: boolean | null = ticketData.chatbot || false;
    let queueOptionId: number | null = ticketData.queueOptionId || null;
    let promptId: number | null = ticketData.promptId || null;
    let useIntegration: boolean | null = ticketData.useIntegration || false;
    let integrationId: number | null = ticketData.integrationId || null;

    const io = getIO();

    const key = "userRating";
    const setting = await Setting.findOne({
      where: {
        companyId,
        key
      }
    });

    const ticket = await ShowTicketService(ticketId, companyId);
    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId,
      companyId,
      whatsappId: ticket.whatsappId
    });

    if (isNil(whatsappId)) {
      if (ticket.whatsappId !== null && ticket.whatsappId !== undefined) {
        whatsappId = ticket.whatsappId.toString();
      } else {
        // Quando a conexão foi encerrada, whatsappId pode ser null
        // Permitimos a atualização do ticket mesmo sem whatsappId
        whatsappId = null;
      }
    }

    await SetTicketMessagesAsRead(ticket);

    const oldStatus = ticket.status;
    const oldUserId = ticket.user?.id;
    const oldQueueId = ticket.queueId;

    const shouldResetSessionStart =
      oldStatus === "closed" ||
      (whatsappId !== null && whatsappId !== undefined && Number(whatsappId) !== ticket.whatsappId);

    if (shouldResetSessionStart) {
      // let otherTicket = await Ticket.findOne({
      //   where: {
      //     contactId: ticket.contactId,
      //     status: { [Op.or]: ["open", "pending", "group"] },
      //     whatsappId
      //   }
      // });
      // if (otherTicket) {
      //     otherTicket = await ShowTicketService(otherTicket.id, companyId)

      //     await ticket.update({status: "closed"})

      //     io.to(oldStatus).emit(`company-${companyId}-ticket`, {
      //       action: "delete",
      //       ticketId: ticket.id
      //     });

      //     return { ticket: otherTicket, oldStatus, oldUserId }
      // }
      await CheckContactOpenTickets(ticket.contact.id, companyId, whatsappId || undefined);
      chatbot = null;
      queueOptionId = null;
    }

    // Entrada no modo de avaliação: envia instrução e move ticket para status "rating".
    if (status !== undefined && status === "rating" && oldStatus !== "rating") {
      if (setting?.value !== "enabled") {
        // Sem avaliação habilitada, resolver fecha direto para não deixar ticket preso em rating.
        status = "closed";
      }
    }

    if (status !== undefined && status === "rating" && oldStatus !== "rating") {
      // Só tentar obter configurações do WhatsApp se a conexão ainda existir
      let ratingMessage: string | null = null;
      if (ticket.whatsappId !== null && ticket.whatsappId !== undefined) {
        try {
          const whatsappService = await ShowWhatsAppService(
            ticket.whatsappId,
            companyId
          );
          ratingMessage = whatsappService.ratingMessage;
        } catch (err) {
          // Se a conexão foi encerrada, continuar sem mensagens de avaliação
        }
      }

      if (setting?.value === "enabled") {
        if (ticketTraking.ratingAt == null) {
          // Atualizar status para "rating" ANTES de enviar a mensagem para evitar
          // race condition: o eco da mensagem chegaria com o ticket ainda em "open"/"pending"
          // e FindOrCreateTicketService o reabriria indevidamente.
          await ticket.update({ status: "rating" });

          const ratingTxt = ratingMessage || "";
          let bodyRatingMessage = `\u200e${ratingTxt}\n\n`;
          bodyRatingMessage +=
            "Digite de 1 à 3 para qualificar nosso atendimento:\n*1* - _Insatisfeito_\n*2* - _Satisfeito_\n*3* - _Muito Satisfeito_\n\n";
          try {
            await SendWhatsAppMessage({ body: bodyRatingMessage, ticket });
          } catch (msgErr) {
            logger.warn(`UpdateTicketService: Não foi possível enviar mensagem de avaliação para o ticket ${ticketId} (conexão indisponível):`, msgErr);
          }

          await ticketTraking.update({
            ratingAt: moment().toDate(),
            userId: actionUserId
          });
        }
        ticketTraking.ratingAt = moment().toDate();
        ticketTraking.rated = false;
      }
    }

    // Fechamento definitivo (ex.: rejeição manual ou outros fluxos diretos para closed).
    if (status !== undefined && status === "closed" && oldStatus !== "closed") {
      let complationMessage: string | null = null;
      if (ticket.whatsappId !== null && ticket.whatsappId !== undefined) {
        try {
          const whatsappService = await ShowWhatsAppService(
            ticket.whatsappId,
            companyId
          );
          complationMessage = whatsappService.complationMessage;
        } catch (err) {
          // Se a conexão foi encerrada, continuar sem mensagens de conclusão
        }
      }

      // Atualizar status para "closed" ANTES de enviar a mensagem de conclusão para evitar
      // race condition: o eco da complationMessage chegaria com o ticket ainda em status anterior
      // e FindOrCreateTicketService o reabriria indevidamente.
      await ticket.update({
        status: "closed",
        promptId: null,
        integrationId: null,
        useIntegration: false,
        typebotStatus: false,
        typebotSessionId: null
      });

      if (!isNil(complationMessage) && complationMessage !== "") {
        const body = `\u200e${complationMessage}`;
        try {
          await SendWhatsAppMessage({ body, ticket });
        } catch (msgErr) {
          logger.warn(`UpdateTicketService: Não foi possível enviar mensagem de conclusão para o ticket ${ticketId} (conexão indisponível):`, msgErr);
        }
      }

      ticketTraking.finishedAt = moment().toDate();
      ticketTraking.whatsappId = ticket.whatsappId;
      ticketTraking.userId = ticket.userId;

      /*    queueId = null;
            userId = null; */
    }

    if (queueId !== undefined && queueId !== null) {
      ticketTraking.queuedAt = moment().toDate();
    }

    const settingsTransfTicket = await ListSettingsServiceOne({ companyId: companyId, key: "sendMsgTransfTicket" });

    if (settingsTransfTicket?.value === "enabled") {
      const companyLangRow = await Company.findByPk(companyId, { attributes: ["language"] });
      const language = companyLangRow?.language || "pt";

      const resolveAgentName = async (targetUserId: number | null | undefined): Promise<string> => {
        if (isNil(targetUserId)) return "Atendente";
        try {
          const agent = await ShowUserService(targetUserId);
          return agent.name || "Atendente";
        } catch {
          return "Atendente";
        }
      };

      const sendTransferMessage = async (textByLang: Record<string, string>): Promise<void> => {
        try {
          const wbot = await GetTicketWbot(ticket);
          if (!wbot) {
            logger.info(`Ticket ${ticket.id} é Instagram ou sem sessão Baileys. Pulando mensagem automática de transferência.`);
            return;
          }
          const text = textByLang[language] || textByLang.pt;
          const queueChangedMessage = await wbot.sendMessage(getChatJid(ticket), { text });
          await verifyMessage(queueChangedMessage, ticket, ticket.contact);
        } catch (msgErr) {
          logger.warn(`UpdateTicketService: Não foi possível enviar mensagem de transferência para o ticket ${ticketId}:`, msgErr);
        }
      };

      // Mensagem de transferencia da FILA
      if (oldQueueId !== queueId && oldUserId === userId && !isNil(oldQueueId) && !isNil(queueId)) {
        const queue = await Queue.findByPk(queueId);
        await sendTransferMessage({
          pt: "*Mensagem automática*:\nVocê foi transferido para o departamento *" + queue?.name + "*\naguarde, já vamos te atender!",
          en: "*Automatic message*:\nYou have been transferred to the *" + queue?.name + "* department\nplease wait, we'll assist you soon!",
          es: "*Mensaje automático*:\nHas sido transferido al departamento *" + queue?.name + "*\npor favor espera, ¡te atenderemos pronto!"
        });
      } else if (oldUserId !== userId && oldQueueId === queueId && !isNil(oldUserId) && !isNil(userId)) {
        const agentName = await resolveAgentName(userId);
        await sendTransferMessage({
          pt: "*Mensagem automática*:\nFoi transferido para o atendente *" + agentName + "*\naguarde, já vamos te atender!",
          en: "*Automatic message*:\nYou have been transferred to agent *" + agentName + "*\nplease wait, we'll assist you soon!",
          es: "*Mensaje automático*:\nHas sido transferido al agente *" + agentName + "*\npor favor espera, ¡te atenderemos pronto!"
        });
      } else if (oldUserId !== userId && !isNil(oldUserId) && !isNil(userId) && oldQueueId !== queueId && !isNil(oldQueueId) && !isNil(queueId)) {
        const queue = await Queue.findByPk(queueId);
        const agentName = await resolveAgentName(userId);
        await sendTransferMessage({
          pt: "*Mensagem automática*:\nVocê foi transferido para o departamento *" + queue?.name + "* e contará com a presença de *" + agentName + "*\naguarde, já vamos te atender!",
          en: "*Automatic message*:\nYou have been transferred to the *" + queue?.name + "* department and will be assisted by *" + agentName + "*\nplease wait, we'll assist you soon!",
          es: "*Mensaje automático*:\nHas sido transferido al departamento *" + queue?.name + "* y serás atendido por *" + agentName + "*\npor favor espera, ¡te atenderemos pronto!"
        });
      } else if (oldUserId !== undefined && isNil(userId) && oldQueueId !== queueId && !isNil(queueId)) {
        const queue = await Queue.findByPk(queueId);
        await sendTransferMessage({
          pt: "*Mensagem automática*:\nVocê foi transferido para o departamento *" + queue?.name + "*\naguarde, já vamos te atender!",
          en: "*Automatic message*:\nYou have been transferred to the *" + queue?.name + "* department\nplease wait, we'll assist you soon!",
          es: "*Mensaje automático*:\nHas sido transferido al departamento *" + queue?.name + "*\npor favor espera, ¡te atenderemos pronto!"
        });
      }
    }

    await ticket.update({
      status,
      queueId,
      userId,
      whatsappId: whatsappId !== null ? whatsappId : undefined,
      chatbot,
      queueOptionId,
      // Só grava ao reabrir/trocar canal — evita UPDATE com coluna inexistente antes da migration
      ...(shouldResetSessionStart ? { sessionStartedAt: new Date() } : {})
    });

    await ticket.reload();

    if (status !== undefined && ["pending"].indexOf(status) > -1) {
      ticketTraking.update({
        whatsappId: whatsappId !== null ? whatsappId : ticket.whatsappId,
        queuedAt: moment().toDate(),
        startedAt: null,
        userId: null
      });
    }

    if (status !== undefined && ["open"].indexOf(status) > -1) {
      ticketTraking.update({
        startedAt: moment().toDate(),
        ratingAt: null,
        rated: false,
        whatsappId: whatsappId !== null ? whatsappId : ticket.whatsappId,
        userId: ticket.userId
      });
    }

    await ticketTraking.save();

    if (ticket.status !== oldStatus || ticket.user?.id !== oldUserId) {

      io.to(`company-${companyId}-${oldStatus}`)
        .to(`queue-${oldQueueId}-${oldStatus}`)
        .to(`user-${oldUserId}`)
        .emit(`company-${companyId}-ticket`, {
          action: "delete",
          ticketId: ticket.id
        });
    }

    const ticketPayload = {
      ...ticket.toJSON(),
      id: ticket.id,
      uuid: ticket.uuid,
      status: ticket.status,
      queueId: ticket.queueId ?? null,
      userId: ticket.userId ?? null,
      unreadMessages: ticket.unreadMessages ?? 0,
      companyId
    };

    io.to(`company-${companyId}-${ticket.status}`)
      .to(`company-${companyId}-notification`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-notification`)
      .to(ticketId.toString())
      .to(`user-${ticket?.userId}`)
      .to(`user-${oldUserId}`)
      .emit(`company-${companyId}-ticket`, {
        action: "update",
        ticket: ticketPayload
      });

    void CacheInvalidationService.onTicketChanged(companyId, ticket.id);

    return { ticket, oldStatus, oldUserId };
  } catch (err) {
    Sentry.captureException(err);
    logger.error("UpdateTicketService error:", err);
    throw err;
  }
};

export default UpdateTicketService;
