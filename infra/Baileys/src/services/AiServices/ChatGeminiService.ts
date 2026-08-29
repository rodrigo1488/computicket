import { Op, fn, col, literal } from "sequelize";
import fs from "fs";
import path from "path";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import Company from "../../models/Company";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import HelpArticle from "../../models/HelpArticle";
import { AIProviderSelector } from "./AIProviderSelector";
import { ChatMessage } from "./AIProviderInterface";
import DashboardCommandService from "./DashboardCommandService";
import { truncateSystemPromptForLmStudio } from "../../config/openai";

interface ChatGeminiParams {
  companyId: number;
  userId: number;
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  articles?: Array<{ id: number; title: string; content: string; summary?: string; keywords?: string; category?: string }>;
}

interface ChatGeminiResponse {
  response: string;
}

interface DetectedEntities {
  attendantNames: string[];
  contactNames: string[];
  period: "today" | "yesterday" | "week" | "month" | "all";
  matchedUsers: Array<{ id: number; name: string }>;
  matchedContacts: Array<{ id: number; name: string; number: string }>;
}

// Função para formatar data/hora
const formatDateTime = (date: Date | string): string => {
  const d = new Date(date);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

// Função para retornar o manual de utilização do sistema
const getSystemManual = (): string => {
  // Retornar versão resumida otimizada para economizar tokens
  return `📚 MANUAL DO SISTEMA COMPUCHAT (Resumo)

PRINCIPAIS FUNCIONALIDADES:
• Tickets: Atendimento WhatsApp, transferências, filas, tags
• Dashboard: Métricas, estatísticas, relatórios
• Automação: Flow Builder, campanhas, mensagens rápidas
• IA: Integração OpenAI/Gemini, análise de conversas
• Gestão: Contatos, usuários, filas, tags, formulários

COMO USAR:
- Tickets: Aceitar, responder, transferir, fechar, classificar com tags
- Dashboard: Visualizar métricas, estatísticas, relatórios
- Configurações: WhatsApp, IA, filas, tags, mensagens rápidas
- Campanhas: Criar, agendar, enviar em massa
- Flow Builder: Criar automações e fluxos

IMPORTANTE: Use este conhecimento para responder perguntas sobre funcionalidades e uso do sistema.`;
};

const HELP_ARTICLE_STOPWORDS = new Set([
  "que",
  "uma",
  "para",
  "como",
  "sobre",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "quando",
  "onde",
  "qual",
  "quais",
  "isso",
  "esse",
  "essa",
  "este",
  "esta",
  "estão",
  "estao",
  "pode",
  "por",
  "dos",
  "das",
  "nos",
  "nas",
  "aos",
  "com",
  "foi",
  "são",
  "sao",
  "tem",
  "ser",
  "the",
  "and"
]);

const normalizeForMatch = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

const tokenizeQuestionForSearch = (question: string): string[] => {
  const norm = normalizeForMatch(question);
  const parts = norm.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !HELP_ARTICLE_STOPWORDS.has(w));
  return [...new Set(parts)].slice(0, 14);
};

const sanitizeLikeFragment = (s: string): string => s.replace(/[%_]/g, "");

// Função para detectar entidades na pergunta do usuário (sem carregar todos users/contacts)
const detectEntitiesInQuestion = async (
  question: string,
  companyId: number
): Promise<DetectedEntities> => {
  const questionLower = question.toLowerCase();

  // Detectar período mencionado
  let period: DetectedEntities["period"] = "week";
  if (questionLower.includes("hoje") || questionLower.includes("agora")) {
    period = "today";
  } else if (questionLower.includes("ontem")) {
    period = "yesterday";
  } else if (questionLower.includes("semana") || questionLower.includes("7 dias")) {
    period = "week";
  } else if (questionLower.includes("mês") || questionLower.includes("mes") || questionLower.includes("30 dias")) {
    period = "month";
  }

  const tokens = tokenizeQuestionForSearch(question).filter(t => t.length >= 3);
  const likeTokens = tokens.filter(t => t.length >= 4).slice(0, 6);
  const fallbackTokens = likeTokens.length === 0 ? tokens.slice(0, 4) : likeTokens;

  const matchedUsers: Array<{ id: number; name: string }> = [];
  const attendantNames: string[] = [];
  const matchedContacts: Array<{ id: number; name: string; number: string }> = [];
  const contactNames: string[] = [];

  if (fallbackTokens.length === 0) {
    return {
      attendantNames,
      contactNames,
      period,
      matchedUsers,
      matchedContacts
    };
  }

  const orUser = fallbackTokens.map(t => ({
    name: { [Op.like]: `%${sanitizeLikeFragment(t)}%` }
  }));

  const users = await User.findAll({
    where: { companyId, [Op.or]: orUser },
    attributes: ["id", "name"],
    limit: 35,
    raw: true
  }) as Array<{ id: number; name: string }>;

  const seenUser = new Set<number>();
  for (const user of users) {
    if (seenUser.has(user.id)) continue;
    const userNameLower = user.name.toLowerCase();
    const parts = userNameLower.split(/\s+/).filter(Boolean);
    const hit =
      questionLower.includes(userNameLower) ||
      parts.some(p => p.length >= 4 && questionLower.includes(p));
    if (hit) {
      seenUser.add(user.id);
      matchedUsers.push(user);
      attendantNames.push(user.name);
    }
  }

  const orContact = fallbackTokens.map(t => ({
    name: { [Op.like]: `%${sanitizeLikeFragment(t)}%` }
  }));

  const contacts = await Contact.findAll({
    where: {
      companyId,
      [Op.or]: orContact
    },
    attributes: ["id", "name", "number"],
    limit: 35,
    raw: true
  }) as Array<{ id: number; name: string; number: string }>;

  const seenContact = new Set<number>();
  for (const contact of contacts) {
    if (!contact.name || seenContact.has(contact.id)) continue;
    const contactNameLower = contact.name.toLowerCase();
    const parts = contactNameLower.split(/\s+/).filter(Boolean);
    const hit =
      questionLower.includes(contactNameLower) ||
      parts.some(p => p.length >= 4 && questionLower.includes(p));
    if (hit) {
      seenContact.add(contact.id);
      matchedContacts.push(contact);
      contactNames.push(contact.name);
    }
  }

  return {
    attendantNames,
    contactNames,
    period,
    matchedUsers,
    matchedContacts
  };
};

