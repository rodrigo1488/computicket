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
  /** @deprecated Ignorado — sempre LM Studio (OpenAI-compat) */
  provider?: "openai";
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
        isDeleted: false
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
    const systemPrompt = `Crie um resumo objetivo da conversa abaixo (máximo 200 palavras).

TICKET: ${ticketData.status} | ${ticketData.contact?.name || "Desconhecido"} | ${ticketData.user?.name || "Sem atendente"} | ${ticketData.queue?.name || "Sem fila"}

MENSAGENS:
${messagesContext}

INSTRUÇÕES: Identifique status da conversa, pontos principais, próximos passos. Seja direto e objetivo. Retorne APENAS o texto do resumo, sem formatação adicional.`;

    // Selecionar provider automaticamente usando a configuração da funcionalidade
    // Se provider foi especificado explicitamente, criar diretamente, senão usar selector
    const { AIProviderFactory } = require("./AIProviderFactory") as {
      AIProviderFactory: typeof import("./AIProviderFactory").AIProviderFactory;
    };
    const selectedProvider = provider
      ? await AIProviderFactory.createOpenAIProvider(companyId)
      : await AIProviderSelector.getProvider(companyId, "summaries");

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
    throw error;
  }
};

export default generateContextSummary;

