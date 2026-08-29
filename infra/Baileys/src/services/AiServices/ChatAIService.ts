import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import ShowTicketService from "../TicketServices/ShowTicketService";
import ShowPromptService from "../PromptServices/ShowPromptService";
import ListQueuesService from "../QueueService/ListQueuesService";
import { AIProviderSelector } from "./AIProviderSelector";
import {
  processPromptAiReplyActions,
  buildPromptActionFormattingInstructions,
  PendingAction
} from "./PromptReplyActionExecutor";

interface AnalyzeChatParams {
  ticketId: number;
  companyId: number;
  question?: string;
  suggestResponse?: boolean;
}

interface AudioSummaryParams {
  ticketId: number;
  companyId: number;
}

interface AnalyzeChatResponse {
  analysis: string;
  suggestions?: string[];
  keyPoints: string[];
}

interface AudioSummaryResponse {
  summary: string;
  audioCount: number;
  transcripts: Array<{
    messageId: string;
    timestamp: string;
    summary: string;
  }>;
}

interface ImproveMessageParams {
  ticketId: number;
  companyId: number;
  draftText?: string;
}

interface ImproveMessageResponse {
  improvedText: string;
  originalText?: string;
  /** Texto bruto da IA (com marcadores) para POST /chat-ai/apply-reply-actions quando houver ações. */
  modelReplyForActions?: string;
  pendingActions?: PendingAction[];
}

export interface ApplyChatReplyActionsParams {
  ticketId: number;
  companyId: number;
  userId: number;
  modelReply: string;
}

export interface ApplyChatReplyActionsResult {
  success: boolean;
  cleanedText: string;
  pendingActions: PendingAction[];
}

const resolvePromptForChatAI = async (ticket: Ticket, companyId: number): Promise<any | null> => {
  if (ticket.promptId) {
    try {
      const p = await ShowPromptService({ promptId: ticket.promptId, companyId });
      if (p) return p;
    } catch {
      /* ignore */
    }
  }
  const q = ticket.queue as any;
  if (q?.prompt) {
    return q.prompt;
  }
  const wa = await Whatsapp.findByPk(ticket.whatsappId, { attributes: ["id", "promptId"] });
  if (wa?.promptId) {
    try {
      return await ShowPromptService({ promptId: wa.promptId, companyId });
    } catch {
      /* ignore */
    }
  }
  return null;
};

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

// Função removida - agora usamos provider.generateText diretamente

// Buscar últimas 20 mensagens do ticket
const fetchLastMessages = async (
  ticketId: number,
  companyId: number,
  sessionStartedAt?: Date
): Promise<any[]> => {
  const whereMessages: any = {
    ticketId,
    companyId,
    isDeleted: false
  };
  if (sessionStartedAt) {
    whereMessages.createdAt = { [Op.gte]: sessionStartedAt };
  }

  const messages = await Message.findAll({
    where: whereMessages,
    include: [
      "contact"
    ],
    order: [["createdAt", "DESC"]],
    limit: 100,
    raw: false
  });

  return messages.reverse().map((msg: any) => ({
    id: msg.id,
    body: msg.body || "",
    fromMe: msg.fromMe,
    createdAt: formatDateTime(msg.createdAt),
    sender: msg.fromMe ? "ATENDENTE" : "CLIENTE",
    contactName: msg.contact?.name || "Desconhecido",
    mediaType: msg.mediaType,
    mediaUrl: msg.mediaUrl
  }));
};