// Função para calcular datas do período
const getPeriodDates = (period: DetectedEntities["period"]): { start: Date; end: Date } => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getTime());

  switch (period) {
    case "today":
      return { start: today, end };
    case "yesterday":
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: yesterday, end: today };
    case "week":
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { start: weekAgo, end };
    case "month":
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return { start: monthAgo, end };
    default:
      const defaultStart = new Date(today);
      defaultStart.setDate(defaultStart.getDate() - 7);
      return { start: defaultStart, end };
  }
};

// Função para buscar tickets com mensagens detalhadas
const fetchTicketsWithMessages = async (
  companyId: number,
  period: DetectedEntities["period"],
  userId?: number,
  contactId?: number,
  limit: number = 100
): Promise<any[]> => {
  const { start, end } = getPeriodDates(period);

  const whereClause: any = {
    companyId,
    [Op.or]: [
      { createdAt: { [Op.gte]: start, [Op.lte]: end } },
      { updatedAt: { [Op.gte]: start, [Op.lte]: end } }
    ]
  };

  if (userId) {
    whereClause.userId = userId;
  }

  if (contactId) {
    whereClause.contactId = contactId;
  }

  const tickets = await Ticket.findAll({
    where: whereClause,
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: User, attributes: ["id", "name"] },
      { model: Queue, attributes: ["id", "name"] }
    ],
    order: [["updatedAt", "DESC"]],
    limit
  });

  const ticketIds = tickets.map((t: any) => t.id);
  const messagesByTicket = new Map<number, any[]>();
  ticketIds.forEach(id => messagesByTicket.set(id, []));

  if (ticketIds.length > 0) {
    const allMessages = await Message.findAll({
      where: {
        ticketId: { [Op.in]: ticketIds },
        companyId,
        createdAt: {
          [Op.gte]: start,
          [Op.lte]: end
        }
      },
      order: [["createdAt", "ASC"]],
      limit: 12000,
      raw: true
    });

    for (const msg of allMessages) {
      const tid = msg.ticketId as number;
      const arr = messagesByTicket.get(tid);
      if (!arr) continue;
      arr.push(msg);
    }
    for (const tid of ticketIds) {
      const arr = messagesByTicket.get(tid);
      if (!arr?.length) continue;
      arr.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (arr.length > 50) {
        arr.splice(50);
      }
    }
  }

  return tickets.map((ticket: any) => {
    const messages = messagesByTicket.get(ticket.id) || [];
    return {
      id: ticket.id,
      status: ticket.status,
      contact: {
        id: ticket.contact?.id,
        name: ticket.contact?.name || "Desconhecido",
        number: ticket.contact?.number || ""
      },
      attendant: {
        id: ticket.user?.id,
        name: ticket.user?.name || "Sem atendente"
      },
      queue: ticket.queue?.name || "Sem fila",
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      messagesCount: messages.length,
      messages: messages.map((msg: any) => ({
        id: msg.id,
        body: (msg.body || "").slice(0, 500),
        fromMe: msg.fromMe,
        createdAt: msg.createdAt,
        sender: msg.fromMe ? "ATENDENTE" : "CLIENTE"
      }))
    };
  });
};

/** Tickets recentes sem carregar mensagens (modo compacto). */
const fetchRecentWeekTicketsMetadataOnly = async (
  companyId: number,
  period: DetectedEntities["period"],
  limit: number = 100
): Promise<any[]> => {
  const { start, end } = getPeriodDates(period);

  const whereClause: any = {
    companyId,
    [Op.or]: [
      { createdAt: { [Op.gte]: start, [Op.lte]: end } },
      { updatedAt: { [Op.gte]: start, [Op.lte]: end } }
    ]
  };

  const tickets = await Ticket.findAll({
    where: whereClause,
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: User, attributes: ["id", "name"] },
      { model: Queue, attributes: ["id", "name"] }
    ],
    order: [["updatedAt", "DESC"]],
    limit
  });

  return tickets.map((ticket: any) => ({
    id: ticket.id,
    status: ticket.status,
    contact: {
      id: ticket.contact?.id,
      name: ticket.contact?.name || "Desconhecido",
      number: ticket.contact?.number || ""
    },
    attendant: {
      id: ticket.user?.id,
      name: ticket.user?.name || "Sem atendente"
    },
    queue: ticket.queue?.name || "Sem fila",
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messagesCount: 0,
    messages: [] as any[]
  }));
};

