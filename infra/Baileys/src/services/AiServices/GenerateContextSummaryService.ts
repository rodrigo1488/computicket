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
import { formatTransferNote } from "./aiAgentActions";

interface GenerateContextSummaryParams {
  ticketId: number;
  companyId: number;
  provider?: string;
  maxMessages?: number;
  destination?: string;
  evidence?: string;
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
  maxMessages = 40,
  destination,
  evidence
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
        const body = (msg.body || "[Mídia]").replace(/\s+/g, " ").trim().slice(0, 500);
        return `[${timestamp}] ${sender}: ${body}`;
      })
      .join("\n");

    const cliente = ticketData?.contact?.name || "Não informado";
    const fontes = (evidence || "").trim() || "(nenhuma)";
    const systemPrompt = `Preencha o encaminhamento somente com fatos das mensagens e das fontes. Se um campo não aparecer, use "Não informado". Não invente.

CLIENTE CONHECIDO: ${cliente}
SETOR JÁ DEFINIDO: ${destination || "Não informado"}

FONTES:
${fontes}

MENSAGENS:
${messagesContext}

solucao: preencha só se as fontes ou as mensagens já trouxerem um jeito concreto de resolver. Se não houver, deixe vazio. Não invente procedimento.

Retorne apenas este JSON:
{"cliente":"","sistema":"","problema":"","erros":"","resumo":"","motivo":"","solucao":""}`;

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
    return formatTransferNote({
      ...parseTransferJson(summary, cliente),
      setor: destination || "Não informado"
    });
  } catch (error: any) {
    logger.error(`Erro ao gerar resumo do contexto: ${error.message}`);
    return fallbackTransferSummary(ticketId, companyId, destination);
  }
};

const parseTransferJson = (
  raw: string,
  cliente: string
): { cliente: string; sistema: string; problema: string; erros: string; resumo: string; motivo: string; solucao: string } => {
  const match = (raw || "").match(/\{[\s\S]*\}/);
  const empty = {
    cliente,
    sistema: "Não informado",
    problema: "Não informado",
    erros: "Não informado",
    resumo: (raw || "").trim() || "Não informado",
    motivo: "Não informado",
    solucao: ""
  };
  if (!match) return empty;
  try {
    const data = JSON.parse(match[0]);
    return {
      cliente: String(data.cliente || cliente),
      sistema: String(data.sistema || ""),
      problema: String(data.problema || ""),
      erros: String(data.erros || ""),
      resumo: String(data.resumo || ""),
      motivo: String(data.motivo || ""),
      solucao: String(data.solucao || "").replace(/\s+/g, " ").trim().slice(0, 800)
    };
  } catch {
    return empty;
  }
};

const fallbackTransferSummary = async (
  ticketId: number,
  companyId: number,
  destination?: string
): Promise<string> => {
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
  const last = lines[lines.length - 1] || "";
  return formatTransferNote({
    cliente: "Não informado",
    sistema: "Não informado",
    problema: "Não informado",
    erros: "Não informado",
    resumo: last || "Sem mensagens anteriores nesta conversa.",
    motivo: "Encaminhamento do atendimento",
    setor: destination || "Não informado"
  });
};

export default generateContextSummary;

