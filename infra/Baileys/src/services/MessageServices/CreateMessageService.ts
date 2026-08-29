import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";
import TicketTraking from "../../models/TicketTraking";
import transcribeAndPersistAudioMessage from "../AiServices/TranscribeAndPersistAudioService";

export interface MessageData {
  id: string;
  ticketId: number;
  body: string;
  contactId?: number;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  ack?: number;
  queueId?: number;
  isInternal?: boolean;
  isForwarded?: boolean;
  transcription?: string | null;
  transcriptionStatus?: string | null;
  transcriptionError?: string | null;
  /** Timestamp real do WhatsApp; quando omitido, usa NOW() do banco. */
  createdAt?: Date | string;
}
interface Request {
  messageData: MessageData;
  companyId: number;
}

/** Texto seguro para coluna NOT NULL (ex.: falha de descriptografia em grupo / tipo desconhecido). */
export const normalizeMessageBodyForDb = (
  body: string | null | undefined
): string => {
  if (body != null && String(body).trim() !== "") {
    return String(body);
  }
  return "[Mensagem indisponível — não foi possível ler o conteúdo]";
};

const CreateMessageService = async ({
  messageData,
  companyId
}: Request): Promise<Message> => {
  let retries = 0;
  const maxRetries = 3;
  const payload = {
    ...messageData,
    body: normalizeMessageBodyForDb(messageData.body),
  };

  while (retries < maxRetries) {
    try {
      // Verificar se a mensagem já existia para emitir socket apenas em criação nova
      // (evita dupla emissão quando controller e listener ambos gravam o mesmo id)
      const existedBefore = await Message.findByPk(payload.id, { attributes: ["id"] });

      // Tentar salvar a mensagem no banco
      await Message.upsert({ ...payload, companyId });

      // Buscar a mensagem com relacionamentos mínimos necessários para o emit (otimização de latência)
      const message = await Message.findByPk(payload.id, {
        attributes: { exclude: ["dataJson"] },
        include: [
          {
            model: Contact,
            as: "contact",
            required: false,
            // `contact` aqui é o contato "direto" da mensagem (não do ticket)
            // Mantemos profilePicUrl para compatibilidade de UI.
            attributes: ["id", "name", "number", "isGroup", "profilePicUrl"]
          },
          {
            model: Ticket,
            as: "ticket",
            // Payload mínimo para roteamento/contagem no frontend em tempo real.
            attributes: ["id", "uuid", "status", "queueId", "userId", "contactId", "companyId", "lastMessage", "fromMe", "isGroup", "unreadMessages"],
            include: [
              {
                model: Contact,
                as: "contact",
                required: false,
                // Campos necessários para classificar "grupo" no frontend em tempo real
                attributes: ["id", "name", "number", "isGroup", "profilePicUrl"],
              },
              { model: Queue, as: "queue", required: false, attributes: ["id", "name"] },
              { model: Whatsapp, as: "whatsapp", required: false, attributes: ["name", "type"] }
            ]
          },
          {
            model: Message,
            as: "quotedMsg",
            required: false,
            attributes: [
              "id",
              "body",
              "fromMe",
              "mediaType",
              "mediaUrl",
              "transcription",
              "transcriptionStatus",
              "transcriptionError"
            ],
            include: [{ model: Contact, as: "contact", required: false, attributes: ["id", "name"] }]
          }
        ]
      });

      // Validação crítica: se a mensagem não foi encontrada após upsert, algo está errado
      if (!message) {
        throw new Error(`ERR_CREATING_MESSAGE: Mensagem ${payload.id} não encontrada após upsert`);
      }

      // Sincronizar queueId se necessário (após confirmar que message existe)
      if (message.ticket?.queueId !== null && message.queueId === null) {
        await message.update({ queueId: message.ticket.queueId });
      }

      // Emitir evento Socket.IO apenas quando a mensagem for nova (não existia antes)
      // Evita duplicata no frontend quando controller e listener ambos chamam verifyMessage
      if (!existedBefore) {
        // Se o Ticket vier com `userId` null no payload, inferimos via TicketTraking
        // (finishedAt IS NULL). Isso garante que o frontend consiga distinguir
        // "responsável" vs "pendente" para notificar corretamente.
        const t = (message as any)?.ticket;
        if (t?.id != null && t?.userId == null) {
          const tr = await TicketTraking.findOne({
            where: {
              ticketId: t.id,
              finishedAt: null
            }
          });
          if (tr?.userId != null) {
            t.userId = tr.userId;
          }
        }

        const io = getIO();
        const ticketPayload = {
          ...message.ticket?.toJSON?.(),
          id: message.ticket?.id,
          uuid: message.ticket?.uuid,
          status: message.ticket?.status,
          queueId: message.ticket?.queueId ?? null,
          userId: message.ticket?.userId ?? null,
          unreadMessages: message.ticket?.unreadMessages ?? 0,
          companyId
        };

        io.to(message.ticketId.toString())
          .to(`company-${companyId}-${message.ticket.status}`)
          .to(`company-${companyId}-notification`)
          .to(`queue-${message.ticket.queueId}-${message.ticket.status}`)
          .to(`queue-${message.ticket.queueId}-notification`)
          .emit(`company-${companyId}-appMessage`, {
            action: "create",
            message,
            ticket: ticketPayload,
            contact: message.ticket.contact
          });

        if (payload.mediaType === "audio") {
          const audioMessageId = String(payload.id);
          const audioCompanyId = companyId;
          setTimeout(() => {
            transcribeAndPersistAudioMessage({
              messageId: audioMessageId,
              companyId: audioCompanyId,
              force: false
            }).catch((e: any) => {
              logger.error({
                msg: "CreateMessageService: auto-transcrição de áudio falhou",
                messageId: audioMessageId,
                companyId: audioCompanyId,
                error: e?.message || e
              });
            });
          }, 500);
        }
      }

      return message;
    } catch (error: any) {
      retries++;
      const isLastAttempt = retries >= maxRetries;
      
      logger.error({
        msg: `CreateMessageService: Erro ao salvar mensagem (tentativa ${retries}/${maxRetries})`,
        messageId: payload.id,
        ticketId: payload.ticketId,
        companyId,
        error: error?.message || error,
        stack: error?.stack
      });
      
      Sentry.captureException(error, {
        tags: {
          service: "CreateMessageService",
          messageId: payload.id,
          ticketId: payload.ticketId,
          companyId,
          retry: retries
        }
      });

      if (isLastAttempt) {
        // Na última tentativa, lançar o erro para que o chamador saiba que falhou
        throw new Error(`ERR_CREATING_MESSAGE: Falhou após ${maxRetries} tentativas. Último erro: ${error?.message || error}`);
      }
      
      // Aguardar antes de tentar novamente (backoff exponencial)
      await new Promise(resolve => setTimeout(resolve, Math.min(100 * Math.pow(2, retries - 1), 1000)));
    }
  }
  
  // Nunca deveria chegar aqui, mas TypeScript exige retorno
  throw new Error("ERR_CREATING_MESSAGE: Loop de retry inesperado");
};

export default CreateMessageService;