// Função para buscar dados específicos de um atendente
const fetchUserSpecificData = async (
  companyId: number,
  userId: number,
  userName: string,
  period: DetectedEntities["period"]
): Promise<string> => {
  const { start, end } = getPeriodDates(period);
  const periodLabel = period === "today" ? "HOJE" :
    period === "yesterday" ? "ONTEM" :
      period === "week" ? "ÚLTIMOS 7 DIAS" : "ÚLTIMOS 30 DIAS";

  // Buscar todos os tickets do atendente no período
  const tickets = await fetchTicketsWithMessages(companyId, period, userId, undefined, 50);

  if (tickets.length === 0) {
    return `\n📋 ATENDIMENTOS DE ${userName.toUpperCase()} (${periodLabel}):\n• Nenhum atendimento encontrado no período.\n`;
  }

  let output = `\n═══════════════════════════════════════════════════════════════════
📋 ATENDIMENTOS DETALHADOS DE ${userName.toUpperCase()} (${periodLabel})
Total de atendimentos: ${tickets.length}
═══════════════════════════════════════════════════════════════════\n`;

  for (const ticket of tickets) {
    output += `\n▶ TICKET #${ticket.id} | Status: ${ticket.status.toUpperCase()}
   Cliente: ${ticket.contact.name} (${ticket.contact.number})
   Fila: ${ticket.queue}
   Criado: ${formatDateTime(ticket.createdAt)}
   Atualizado: ${formatDateTime(ticket.updatedAt)}
   Total de mensagens: ${ticket.messagesCount}\n`;

    if (ticket.messages && ticket.messages.length > 0) {
      output += `   --- CONVERSAS COMPLETAS ---\n`;
      // Mostrar mais mensagens quando é um atendente específico (até 30 mensagens)
      for (const msg of ticket.messages.slice(0, 30)) {
        const sender = msg.fromMe ? "🧑‍💼 ATENDENTE" : "👤 CLIENTE";
        const time = formatDateTime(msg.createdAt);
        const body = (msg.body || "").replace(/\n/g, " ").slice(0, 300);
        if (body.trim()) {
          output += `   [${time}] ${sender}: ${body}\n`;
        }
      }
      if (ticket.messages.length > 30) {
        output += `   ... +${ticket.messages.length - 30} mensagens adicionais\n`;
      }
    }
    output += `   ─────────────────────────────────────\n`;
  }

  return output;
};

type CompanyAggregatePayload = {
  company: string;
  stats: {
    total: { tickets: number; messages: number; contacts: number };
    ticketsByStatus: { open: number; pending: number; closed: number };
    period: { ticketsToday: number; ticketsWeek: number; messagesToday: number };
  };
  users: Array<{ id: number; name: string; profile: string }>;
  userTicketStats: Array<{
    userId: number;
    userName: string;
    ticketsPeriod: number;
    ticketsToday: number;
  }>;
  queues: Array<{ id: number; name: string }>;
  queueStats: Array<{ queueId: number; queueName: string; ticketsCount: number }>;
  tags: Array<{ id: number; name: string }>;
  whatsapps: Array<{ id: number; name: string; status: string; isDefault: boolean }>;
};

const companyAggregateCache = new Map<string, { expires: number; data: CompanyAggregatePayload }>();

