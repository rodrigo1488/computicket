import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { openChatNoticeReachesAll, selectOpenChats, signAgentMessage } from "./aiAgentActions";

const MAX_OPEN_CHATS = 40;

const sendTicketText = async (ticket: Ticket, body: string): Promise<void> => {
  const sent = await SendWhatsAppMessage({ body, ticket });
  const id = sent?.key?.id ? String(sent.key.id) : "";
  if (!id) return;
  await CreateMessageService({
    messageData: {
      id,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body,
      fromMe: true,
      read: true,
      mediaType: "conversation"
    },
    companyId: ticket.companyId
  });
};

/** Envia o texto pedido pelo grupo para chats pending/open desta conexão. */
export async function deliverOpenChatNotice(input: {
  companyId: number;
  whatsappId: number;
  target: string;
  text: string;
  agentName?: string | null;
}): Promise<string> {
  const body = signAgentMessage(input.text, input.agentName);
  if (!body) return "A mensagem para os chats abertos ficou vazia.";
  const tickets = await Ticket.findAll({
    where: {
      companyId: input.companyId,
      whatsappId: input.whatsappId,
      isGroup: false,
      status: { [Op.in]: ["open", "pending"] },
      [Op.or]: [{ isSupport: false }, { isSupport: null }]
    },
    include: [
      {
        model: Contact,
        as: "contact",
        required: true,
        where: { isGroup: false },
        attributes: ["id", "name", "number", "isGroup"]
      }
    ],
    limit: 200
  });
  const selection = selectOpenChats(
    tickets.map(ticket => ({
      ticket,
      name: ticket.contact?.name,
      number: ticket.contact?.number
    })),
    input.target
  );
  if (selection.ambiguous) {
    return `Encontrei mais de um chat aberto parecido com ${input.target}. Pode repetir o nome completo?`;
  }
  if (!selection.matches.length) {
    return openChatNoticeReachesAll(input.target)
      ? "Não há chats abertos para avisar."
      : `Não encontrei um chat aberto de ${input.target}.`;
  }
  const chosen = selection.matches.slice(0, MAX_OPEN_CHATS);
  let sent = 0;
  let failed = 0;
  for (const row of chosen) {
    try {
      await sendTicketText(row.ticket, body);
      sent += 1;
    } catch (err: any) {
      failed += 1;
      logger.warn(`Aviso em chat aberto ${row.ticket.id}: ${err?.message || err}`);
    }
  }
  if (!sent) return "Não consegui enviar a mensagem para os chats abertos.";
  const truncated = selection.matches.length > chosen.length
    ? ` Enviei para ${sent} de ${selection.matches.length}.`
    : "";
  const failures = failed ? ` ${failed} não receberam.` : "";
  if (sent === 1) {
    const name = chosen[0].name || input.target;
    return `Enviei a mensagem para o chat de ${name}.${failures}`;
  }
  return `Enviei a mensagem para ${sent} chats abertos.${truncated}${failures}`;
}
