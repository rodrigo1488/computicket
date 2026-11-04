import { Op } from "sequelize";
import AiIdleAlert from "../../models/AiIdleAlert";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Prompt from "../../models/Prompt";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { getWbot } from "../../libs/wbot";
import { toWhatsAppGroupJid } from "../../helpers/chatJid";
import { logger } from "../../utils/logger";
import { AIProviderSelector } from "./AIProviderSelector";
import { decideIdleAlert, signAgentMessage } from "./aiAgentActions";

const summarizeWait = async (
  prompt: Prompt,
  contactName: string,
  minutes: number,
  lastBody: string
): Promise<string> => {
  const fallback =
    `Alerta do agente ${prompt.name}\n` +
    `Conversa sem resposta há ${minutes} min.\n` +
    `Cliente: ${contactName}\n` +
    `Última mensagem: ${lastBody.slice(0, 500)}`;
  try {
    const provider = await AIProviderSelector.getProvider(
      prompt.companyId,
      "summaries",
      prompt.provider
    );
    const text = await provider.chat(
      [
        {
          role: "system",
          content:
            "Resuma em português do Brasil, em até 4 linhas, uma conversa de WhatsApp parada. Diga o nome do cliente, o que ele pediu e há quanto tempo espera. Sem saudação."
        },
        {
          role: "user",
          content: `Agente: ${prompt.name}\nCliente: ${contactName}\nEspera: ${minutes} min\nÚltima mensagem: ${lastBody.slice(0, 1500)}`
        }
      ],
      { maxTokens: 180, temperature: 0.2 }
    );
    const summary = String(text || "").trim();
    return summary ? `Alerta do agente ${prompt.name}\n${summary}` : fallback;
  } catch (err: any) {
    logger.warn(`AlertStaleConversations: resumo indisponível (${err.message})`);
    return fallback;
  }
};

const AlertStaleConversationsService = async (): Promise<void> => {
  const prompts = await Prompt.findAll({ where: { idleAlertEnabled: true } });
  const now = new Date();

  for (const prompt of prompts) {
    if (!prompt.idleAlertGroupJid) continue;
    const queues = await Queue.findAll({
      where: { promptId: prompt.id, companyId: prompt.companyId },
      attributes: ["id"]
    });
    const queueIds = queues.map(queue => queue.id);
    if (prompt.queueId && !queueIds.includes(prompt.queueId)) {
      queueIds.push(prompt.queueId);
    }
    const connections = await Whatsapp.findAll({
      where: { promptId: prompt.id, companyId: prompt.companyId },
      attributes: ["id"]
    });
    const whatsappIds = connections.map(item => item.id);
    const scopes: any[] = [];
    if (queueIds.length) scopes.push({ queueId: { [Op.in]: queueIds } });
    if (whatsappIds.length) scopes.push({ whatsappId: { [Op.in]: whatsappIds } });
    if (!scopes.length) continue;

    const tickets = await Ticket.findAll({
      where: {
        companyId: prompt.companyId,
        [Op.or]: scopes,
        status: "pending",
        userId: { [Op.is]: null },
        isGroup: false
      },
      include: [{ model: Contact, as: "contact", attributes: ["id", "name", "number", "isSupport"] }]
    });

    for (const ticket of tickets) {
      if (!ticket.whatsappId || ticket.contact?.isSupport) continue;
      const last = await Message.findOne({
        where: {
          ticketId: ticket.id,
          [Op.or]: [{ isInternal: false }, { isInternal: null }]
        },
        order: [["createdAt", "DESC"]]
      });
      if (!last?.id) continue;
      const already = await AiIdleAlert.findOne({
        where: { ticketId: ticket.id, messageId: last.id }
      });
      const shouldSend = decideIdleAlert({
        enabled: true,
        groupJid: prompt.idleAlertGroupJid,
        idleMinutes: prompt.idleAlertMinutes || 30,
        lastFromMe: !!last.fromMe,
        lastMessageAt: last.createdAt ? new Date(last.createdAt) : null,
        now,
        alreadyAlerted: !!already,
        status: ticket.status
      });
      if (!shouldSend) continue;

      const minutes = Math.max(
        1,
        Math.round((now.getTime() - new Date(last.createdAt).getTime()) / 60000)
      );
      const contactName = ticket.contact?.name || "Cliente";
      const summary = await summarizeWait(prompt, contactName, minutes, last.body || "");
      const body = signAgentMessage(summary, prompt.name);
      try {
        const wbot = getWbot(ticket.whatsappId);
        await wbot.sendMessage(toWhatsAppGroupJid(prompt.idleAlertGroupJid), { text: body });
        await AiIdleAlert.create({
          ticketId: ticket.id,
          messageId: last.id,
          companyId: prompt.companyId
        });
        logger.info(`Alerta de silêncio enviado para o ticket ${ticket.id}`);
      } catch (err: any) {
        logger.error(`AlertStaleConversations: falha no ticket ${ticket.id}: ${err.message}`);
      }
    }
  }
};

export default AlertStaleConversationsService;