const fetchCompanyStatsAggregate = async (
  companyId: number,
  period: DetectedEntities["period"] = "week"
): Promise<CompanyAggregatePayload> => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { start: periodStart } = getPeriodDates(period);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const company = await Company.findByPk(companyId);

  const totalTickets = await Ticket.count({ where: { companyId } });
  const totalMessages = await Message.count({ where: { companyId } });
  const totalContacts = await Contact.count({ where: { companyId } });

  const ticketsOpen = await Ticket.count({ where: { companyId, status: "open" } });
  const ticketsPending = await Ticket.count({ where: { companyId, status: "pending" } });
  const ticketsClosed = await Ticket.count({ where: { companyId, status: "closed" } });

  const ticketsToday = await Ticket.count({
    where: { companyId, createdAt: { [Op.gte]: today } }
  });

  const ticketsWeek = await Ticket.count({
    where: { companyId, createdAt: { [Op.gte]: last7Days } }
  });

  const messagesToday = await Message.count({
    where: { companyId, createdAt: { [Op.gte]: today } }
  });

  const users = await User.findAll({
    where: { companyId },
    attributes: ["id", "name", "email", "profile"],
    raw: true
  });

  const ticketsByUser = await Ticket.findAll({
    where: {
      companyId,
      userId: { [Op.ne]: null },
      createdAt: { [Op.gte]: periodStart }
    },
    attributes: ["userId", [fn("COUNT", col("id")), "total"]],
    group: ["userId"],
    raw: true
  }) as any[];

  const ticketsTodayByUser = await Ticket.findAll({
    where: {
      companyId,
      userId: { [Op.ne]: null },
      createdAt: { [Op.gte]: today }
    },
    attributes: ["userId", [fn("COUNT", col("id")), "total"]],
    group: ["userId"],
    raw: true
  }) as any[];

  const userTicketStats = users
    .map((user: any) => {
      const periodStat = ticketsByUser.find((s: any) => s.userId === user.id);
      const todayStat = ticketsTodayByUser.find((s: any) => s.userId === user.id);
      return {
        userId: user.id,
        userName: user.name,
        ticketsPeriod: periodStat ? parseInt(periodStat.total, 10) : 0,
        ticketsToday: todayStat ? parseInt(todayStat.total, 10) : 0
      };
    })
    .sort((a, b) => b.ticketsPeriod - a.ticketsPeriod);

  const queues = await Queue.findAll({
    where: { companyId },
    attributes: ["id", "name", "color"],
    raw: true
  });

  const ticketsByQueue = await Ticket.findAll({
    where: {
      companyId,
      queueId: { [Op.ne]: null },
      createdAt: { [Op.gte]: periodStart }
    },
    attributes: ["queueId", [fn("COUNT", col("id")), "total"]],
    group: ["queueId"],
    raw: true
  }) as any[];

  const queueStats = ticketsByQueue
    .map((stat: any) => {
      const queue = queues.find((q: any) => q.id === stat.queueId);
      return {
        queueId: stat.queueId,
        queueName: queue?.name || "Sem fila",
        ticketsCount: parseInt(stat.total, 10)
      };
    })
    .sort((a, b) => b.ticketsCount - a.ticketsCount);

  const tags = await Tag.findAll({
    where: { companyId },
    attributes: ["id", "name", "color"],
    raw: true
  });

  const whatsapps = await Whatsapp.findAll({
    where: { companyId },
    attributes: ["id", "name", "status", "isDefault"],
    raw: true
  });

  return {
    company: company?.name || "Empresa",
    stats: {
      total: {
        tickets: totalTickets,
        messages: totalMessages,
        contacts: totalContacts
      },
      ticketsByStatus: {
        open: ticketsOpen,
        pending: ticketsPending,
        closed: ticketsClosed
      },
      period: {
        ticketsToday,
        ticketsWeek,
        messagesToday
      }
    },
    users: users.map((u: any) => ({ id: u.id, name: u.name, profile: u.profile })),
    userTicketStats,
    queues: queues.map((q: any) => ({ id: q.id, name: q.name })),
    queueStats,
    tags: tags.map((t: any) => ({ id: t.id, name: t.name })),
    whatsapps: whatsapps.map((w: any) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      isDefault: w.isDefault
    }))
  };
};

const getCachedCompanyStatsAggregate = async (
  companyId: number,
  period: DetectedEntities["period"],
  ttlSeconds: number
): Promise<CompanyAggregatePayload> => {
  if (ttlSeconds <= 0) {
    return fetchCompanyStatsAggregate(companyId, period);
  }
  const key = `${companyId}:${period}`;
  const now = Date.now();
  const hit = companyAggregateCache.get(key);
  if (hit && hit.expires > now) {
    return hit.data;
  }
  const data = await fetchCompanyStatsAggregate(companyId, period);
  companyAggregateCache.set(key, { expires: now + ttlSeconds * 1000, data });
  return data;
};

/** Agrega estatísticas + tickets da semana (com ou sem corpo das mensagens). */
const fetchCompanyData = async (
  companyId: number,
  period: DetectedEntities["period"] = "week",
  options: { includeWeekMessageBodies: boolean; statsCacheTtlSeconds: number }
) => {
  const statsPart = await getCachedCompanyStatsAggregate(companyId, period, options.statsCacheTtlSeconds);
  const weekTickets = options.includeWeekMessageBodies
    ? await fetchTicketsWithMessages(companyId, "week", undefined, undefined, 100)
    : await fetchRecentWeekTicketsMetadataOnly(companyId, "week", 100);

  return {
    ...statsPart,
    weekTickets
  };
};

const needsDetailedConversationContext = (message: string): boolean => {
  const lower = message.toLowerCase();
  if (/#\s*\d+/.test(message)) {
    return true;
  }
  const keys = [
    "mensagem",
    "mensagens",
    "conversa",
    "conversas",
    "falou",
    "disseram",
    "disse",
    "texto da",
    "ultima mensagem",
    "última mensagem",
    "historico",
    "histórico",
    "transcri",
    "detalhe da",
    "trecho",
    "copiar mensagem",
    "print da conversa",
    "o que foi dito",
    "o que disse",
    "conteúdo do ticket",
    "conteudo do ticket"
  ];
  return keys.some(k => lower.includes(k));
};

const selectHelpArticlesForChat = async (
  companyId: number,
  message: string,
  maxArticles: number
): Promise<
  Array<{
    id: number;
    title: string;
    content: string;
    summary?: string;
    keywords?: string;
    category?: string;
  }>