// Analisar contexto do chat
export const analyzeChatContext = async ({
  ticketId,
  companyId,
  question,
  suggestResponse = false
}: AnalyzeChatParams): Promise<AnalyzeChatResponse> => {
  // Selecionar provider usando configuração automática (usa "chat" como tipo)
  const provider = await AIProviderSelector.getProvider(companyId, "chat");

  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Buscar informações do ticket
  const ticketData = await Ticket.findByPk(ticketId, {
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: User, attributes: ["id", "name"] },
      { model: Queue, attributes: ["id", "name"] }
    ]
  });

  // Buscar últimas 20 mensagens
  const messages = await fetchLastMessages(ticketId, companyId, ticket.sessionStartedAt);

  if (messages.length === 0) {
    throw new AppError("ERR_NO_MESSAGES_FOUND", 404);
  }

  // Construir contexto das mensagens
  const messagesContext = messages.map((msg, index) => {
    return `[${msg.createdAt}] ${msg.sender} (${msg.contactName}): ${msg.body || "[Mídia]"}`;
  }).join("\n");

  // Construir prompt
  let systemPrompt = `Você é o Compuchat, um assistente de IA especializado em análise de conversas de atendimento.

CONTEXTO DO TICKET:
- Status: ${ticketData.status}
- Contato: ${ticketData.contact?.name || "Desconhecido"}
- Atendente: ${ticketData.user?.name || "Sem atendente"}
- Fila: ${ticketData.queue?.name || "Sem fila"}
- Criado em: ${formatDateTime(ticketData.createdAt)}
- Última atualização: ${formatDateTime(ticketData.updatedAt)}

ÚLTIMAS ${messages.length} MENSAGENS DA CONVERSA:
${messagesContext}

INSTRUÇÕES:
${suggestResponse
      ? `- Analise o contexto da conversa
- Gere 3-5 sugestões de resposta curtas e objetivas que o atendente pode usar
- As sugestões devem ser profissionais, empáticas e diretas
- Foque em resolver o problema do cliente de forma eficiente`
      : question
        ? `- Responda a seguinte pergunta do usuário sobre a conversa: "${question}"
- Seja objetivo e preciso
- Use apenas as informações fornecidas no contexto`
        : `- Analise o contexto da conversa
- Identifique os pontos principais discutidos
- Resuma a situação atual do atendimento
- Destaque informações importantes que o atendente deve saber
- Seja profissional, empático e prestativo
- Evite linguagem muito robótica`}

FORMATO DE RESPOSTA:
${suggestResponse
      ? `Retorne APENAS um JSON válido com este formato:
{
  "suggestions": ["sugestão 1", "sugestão 2", "sugestão 3"],
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"]
}`
      : `Retorne APENAS um JSON válido com este formato:
{
  "analysis": "análise detalhada da conversa",
  "keyPoints": ["ponto principal 1", "ponto principal 2", "ponto principal 3"]
}`}`;

  try {
    // Usar o provider selecionado para gerar a análise
    const responseText = await provider.generateText(systemPrompt, {
      temperature: 0.3,
      maxTokens: 4096,
      topP: 0.95
    });

    // Tentar extrair JSON da resposta
    let parsedResponse: any = {};
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        // Se não encontrar JSON, usar resposta completa como análise
        parsedResponse = {
          analysis: responseText,
          keyPoints: []
        };
      }
    } catch (parseError) {
      parsedResponse = {
        analysis: responseText,
        keyPoints: []
      };
    }

    return {
      analysis: parsedResponse.analysis || responseText,
      suggestions: parsedResponse.suggestions || [],
      keyPoints: parsedResponse.keyPoints || []
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(`Erro ao processar análise do chat: ${error.message || "Erro desconhecido"}`, 500);
  }
};

