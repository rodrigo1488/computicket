import { Op } from "sequelize";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import ShowTicketService from "../TicketServices/ShowTicketService";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AIProviderSelector } from "./AIProviderSelector";

interface GenerateContextSummaryParams {
  ticketId: number;
  companyId: number;
  provider?: string;
  maxMessages?: number;
}

const formatDateTime = (date: Date | string): string => {
  try {
    return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return new Date(date).toLocaleString("pt-BR");
  }
};

/**
 * Gera um resumo objetivo do contexto da conversa para transferência
 */
export const generateContextSummary = async ({
  ticketId,
  companyId,
  provider,
  maxMessages = 12 // Reduzido de 20 para 12 para economizar tokens
}: GenerateContextSummaryParams): Promise<string> => {
  try {
    const ticket = await ShowTicketService(ticketId, companyId);
    if (!ticket) {
      throw new AppError("Ticket não encontrado", 404);
    }

    // Buscar informações do ticket
    const ticketData = await Ticket.findByPk(ticketId, {
      include: [
        { model: Contact, attributes: ["id", "name", "number"] },
        { model: User, attributes: ["id", "name"], required: false },
        { model: Queue, attributes: ["id", "name"], required: false }
      ]
    });

    // Buscar últimas mensagens
    const messages = await Message.findAll({
      where: {
        ticketId,
        companyId,
        isDeleted: false,
        [Op.or]: [{ isInternal: false }, { isInternal: null }]
      },
      include: [
        { model: Contact, attributes: ["id", "name"] }
      ],
      order: [["createdAt", "DESC"]],
      limit: maxMessages
    });

    if (messages.length === 0) {
      return "Nenhuma mensagem encontrada no ticket.";
    }

    // Construir contexto das mensagens (do mais antigo para o mais recente) - limitado para economizar tokens
    const messagesContext = messages
      .reverse()
      .map((msg) => {
        const timestamp = formatDateTime(msg.createdAt);
        const sender = msg.fromMe ? "ATENDENTE" : "CLIENTE";
        const body = (msg.body || "[Mídia]").slice(0, 200); // Limitar a 200 caracteres
        return `[${timestamp}] ${sender}: ${body}`;
      })
      .join("\n");

    // Construir prompt para resumo (simplificado para economizar tokens)
    const systemPrompt = `Resuma a situação atual deste atendimento para quem vai continuar a conversa (máximo 120 palavras).

CLIENTE: ${ticketData.contact?.name || "Desconhecido"}

MENSAGENS:
${messagesContext}

Diga o que o cliente precisa, o que já foi respondido e o que falta resolver. Retorne só o texto do resumo.`;

    const selectedProvider = await AIProviderSelector.getProvider(
      companyId,
      "summaries",
      provider
    );

    // Gerar resumo usando o provider selecionado
    const summary = await selectedProvider.generateText(systemPrompt, {
      temperature: 0.3,
      maxTokens: 1024,
      topP: 0.95
    });

    if (!summary || summary.trim() === "") {
      throw new AppError("Resumo vazio retornado pela IA", 500);
    }

    logger.info(`Resumo gerado com sucesso para ticket ${ticketId} usando ${selectedProvider.name} (${summary.length} caracteres)`);
    return summary.trim();
  } catch (error: any) {
    logger.error(`Erro ao gerar resumo do contexto: ${error.message}`);
    return fallbackTransferSummary(ticketId, companyId);
  }
};

const fallbackTransferSummary = async (ticketId: number, companyId: number): Promise<string> => {
  const messages = await Message.findAll({
    where: {
      ticketId,
      companyId,
      isDeleted: false,
      [Op.or]: [{ isInternal: false }, { isInternal: null }]
    },
    order: [["createdAt", "DESC"]],
    limit: 8
  });
  const lines = messages
    .reverse()
    .map(message => {
      const who = message.fromMe ? "Atendente" : "Cliente";
      const body = (message.body || "").replace(/\s+/g, " ").trim().slice(0, 180);
      return body ? `${who}: ${body}` : "";
    })
    .filter(Boolean);
  return lines.join("\n") || "Sem mensagens anteriores nesta conversa.";
};

export default generateContextSummary;