> => {
  const tokens = tokenizeQuestionForSearch(message);
  const candidates = await HelpArticle.findAll({
    where: {
      isActive: true,
      createdByCompanyId: companyId
    },
    order: [["order", "ASC"], ["createdAt", "DESC"]],
    limit: 80
  });

  const scoreArticle = (a: HelpArticle): number => {
    const hay = normalizeForMatch(
      `${a.title || ""} ${a.summary || ""} ${a.keywords || ""} ${(a.content || "").slice(0, 1200)}`
    );
    if (tokens.length === 0) {
      return 0;
    }
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) {
        score += 1;
      }
    }
    return score;
  };

  const scored = candidates
    .map(article => ({ article, score: scoreArticle(article) }))
    .sort((a, b) => b.score - a.score || a.article.id - b.article.id);

  const pick =
    scored.length > 0 && scored.every(x => x.score === 0)
      ? candidates.slice(0, maxArticles)
      : scored.slice(0, maxArticles).map(x => x.article);

  return pick.map(article => ({
    id: article.id,
    title: article.title,
    content: article.content,
    summary: article.summary,
    keywords: article.keywords,
    category: article.category
  }));
};

// Função para detectar se a mensagem é um comando de agendamento/tarefa
// Prioridade: agendamento > tarefa > outros
// Detecção mais abrangente para pegar todas as variações
const detectCommandType = (message: string): "appointment" | "task" | "none" => {
  const lower = message.toLowerCase().trim();
  
  // Palavras-chave para agendamento (prioridade alta) - expandido
  // IMPORTANTE: "agende" e "agendar" devem ser detectados mesmo sem contexto adicional
  const appointmentKeywords = [
    "agende", "agendar", "agendamento", "agendamentos",
    "marcar reunião", "marcar encontro", "marcar consulta", "marcar compromisso", "marcar",
    "criar agendamento", "criar reunião", "criar encontro", "criar compromisso",
    "reunião", "reuniões", "encontro", "encontros",
    "compromisso", "compromissos",
    "horário", "horario", "horários", "horarios",
    "agenda", "agendar para", "marcar para",
    "quero agendar", "preciso agendar", "vou agendar",
    "marcar uma", "agendar uma", "fazer um agendamento",
    "agende uma reunião", "agendar uma reunião", "marcar uma reunião",
    "agende uma", "agendar uma", "agende para", "agendar para"
  ];
  
  // Palavras-chave para tarefa
  const taskKeywords = [
    "criar tarefa", "criar uma tarefa", "nova tarefa",
    "tarefa", "tarefas",
    "lembre-me", "lembrar", "lembre", "me lembre",
    "lembrar de", "não esquecer", "nao esquecer",
    "criar lembrete", "lembrete"
  ];
  
  // Verificar agendamento primeiro (prioridade) - verificação mais robusta
  const hasAppointmentKeyword = appointmentKeywords.some(keyword => {
    // Verificar se a palavra-chave está na mensagem
    if (lower.includes(keyword)) {
      // Palavras-chave específicas que sempre indicam agendamento (não precisam de contexto)
      const alwaysAppointment = ["agende", "agendar", "agendamento", "agendamentos", "agenda"];
      if (alwaysAppointment.includes(keyword)) {
        return true; // "agende" e "agendar" sempre indicam agendamento
      }
      
      // Se for uma palavra-chave genérica como "marcar", verificar contexto
      if (keyword === "marcar") {
        // Verificar se há contexto de tempo/data após a palavra
        const keywordIndex = lower.indexOf(keyword);
        const afterKeyword = lower.substring(keywordIndex + keyword.length, keywordIndex + keyword.length + 30);
        // Se houver palavras relacionadas a tempo/data, é agendamento
        return afterKeyword.includes("reunião") || 
               afterKeyword.includes("encontro") || 
               afterKeyword.includes("consulta") ||
               afterKeyword.includes("compromisso") ||
               afterKeyword.includes("para") ||
               afterKeyword.includes("às") ||
               afterKeyword.includes("as") ||
               afterKeyword.includes("hoje") ||
               afterKeyword.includes("amanhã") ||
               afterKeyword.includes("amanha") ||
               /\d{1,2}[h:]/.test(afterKeyword) ||
               /\d{1,2}\/\d{1,2}/.test(afterKeyword);
      }
      return true;
    }
    return false;
  });
  
  if (hasAppointmentKeyword) {
    return "appointment";
  }
  
  // Verificar tarefa
  if (taskKeywords.some(keyword => lower.includes(keyword))) {
    return "task";
  }
  
  return "none";
};

// Função para detectar confirmações e buscar comando original no histórico
const detectConfirmationAndGetOriginalCommand = (
  message: string,
  conversationHistory: Array<{ role: string; content: string }>
): string | null => {
  const lower = message.toLowerCase().trim();
  const confirmations = ["sim", "confirmo", "confirmar", "ok", "okay", "pode", "pode ser", "tudo bem", "perfeito", "correto", "está certo", "esta certo"];
  
  if (confirmations.some(conf => lower === conf || lower.startsWith(conf + " "))) {
    // Buscar no histórico a última mensagem do usuário que contém comando de agendamento
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const histMsg = conversationHistory[i];
      if (histMsg.role === "user") {
        const commandType = detectCommandType(histMsg.content);
        if (commandType !== "none") {
          console.log(`✅ Confirmação detectada - Processando comando original: "${histMsg.content}"`);
          return histMsg.content;
        }
      }
    }
  }
  
  return null;
};

