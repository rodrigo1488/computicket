import { getLmStudioDefaultModel } from "../../config/openai";
import {
  createStaffAppointments,
  findTechnicianByPhone,
  loadAgentContext
} from "../../helpers/computicketAgentApi";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { AIProviderSelector } from "./AIProviderSelector";
import {
  completionTokenBudget,
  looksLikeAppointmentRequest,
  parseAgendaCommands,
  sanitizeCustomerReply,
  signAgentMessage,
  staffAppointmentInstructions
} from "./aiAgentActions";

const PENDING_MS = 15 * 60 * 1000;
const pendingUntil = new Map<string, number>();
const handledMessages = new Set<string>();

const rememberHandled = (messageId: string): void => {
  if (!messageId) return;
  handledMessages.add(messageId);
  if (handledMessages.size <= 200) return;
  const oldest = handledMessages.values().next().value;
  if (oldest) handledMessages.delete(oldest);
};

const replyOnTicket = async (ticket: Ticket, contact: Contact, text: string): Promise<void> => {
  const body = (text || "").trim();
  if (!body) return;
  if (!ticket.contact) ticket.contact = contact;
  const sent = await SendWhatsAppMessage({ body, ticket });
  const id = sent?.key?.id ? String(sent.key.id) : "";
  if (!id) return;
  await CreateMessageService({
    messageData: {
      id,
      ticketId: ticket.id,
      body,
      fromMe: true,
      read: true,
      mediaType: "conversation"
    },
    companyId: ticket.companyId
  });
};

/**
 * Cria visita quando o WhatsApp de um técnico pede agendamento.
 * Retorna true só quando a mensagem foi tratada e o bot de cliente deve parar.
 */
export async function handleTechnicianAppointmentRequest(input: {
  ticket: Ticket;
  contact: Contact;
  body: string;
  messageId: string;
}): Promise<boolean> {
  const key = `${input.ticket.companyId}:${input.contact.id}`;
  const followUp = (pendingUntil.get(key) || 0) > Date.now();
  if (!followUp && !looksLikeAppointmentRequest(input.body)) return false;
  if (input.messageId && handledMessages.has(input.messageId)) return true;
  if (!input.ticket.whatsappId) return false;

  let whatsapp;
  try {
    whatsapp = await ShowWhatsAppService(input.ticket.whatsappId, input.ticket.companyId);
  } catch (err: any) {
    logger.warn(`Agendamento do técnico: conexão indisponível (${err?.message || err})`);
    return false;
  }
  const prompt = whatsapp.prompt;
  if (!prompt?.permitirCriarAgendamentos) return false;

  const technician = await findTechnicianByPhone(input.contact.number || "");
  if (!technician) return false;

  let text = "";
  try {
    const context = await loadAgentContext(prompt, input.body, "");
    const provider = await AIProviderSelector.getProvider(
      input.ticket.companyId,
      "chat",
      prompt.provider
    );
    const messages = [
      {
        role: "system" as const,
        content: staffAppointmentInstructions(
          (context.technicians || []).map(person => person.name || ""),
          technician.name
        )
      },
      { role: "user" as const, content: input.body }
    ];
    const response = await provider.chat(messages as any, {
      model: prompt.model || getLmStudioDefaultModel(),
      maxTokens: completionTokenBudget(prompt.provider, prompt.maxTokens, messages),
      temperature: prompt.temperature
    });
    const raw = typeof response === "string" ? response : "";
    const commands = parseAgendaCommands(raw);
    if (commands.length) {
      const results = await createStaffAppointments(commands, {
        userId: technician.id,
        name: technician.name
      });
      text = results.filter(Boolean).join("\n");
      const failed = results.some(line => /não encontrei|não consegui|inválid/i.test(line));
      if (failed) pendingUntil.set(key, Date.now() + PENDING_MS);
      else pendingUntil.delete(key);
    } else {
      pendingUntil.set(key, Date.now() + PENDING_MS);
      text = sanitizeCustomerReply(raw) || "Me diga o cliente, o dia e o horário.";
    }
    const signed = signAgentMessage(text, prompt.name);
    if (signed) await replyOnTicket(input.ticket, input.contact, signed);
  } catch (err: any) {
    logger.warn(`Agendamento pelo número do técnico falhou: ${err?.message || err}`);
    pendingUntil.set(key, Date.now() + PENDING_MS);
    if (!text) {
      text = "Não consegui criar o agendamento agora. Pode repetir o cliente, a data e o horário?";
    }
    try {
      await replyOnTicket(input.ticket, input.contact, signAgentMessage(text, prompt.name));
    } catch (sendErr: any) {
      logger.warn(`Resposta ao técnico não enviada: ${sendErr?.message || sendErr}`);
    }
  }
  if (input.messageId) rememberHandled(input.messageId);
  return true;
}