// Resumir áudios não ouvidos
export const summarizeUnreadAudios = async ({
  ticketId,
  companyId
}: AudioSummaryParams): Promise<AudioSummaryResponse> => {
  // Selecionar provider usando configuração automática (usa "chat" como tipo, mas poderia ter um específico)
  const provider = await AIProviderSelector.getProvider(companyId, "chat");

  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Buscar mensagens de áudio não ouvidas
  const audioMessages = await Message.findAll({
    where: {
      ticketId,
      companyId,
      read: false,
      mediaType: "audio",
      isDeleted: false
    },
    include: [
      "contact"
    ],
    order: [["createdAt", "ASC"]],
    raw: false
  });

  if (audioMessages.length === 0) {
    return {
      summary: "Nenhum áudio não ouvido encontrado neste ticket.",
      audioCount: 0,
      transcripts: []
    };
  }

  // Construir contexto dos áudios
  const audioContext = audioMessages.map((msg: any, index: number) => {
    const timestamp = formatDateTime(msg.createdAt);
    const sender = msg.fromMe ? "ATENDENTE" : "CLIENTE";
    const contactName = msg.contact?.name || "Desconhecido";

    // Se houver transcrição no body, usar. Caso contrário, indicar que precisa transcrição
    const transcript = msg.body && msg.body.trim()
      ? msg.body
      : "[Áudio sem transcrição disponível]";

    return `ÁUDIO ${index + 1}:
- Data/Hora: ${timestamp}
- Remetente: ${sender} (${contactName})
- Transcrição: ${transcript}`;
  }).join("\n\n");

  const systemPrompt = `Você é o Compuchat, um assistente de IA especializado em resumir conversas de áudio.

CONTEXTO:
Foram recebidos ${audioMessages.length} áudio(s) não ouvido(s) neste ticket de atendimento.

TRANSCRIÇÕES DOS ÁUDIOS:
${audioContext}

INSTRUÇÕES:
- Crie um resumo objetivo e conciso de todos os áudios
- Destaque os pontos principais mencionados em cada áudio
- Organize por ordem cronológica
- Seja claro e direto
- Se algum áudio não tiver transcrição, indique isso no resumo

FORMATO:
Retorne APENAS um JSON válido:
{
  "summary": "resumo completo dos áudios",
  "transcripts": [
    {
      "messageId": "id da mensagem",
      "timestamp": "data/hora",
      "summary": "resumo deste áudio específico"
    }
  ]
}`;

  try {
    // Usar o provider selecionado para gerar o resumo
    const responseText = await provider.generateText(systemPrompt, {
      temperature: 0.3,
      maxTokens: 4096,
      topP: 0.95
    });

    // Tentar extrair JSON da resposta
    let parsedResponse: any = {};
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = {
          summary: responseText,
          transcripts: []
        };
      }
    } catch (parseError) {
      parsedResponse = {
        summary: responseText,
        transcripts: []
      };
    }

    // Garantir que temos os IDs corretos nos transcripts
    const transcripts = audioMessages.map((msg: any, index: number) => ({
      messageId: msg.id,
      timestamp: formatDateTime(msg.createdAt),
      summary: parsedResponse.transcripts?.[index]?.summary || `Áudio ${index + 1}`
    }));

    return {
      summary: parsedResponse.summary || responseText,
      audioCount: audioMessages.length,
      transcripts
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(`Erro ao processar resumo de áudios: ${error.message || "Erro desconhecido"}`, 500);
  }
};