const ChatGeminiService = async ({
  companyId,
  userId,
  message,
  conversationHistory = [],
  articles
}: ChatGeminiParams): Promise<ChatGeminiResponse> => {
  console.log(`📨 Mensagem recebida: "${message}"`);
  console.log(`📚 Histórico: ${conversationHistory.length} mensagens`);
  
  // PRIORIDADE 1: Verificar se é uma confirmação e buscar comando original
  const originalCommand = detectConfirmationAndGetOriginalCommand(message, conversationHistory);
  const commandToProcess = originalCommand || message;
  
  console.log(`🔍 Comando a processar: "${commandToProcess}"`);
  
  // PRIORIDADE 2: Verificar se a mensagem (ou comando original) é um comando de agendamento/tarefa ANTES de processar com IA
  const commandType = detectCommandType(commandToProcess);
  
  console.log(`🎯 Tipo de comando detectado: ${commandType}`);
  
  if (commandType !== "none") {
    try {
      console.log(`🔍 Comando detectado: ${commandType} - Processando...`);
      if (originalCommand) {
        console.log(`📝 Usando comando original do histórico: "${originalCommand}"`);
      } else {
        console.log(`📝 Processando comando da mensagem atual: "${message}"`);
      }
      
      const commandResult = await DashboardCommandService({
        companyId,
        userId,
        command: commandToProcess
      });

      console.log(`📋 Resultado do comando:`, {
        success: commandResult.success,
        action: commandResult.action,
        hasTask: !!commandResult.task,
        hasAppointment: !!commandResult.appointment
      });

      // Se o comando foi executado com sucesso, retornar mensagem automática SEM chamar IA
      if (commandResult.success) {
        let responseText = "";
        
        if (commandResult.action === "create_task" && commandResult.task) {
          responseText = `✅ **Tarefa criada com sucesso!**\n\n📋 ${commandResult.task.title}`;
          if (commandResult.task.description) {
            responseText += `\n\n${commandResult.task.description}`;
          }
          if (commandResult.task.dueDate) {
            const dueDate = new Date(commandResult.task.dueDate);
            responseText += `\n\n📅 **Prazo:** ${dueDate.toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })}`;
          }
        } else if (commandResult.action === "create_appointment" && commandResult.appointment) {
          responseText = `✅ **Agendamento concluído!**\n\n📅 ${commandResult.appointment.title}`;
          if (commandResult.appointment.description) {
            responseText += `\n\n${commandResult.appointment.description}`;
          }
          if (commandResult.appointment.startTime) {
            const startTime = new Date(commandResult.appointment.startTime);
            const endTime = commandResult.appointment.endTime 
              ? new Date(commandResult.appointment.endTime)
              : new Date(startTime.getTime() + 60 * 60 * 1000);
            
            // Formatar data e hora de forma mais clara
            const startDateStr = startTime.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric"
            });
            const startTimeStr = startTime.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit"
            });
            const endTimeStr = endTime.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit"
            });
            
            responseText += `\n\n🕐 **Horário:** ${startDateStr} das ${startTimeStr} às ${endTimeStr}`;
          }
        } else {
          // Fallback para mensagem genérica de sucesso
          responseText = commandResult.message || "✅ Comando executado com sucesso!";
        }

        console.log(`✅ ${commandResult.action === "create_appointment" ? "Agendamento" : "Tarefa"} criado com sucesso - Retornando mensagem automática`);
        
        // Retornar imediatamente SEM processar com IA
        return {
          response: responseText
        };
      } else {
        // Comando não foi executado - NÃO continuar com IA, retornar erro direto
        console.log(`⚠️ Comando não executado: ${commandResult.message}`);
        return {
          response: `❌ Não foi possível processar o comando.\n\n${commandResult.message}\n\nPor favor, tente novamente com informações mais completas.`
        };
      }
    } catch (err: any) {
      console.error("❌ Erro ao processar comando no chat:", err);
      // Em caso de erro, retornar mensagem de erro direta ao invés de chamar IA
      return {
        response: `❌ Erro ao processar comando: ${err.message || "Erro desconhecido"}\n\nPor favor, tente novamente.`
      };
    }
  }

  const { getChatConfig } = await import("./ChatConfigService");
  const chatConfig = await getChatConfig(companyId);

  // Selecionar provider usando configuração automática
  const provider = await AIProviderSelector.getProvider(companyId, "chat");

  // Artigos: seleção por relevância (evita injetar dezenas de textos longos)
  let articlesToUse = articles;
  if (!articlesToUse || articlesToUse.length === 0) {
    articlesToUse = await selectHelpArticlesForChat(companyId, message, chatConfig.maxArticles);
  }

  // Detectar entidades na pergunta do usuário
  const entities = await detectEntitiesInQuestion(message, companyId);
  console.log(`🔍 Entidades detectadas:`, {
    atendentes: entities.attendantNames,
    contatos: entities.contactNames,
    periodo: entities.period
  });

  const isDetailed =
    chatConfig.contextMode === "detailed" ||
    (chatConfig.contextMode === "auto" &&
      (needsDetailedConversationContext(message) ||
        entities.matchedUsers.length > 0 ||
        entities.matchedContacts.length > 0));

  console.log(`📐 Modo de contexto IA: ${chatConfig.contextMode} → detalhado=${isDetailed}`);

  // Buscar dados da empresa (tickets da semana com mensagens só em modo detalhado)
  const companyData = await fetchCompanyData(companyId, entities.period, {
    includeWeekMessageBodies: isDetailed,
    statsCacheTtlSeconds: chatConfig.statsCacheTtlSeconds
  });

  // Preparar dados específicos (mensagens de atendente/contato) só em modo detalhado
  let specificData = "";

  if (isDetailed) {
  // Buscar dados específicos dos atendentes mencionados
  for (const user of entities.matchedUsers) {
    specificData += await fetchUserSpecificData(companyId, user.id, user.name, entities.period);
  }

  // Buscar tickets de contatos específicos mencionados
  if (entities.matchedContacts.length > 0) {
    for (const contact of entities.matchedContacts) {
      const contactTickets = await fetchTicketsWithMessages(
        companyId,
        entities.period,
        undefined,
        contact.id,
        20
      );

      if (contactTickets.length > 0) {
        specificData += `\n═══════════════════════════════════════════════════════════════════
📋 ATENDIMENTOS DO CONTATO: ${contact.name} (${contact.number})
Total: ${contactTickets.length} tickets
═══════════════════════════════════════════════════════════════════\n`;

        for (const ticket of contactTickets) {
          specificData += `\n▶ TICKET #${ticket.id} | Status: ${ticket.status.toUpperCase()}
   Atendente: ${ticket.attendant.name}
   Fila: ${ticket.queue}
   Criado: ${formatDateTime(ticket.createdAt)}
   Mensagens: ${ticket.messagesCount}\n`;

          if (ticket.messages && ticket.messages.length > 0) {
            specificData += `   --- CONVERSAS ---\n`;
            // Limitar a 20 mensagens para economizar tokens, mas manter contexto
            for (const msg of ticket.messages.slice(0, 20)) {
              const sender = msg.fromMe ? "ATENDENTE" : "CLIENTE";
              const time = formatDateTime(msg.createdAt);
              const body = (msg.body || "").replace(/\n/g, " ").slice(0, 1000);
              if (body.trim()) {
                specificData += `   [${time}] ${sender}: ${body}\n`;
              }
            }
            if (ticket.messages.length > 20) {
              specificData += `   ... +${ticket.messages.length - 20} mensagens\n`;
            }
          }
        }
      }
    }
  }
  }

  // Gerar lista de tickets da semana para o contexto (aumentado limite)
  const weekTicketsList = companyData.weekTickets.slice(0, 50).map((t: any) =>
    `#${t.id} | ${t.status} | ${t.contact.name} | ${formatDateTime(t.updatedAt)}`
  ).join(' | ');

  const maxMsgSlice = isDetailed ? 500 : 200;
  const recentTicketsWithMessages = isDetailed
    ? companyData.weekTickets
        .filter((t: any) => t.messages && Array.isArray(t.messages) && t.messages.length > 0)
        .slice(0, 20)
        .map((ticket: any) => {
          let ticketMessages = `\n▶ TICKET #${ticket.id} | ${ticket.status} | ${ticket.contact?.name || "Desconhecido"}\n`;

          const messagesToShow = ticket.messages.slice(-20);
          for (const msg of messagesToShow) {
            const sender = msg.fromMe ? "ATENDENTE" : "CLIENTE";
            const time = formatDateTime(msg.createdAt);
            const body = (msg.body || "").replace(/\n/g, " ").slice(0, maxMsgSlice);
            if (body.trim()) {
              ticketMessages += `   [${time}] ${sender}: ${body}\n`;
            }
          }

          if (ticket.messages.length > 20) {
            ticketMessages += `   ... +${ticket.messages.length - 20} msgs\n`;
          }

          return ticketMessages;
        })
        .join("\n")
    : "";

  // Carregar manual de utilização do sistema
  const systemManual = getSystemManual();

  const maxArticleBodyLen = isDetailed ? 1200 : 450;
  let articlesContext = "";
  if (articlesToUse && articlesToUse.length > 0) {
    articlesContext = `\n\n📚 ARTIGOS DE AJUDA (${articlesToUse.length} selecionados):
═══════════════════════════════════════════════════════════════════
${articlesToUse.map(article => {
      const content = article.content || article.summary || "";
      const truncatedContent =
        content.length > maxArticleBodyLen ? content.substring(0, maxArticleBodyLen) + "..." : content;
      return `\n[ARTIGO #${article.id}] ${article.title}${article.category ? ` (Categoria: ${article.category})` : ""}${article.keywords ? `\nPalavras-chave: ${article.keywords}` : ""}${article.summary ? `\nResumo: ${article.summary}` : ""}\nConteúdo: ${truncatedContent}`;
    }).join("\n\n─────────────────────────────────────────────────────────────────────")}
