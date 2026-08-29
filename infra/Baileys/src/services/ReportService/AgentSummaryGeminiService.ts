import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import User from "../../models/User";
import { AIProviderSelector } from "../AiServices/AIProviderSelector";
import { getLmStudioContextWindowTokens } from "../../config/openai";

interface AgentSummaryParams {
  companyId: number;
  agentId?: number; // Agora é opcional
  dateStart?: string;
  dateEnd?: string;
  maxMessages?: number;
}

interface AgentSummaryResponse {
  summary: string;
  ticketsCount: number;
}

const formatDate = (date: Date | string | undefined): string => {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 19).replace("T", " ");
};

const AgentSummaryGeminiService = async ({
  companyId,
  agentId,
  dateStart,
  dateEnd,
  maxMessages: maxMessagesParam = 100
}: AgentSummaryParams): Promise<AgentSummaryResponse> => {
  // Selecionar provider usando configuração automática
  const provider = await AIProviderSelector.getProvider(companyId, "summaries");

  // Determinar se é resumo de atendente específico ou geral
  const isGeneralSummary = !agentId;
  const ctxWindow = getLmStudioContextWindowTokens();
  /** Evita prompt maior que n_ctx do LM Studio (ex.: 4096) */
  const maxMessages =
    ctxWindow <= 4096
      ? Math.min(maxMessagesParam, isGeneralSummary ? 32 : 48)
      : ctxWindow <= 8192
        ? Math.min(maxMessagesParam, 72)
        : maxMessagesParam;
  let agentName = "Todos os Atendentes";
  
  if (agentId) {
    const agent = await User.findByPk(agentId);
    agentName = agent?.name || "Atendente";
  }

  // Montar filtro de tickets
  const ticketWhere: any = {
    companyId
  };

  // Se tiver agentId, filtrar por ele
  if (agentId) {
    ticketWhere.userId = agentId;
  }

  // Filtrar por período se fornecido
  if (dateStart || dateEnd) {
    ticketWhere.createdAt = {};
    if (dateStart) {
      ticketWhere.createdAt[Op.gte] = new Date(`${dateStart} 00:00:00`);
    }
    if (dateEnd) {
      ticketWhere.createdAt[Op.lte] = new Date(`${dateEnd} 23:59:59`);
    }
  }

  // Buscar tickets
  const tickets = await Ticket.findAll({
    where: ticketWhere,
    include: [
      { model: Contact },
      { model: User, attributes: ["id", "name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: 100 // Limitar para não sobrecarregar
  });

  if (!tickets.length) {
    return {
      summary: isGeneralSummary 
        ? "Nenhuma conversa encontrada no período informado."
        : "Nenhuma conversa encontrada para o atendente e período informados.",
      ticketsCount: 0
    };
  }

  // Buscar mensagens separadamente para cada ticket
  const ticketIds = tickets.map(t => t.id);
  const messagesWhere: any = {
    ticketId: { [Op.in]: ticketIds },
    companyId
  };

  if (dateStart || dateEnd) {
    messagesWhere.createdAt = {};
    if (dateStart) {
      messagesWhere.createdAt[Op.gte] = new Date(`${dateStart} 00:00:00`);
    }
    if (dateEnd) {
      messagesWhere.createdAt[Op.lte] = new Date(`${dateEnd} 23:59:59`);
    }
  }

  const allMessages = await Message.findAll({
    where: messagesWhere,
    order: [["createdAt", "ASC"]]
  });

  // Agrupar mensagens por ticket
  const messagesByTicket: { [key: number]: Message[] } = {};
  for (const msg of allMessages) {
    if (!messagesByTicket[msg.ticketId]) {
      messagesByTicket[msg.ticketId] = [];
    }
    messagesByTicket[msg.ticketId].push(msg);
  }

  const lines: string[] = [];
  let messagesCount = 0;

  for (const ticket of tickets) {
    const anyTicket: any = ticket as any;
    const contact: Contact | undefined = anyTicket.contact;
    const ticketUser: any = anyTicket.user;
    const ticketMessages: Message[] = messagesByTicket[ticket.id] || [];

    if (!ticketMessages.length) {
      continue;
    }

    // Incluir nome do atendente no resumo geral
    const attendantInfo = isGeneralSummary && ticketUser?.name 
      ? ` | Atendente: ${ticketUser.name}` 
      : "";

    lines.push(
      `=== Ticket #${ticket.id} | Contato: ${
        contact?.name || contact?.number || "Desconhecido"
      }${attendantInfo} | Criado em: ${formatDate(ticket.createdAt)} ===`
    );

    for (const msg of ticketMessages) {
      if (messagesCount >= maxMessages) break;
      if (!msg.body) continue;

      const role = msg.fromMe ? "ATENDENTE" : "CLIENTE";
      lines.push(
        `[${role}] (${formatDate(msg.createdAt)}): ${(msg.body || "").slice(
          0,
          500
        )}`
      );
      messagesCount += 1;
    }

    lines.push("");

    if (messagesCount >= maxMessages) {
      break;
    }
  }

  const conversationsText = lines.join("\n");

  if (!conversationsText || conversationsText.trim().length === 0) {
    return {
      summary: "Não foi possível processar as conversas. Verifique se há mensagens válidas no período selecionado.",
      ticketsCount: tickets.length
    };
  }

  const summaryType = isGeneralSummary ? "RESUMO GERAL" : `RESUMO: ${agentName}`;
  
  // Prompt simplificado para economizar tokens
  const systemPrompt = `Você é um ANALISTA DE QUALIDADE DE ATENDIMENTO. ${isGeneralSummary ? "Analise as conversas abaixo e produza um RELATÓRIO EXECUTIVO GERAL." : `Analise as conversas do atendente ${agentName} e produza um RELATÓRIO EXECUTIVO.`}

ESTRUTURA DO RELATÓRIO:
1. RESUMO EXECUTIVO: Quantidade de atendimentos, período, avaliação geral
2. PRINCIPAIS DEMANDAS: TOP 5 assuntos mais frequentes
3. CASOS RESOLVIDOS: Quantos resolvidos, exemplos (cite ticket e cliente)
4. PENDÊNCIAS: Casos não resolvidos (Ticket #, Cliente, ${isGeneralSummary ? "Atendente, " : ""}Problema, Ação)
${isGeneralSummary ? `5. DESEMPENHO POR ATENDENTE: Quantidade, melhores desempenhos
6. PONTOS FORTES DA EQUIPE: Boas práticas identificadas
7. OPORTUNIDADES DE MELHORIA: Aspectos a desenvolver, sugestões
8. RECOMENDAÇÕES: Ações imediatas, insights` : `5. PONTOS FORTES: Habilidades, boas práticas
6. OPORTUNIDADES DE MELHORIA: Aspectos a desenvolver
7. RECOMENDAÇÕES: Ações imediatas, processos a otimizar`}

REGRAS: Seja específico (cite tickets e nomes), objetivo, construtivo. Use formatação clara. Português brasileiro.

`;

  const conversationsLabel = isGeneralSummary 
    ? `CONVERSAS DA EMPRESA (até ${maxMessages} mensagens de ${tickets.length} tickets)` 
    : `CONVERSAS DO ATENDENTE ${agentName} (até ${maxMessages} mensagens)`;

  let finalPrompt = `${systemPrompt}\n\n${conversationsLabel}:\n\n${conversationsText}`;

  /**
   * Garante que o texto cabe na janela do LM Studio: tokens(prompt) + max_tokens <= n_ctx.
   * Heurística conservadora para PT (~2.2 chars/token no pior caso em JSON).
   */
  const outTokenBudget = Math.min(
    2048,
    Math.max(384, Math.floor(ctxWindow * 0.38))
  );
  const templateOverhead = 96;
  const maxPromptChars = Math.max(
    1500,
    Math.floor((ctxWindow - outTokenBudget - templateOverhead) * 2.2)
  );
  if (finalPrompt.length > maxPromptChars) {
    finalPrompt =
      finalPrompt.slice(0, maxPromptChars - 120) +
      "\n\n[... conteúdo truncado para caber no contexto do modelo. Reduza o período de datas ou aumente o Context Length no LM Studio (ex.: 8192) ...]";
  }

  try {
    console.log(`📤 Enviando requisição para ${provider.name}...`);

    // max_tokens efetivo ainda é limitado em OpenAIProvider.generateText; aqui evitamos pedir 4096 em modelo 4k
    const text = await provider.generateText(finalPrompt, {
      temperature: 0.4,
      maxTokens: outTokenBudget,
      topP: 0.95
    });

    if (!text || text.trim() === "") {
      throw new AppError("Resposta vazia da IA", 500);
    }

    console.log(`✅ Resumo gerado com sucesso usando ${provider.name} (${text.length} caracteres)`);

    return {
      summary: text.trim(),
      ticketsCount: tickets.length
    };
  } catch (err: any) {
    console.error(`❌ Erro ao gerar resumo com ${provider.name}:`, {
      message: err.message
    });
    
    if (err instanceof AppError) {
      throw err;
    }
    
    throw new AppError(`Erro ao gerar resumo: ${err.message || "Erro desconhecido"}`, 500);
  }
};

export default AgentSummaryGeminiService;