// Melhorar texto da mensagem
export const improveMessage = async ({
  ticketId,
  companyId,
  draftText = ""
}: ImproveMessageParams): Promise<ImproveMessageResponse> => {
  const provider = await AIProviderSelector.getProvider(companyId, "messageImprovement");

  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const promptForActions = await resolvePromptForChatAI(ticket, companyId);
  const availableQueues = await ListQueuesService({ companyId });
  const queuesList = availableQueues.map(q => `- ${q.name} (ID: ${q.id})`).join("\n");
  const tagsForPrompt =
    promptForActions?.canChangeTag === true
      ? await Tag.findAll({ where: { companyId } })
      : [];
  const tagsList = tagsForPrompt.map(t => `- ${t.name} (ID: ${t.id})`).join("\n");
  const actionInstructions = promptForActions
    ? buildPromptActionFormattingInstructions(promptForActions, queuesList, tagsList)
    : "";

  const messages = await fetchLastMessages(ticketId, companyId, ticket.sessionStartedAt);

  const messagesContext =
    messages.length > 0
      ? messages
          .map((msg) => {
            return `[${msg.createdAt}] ${msg.sender} (${msg.contactName}): ${msg.body || "[Mídia]"}`;
          })
          .join("\n")
      : "Nenhuma mensagem anterior na conversa.";

  const contactName = ticket.contact?.name || "Desconhecido";
  const actionHint = actionInstructions
    ? `\n\nSe o prompt da empresa permitir, pode incluir no MESMO texto que será enviado ao cliente: notas internas [INTERNA]...[/INTERNA], transferência de fila, alteração de tag ou blocos [AGENDAR]...[/AGENDAR], conforme as instruções abaixo.${actionInstructions}`
    : "";

  let systemPrompt = `Você é o Compuchat, um assistente de IA especializado em melhorar mensagens de atendimento ao cliente.

CONTEXTO DO TICKET:
- Status: ${ticket.status}
- Contato: ${contactName}
- Atendente: ${(ticket as any).user?.name || "Sem atendente"}
- Fila: ${(ticket as any).queue?.name || "Sem fila"}

ÚLTIMAS MENSAGENS DA CONVERSA:
${messagesContext}
${actionHint}

${draftText.trim()
      ? `RASCUNHO DA MENSAGEM DO ATENDENTE:
"${draftText}"

INSTRUÇÕES:
- Melhore o rascunho acima considerando o contexto da conversa
- Corrija erros de gramática e ortografia
- Ajuste o tom para ser profissional, empático e adequado ao contexto
- Mantenha a intenção e o significado original
- Se necessário, adicione informações relevantes do contexto da conversa
- Mantenha a mensagem clara, objetiva e apropriada para atendimento ao cliente
- Use o nome do cliente quando apropriado: ${contactName}
- Seja respeitoso e prestativo

IMPORTANTE: Retorne APENAS o texto melhorado (e marcadores de ação, se aplicável), sem explicações ou comentários adicionais.`
      : `INSTRUÇÕES:
- Com base no contexto da conversa acima, sugira uma resposta completa e apropriada
- A resposta deve ser profissional, empática e adequada ao contexto
- Considere o status do ticket e o histórico da conversa
- Use o nome do cliente quando apropriado: ${contactName}
- Seja respeitoso, prestativo e direto
- A resposta deve ajudar a resolver a situação do cliente de forma eficiente

IMPORTANTE: Retorne APENAS o texto da resposta sugerida (e marcadores de ação, se aplicável), sem explicações ou comentários adicionais.`}`;

  try {
    console.log(`📤 Enviando requisição para ${provider.name} - Melhorar mensagem...`);
    const textResponse = await provider.generateText(systemPrompt, {
      temperature: draftText.trim() ? 0.4 : 0.6,
      maxTokens: 2048
    });

    console.log(`✅ Texto melhorado gerado com sucesso usando ${provider.name} (${textResponse.length} caracteres)`);

    const normalizedLlm = textResponse
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*["']|["']\s*$/g, "")
      .trim();

    let improvedText = normalizedLlm || draftText.trim() || "Desculpe, não foi possível melhorar a mensagem.";
    let modelReplyForActions: string | undefined;
    let pendingActions: PendingAction[] = [];

    if (promptForActions && ticket.contact) {
      const availableTags = await Tag.findAll({ where: { companyId } });
      const dry = await processPromptAiReplyActions({
        response: normalizedLlm,
        prompt: promptForActions,
        ticket,
        contact: ticket.contact as Contact,
        availableQueues,
        availableTags,
        execute: false,
        channel: "agent_panel"
      });
      improvedText = dry.cleanedResponse.trim() || improvedText;
      pendingActions = dry.pendingActions;
      if (pendingActions.length > 0) {
        modelReplyForActions = normalizedLlm;
      }
    }

    return {
      improvedText,
      originalText: draftText.trim() || undefined,
      modelReplyForActions,
      pendingActions: pendingActions.length ? pendingActions : undefined
    };
  } catch (err: any) {
    console.error(`❌ Erro ao melhorar mensagem com ${provider.name}:`, {
      message: err.message
    });

    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(`Erro ao melhorar mensagem: ${err.message || "Erro desconhecido"}`, 500);
  }
};

export const applyChatModelReplyActions = async ({
  ticketId,
  companyId,
  userId: _userId,
  modelReply
}: ApplyChatReplyActionsParams): Promise<ApplyChatReplyActionsResult> => {
  if (!modelReply || !String(modelReply).trim()) {
    throw new AppError("modelReply é obrigatório", 400);
  }

  const ticket = await ShowTicketService(ticketId, companyId);
  const prompt = await resolvePromptForChatAI(ticket, companyId);
  if (!prompt) {
    throw new AppError("Prompt não encontrado para executar ações neste ticket.", 400);
  }
  const contact = ticket.contact as Contact;
  if (!contact) {
    throw new AppError("Contato não encontrado no ticket.", 400);
  }

  const availableQueues = await ListQueuesService({ companyId });
  const availableTags = await Tag.findAll({ where: { companyId } });

  const { cleanedResponse, pendingActions } = await processPromptAiReplyActions({
    response: modelReply,
    prompt,
    ticket,
    contact,
    availableQueues,
    availableTags,
    execute: true,
    channel: "agent_panel"
  });

  return {
    success: true,
    cleanedText: cleanedResponse,
    pendingActions
  };
};

interface GenerateTicketInfoParams {
  ticketId: number;
  companyId: number;
}

interface GenerateTicketInfoResponse {
  title: string;
  description: string;
  clientName: string;
}

// Gerar informações do ticket para criação em sistema externo
export const generateTicketInfo = async ({
  ticketId,
  companyId
}: GenerateTicketInfoParams): Promise<GenerateTicketInfoResponse> => {
  // Selecionar provider usando configuração automática (usa "messageImprovement" como tipo)
  const provider = await AIProviderSelector.getProvider(companyId, "messageImprovement");

  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Buscar informações do ticket
  const ticketData = await Ticket.findByPk(ticketId, {
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: User, attributes: ["id", "name"] },
      { model: Queue, attributes: ["id", "name"] }
    ]
  });

  if (!ticketData) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // Buscar últimas 20 mensagens para contexto
  const messages = await fetchLastMessages(ticketId, companyId, ticket.sessionStartedAt);

  // Construir contexto das mensagens
  const messagesContext = messages.length > 0
    ? messages.map((msg, index) => {
      return `[${msg.createdAt}] ${msg.sender} (${msg.contactName}): ${msg.body || "[Mídia]"}`;
    }).join("\n")
    : "Nenhuma mensagem anterior na conversa.";

  // Construir prompt para gerar informações do ticket
  const systemPrompt = `Você é o Compuchat, um assistente de IA especializado em criar tickets de atendimento.

CONTEXTO DO TICKET:
- Status: ${ticketData.status}
- Contato: ${ticketData.contact?.name || "Desconhecido"}
- Número do Contato: ${ticketData.contact?.number || "Não informado"}
- Atendente: ${ticketData.user?.name || "Sem atendente"}
- Fila: ${ticketData.queue?.name || "Sem fila"}
- Criado em: ${formatDateTime(ticketData.createdAt)}

ÚLTIMAS 20 MENSAGENS DA CONVERSA:
${messagesContext}

INSTRUÇÕES:
- Analise o contexto da conversa acima
- Gere um TÍTULO curto e objetivo (máximo 100 caracteres) que resuma o problema principal
- Gere uma DESCRIÇÃO detalhada (máximo 500 caracteres) que explique o problema e o contexto
- Use o NOME DO CLIENTE exatamente como aparece no contexto: "${ticketData.contact?.name || "Cliente"}"
- O título deve ser claro e direto
- A descrição deve incluir informações relevantes do contexto da conversa
- Seja objetivo e profissional

IMPORTANTE: Retorne APENAS um JSON válido com este formato exato:
{
  "title": "título do ticket",
  "description": "descrição detalhada do ticket",
  "clientName": "nome do cliente"
}

Não inclua explicações, comentários ou texto adicional. Apenas o JSON.`;

  try {
    console.log(`📤 Enviando requisição para ${provider.name} - Gerar informações do ticket...`);
    const textResponse = await provider.generateText(systemPrompt, {
      temperature: 0.3,
      maxTokens: 1024
    });

    console.log(`✅ Informações do ticket geradas com sucesso usando ${provider.name}`);

    // Extrair JSON da resposta
    let parsedResponse: any = {};
    try {
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSON não encontrado na resposta");
      }
    } catch (parseError) {
      console.error("Erro ao parsear JSON:", parseError);
      // Fallback: usar informações básicas do ticket
      parsedResponse = {
        title: `Atendimento - ${ticketData.contact?.name || "Cliente"}`,
        description: messagesContext.substring(0, 500) || "Sem descrição disponível",
        clientName: ticketData.contact?.name || "Cliente"
      };
    }

    // Garantir que todos os campos existem
    return {
      title: parsedResponse.title || `Atendimento - ${ticketData.contact?.name || "Cliente"}`,
      description: parsedResponse.description || messagesContext.substring(0, 500) || "Sem descrição disponível",
      clientName: parsedResponse.clientName || ticketData.contact?.name || "Cliente"
    };
  } catch (err: any) {
    console.error(`❌ Erro ao gerar informações do ticket com ${provider.name}:`, {
      message: err.message
    });

    if (err instanceof AppError) {
      throw err;
    }

    // Fallback: retornar informações básicas
    return {
      title: `Atendimento - ${ticketData.contact?.name || "Cliente"}`,
      description: messagesContext.substring(0, 500) || "Sem descrição disponível",
      clientName: ticketData.contact?.name || "Cliente"
    };
  }
};