═══════════════════════════════════════════════════════════════════`;
  }

  const systemContext = `Você é um ASSISTENTE DE IA para a empresa "${companyData.company}". Você tem acesso aos dados do sistema de atendimento via WhatsApp. Seu nome é Compuchat.

${systemManual}

📊 ESTATÍSTICAS: Tickets: ${companyData.stats.total.tickets} | Mensagens: ${companyData.stats.total.messages} | Contatos: ${companyData.stats.total.contacts} | Abertos: ${companyData.stats.ticketsByStatus.open} | Pendentes: ${companyData.stats.ticketsByStatus.pending} | Fechados: ${companyData.stats.ticketsByStatus.closed} | Hoje: ${companyData.stats.period.ticketsToday} tickets

👥 ATENDENTES (${companyData.users.length}): ${companyData.userTicketStats.slice(0, 5).map((s: any) => `${s.userName}: ${s.ticketsToday} hoje`).join(' | ') || 'Nenhum'}

📁 FILAS: ${companyData.queueStats.slice(0, 5).map((s: any) => `${s.queueName}: ${s.ticketsCount}`).join(' | ') || 'Nenhuma'}

📋 TICKETS RECENTES (${companyData.weekTickets.length}): ${weekTicketsList || 'Nenhum'}

💬 MENSAGENS RECENTES: ${
    isDetailed
      ? recentTicketsWithMessages || "Nenhuma"
      : "(Resumo: sem trechos de conversa neste modo. Peça detalhes das mensagens, cite um ticket #número ou mencione atendente/contato para carregar o histórico.)"
  }

${specificData}${articlesContext}

INSTRUÇÕES IMPORTANTES: 
- Use os dados acima para responder.
- PRIORIZE usar informações dos ARTIGOS DE AJUDA quando a pergunta do usuário estiver relacionada a eles.
- Quando responder com base em um artigo, mencione o título do artigo e cite o conteúdo relevante.
- Seja profissional, porém caloroso, prestativo e natural.
- Evite linguagem robótica ou excessivamente formal.
- Cite dados concretos quando disponíveis.
- Responda em português brasileiro.
- ⚠️ ATENÇÃO: Quando o usuário pedir para AGENDAR, MARCAR REUNIÃO, CRIAR COMPROMISSO ou qualquer tipo de agendamento, você NÃO deve tentar criar manualmente. O sistema processará automaticamente ANTES de você responder. Apenas responda normalmente após o processamento.
- ⚠️ ATENÇÃO: Quando o usuário pedir para CRIAR TAREFA ou LEMBRAR DE ALGO, você NÃO deve tentar criar manualmente. O sistema processará automaticamente ANTES de você responder. Apenas responda normalmente após o processamento.
- Se o usuário perguntar algo que não está nos dados ou artigos, informe educadamente que não encontrou a informação.`;

  const systemContextForLlm = truncateSystemPromptForLmStudio(systemContext);

  try {
    console.log(`📤 Enviando mensagem para ${provider.name}...`);
    console.log(`📊 Contexto: ${companyData.stats.total.tickets} tickets, ${companyData.users.length} usuários`);
    if (entities.matchedUsers.length > 0) {
      console.log(`👤 Atendentes detectados: ${entities.matchedUsers.map(u => u.name).join(", ")}`);
    }

    // Limitar histórico de mensagens conforme configuração
    const limitedHistory = conversationHistory.slice(-chatConfig.maxHistoryMessages);

    // Construir histórico no formato compatível com LM Studio / servidores locais:
    // evitar mensagem "assistant" logo após "system" sem um "user" intermediário.
    const chatMessages: ChatMessage[] = [];

    const firstTurnHint =
      "\n\nInstrução de abertura: na primeira resposta ao usuário, apresente-se como Compuchat de forma breve, " +
      "mencione que você tem acesso aos dados do sistema e ao manual, e convide a perguntar (tickets, métricas, uso do sistema).";

    const refreshHint =
      "\n\nO contexto de dados acima foi atualizado neste turno; use as informações mais recentes ao responder.";

    if (limitedHistory.length === 0) {
      chatMessages.push({
        role: "system",
        content: systemContextForLlm + firstTurnHint
      });
    } else {
      chatMessages.push({
        role: "system",
        content: systemContextForLlm + refreshHint
      });
      for (const hist of limitedHistory) {
        chatMessages.push({
          role: hist.role === "user" ? "user" : "assistant",
          content: hist.content
        });
      }
    }

    chatMessages.push({
      role: "user",
      content: message
    });

    // Usar o provider selecionado para realizar o chat com configurações personalizadas
    const text = await provider.chat(chatMessages, {
      temperature: chatConfig.temperature,
      maxTokens: chatConfig.maxTokens,
      topP: chatConfig.topP
    });

    if (!text || text.trim() === "") {
      throw new AppError("Resposta vazia da IA", 500);
    }

    // Sanitizar resposta final: remover caracteres de controle inválidos e garantir encoding correto
    const sanitizedResponse = text
      .trim()
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "") // Remover caracteres de controle exceto \n, \r, \t
      .replace(/\uFFFD/g, "") // Remover caracteres de substituição Unicode
      .replace(/\u0000/g, "") // Remover null bytes
      .normalize("NFC"); // Normalizar Unicode

    if (!sanitizedResponse || sanitizedResponse.trim() === "") {
      throw new AppError("Resposta vazia após sanitização", 500);
    }

    console.log(`✅ Resposta recebida do ${provider.name} (${sanitizedResponse.length} caracteres)`);

    return {
      response: sanitizedResponse.trim()
    };
  } catch (err: any) {
    console.error(`❌ Erro ao chamar ${provider.name} API (Chat):`, {
      message: err.message
    });

    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(`Erro no chat: ${err.message || "Erro desconhecido"}`, 500);
  }
};

export default ChatGeminiService;

