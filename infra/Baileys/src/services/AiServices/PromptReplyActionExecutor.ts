import Company from "../../models/Company";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import CreateMessageService, { MessageData } from "../MessageServices/CreateMessageService";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import SyncTags from "../TagServices/SyncTagsService";
import ParseAppointmentCommand from "../AppointmentAIService/ParseAppointmentCommand";
import generateContextSummary from "./GenerateContextSummaryService";
import { logger } from "../../utils/logger";
import type User from "../../models/User";
import { createComputicketAppointment } from "../../helpers/computicketAgentApi";
import {
  parseAgendaCommands,
  parseUserTransferName,
  shouldForceKnowledgeHandoff
} from "./aiAgentActions";

export type PromptReplyChannel = "whatsapp" | "agent_panel";

export type PendingAction =
  | { type: "internal_notes"; bodies: string[] }
  | { type: "change_tag"; tagName: string }
  | { type: "transfer_queue"; queueId: number | null; queueName: string | null }
  | { type: "transfer_user"; userId: number | null; userName: string | null }
  | { type: "transfer_wait_only" }
  | { type: "agendar_commands"; commands: string[] }
  | { type: "agenda_commands"; commands: string[] };

export interface ProcessPromptReplyActionsParams {
  response: string;
  prompt: any;
  ticket: Ticket;
  contact: Contact;
  availableQueues: Queue[];
  availableTags: Tag[];
  execute: boolean;
  channel: PromptReplyChannel;
  /** Obrigatório no modo WhatsApp quando `canTransferToAgent` é false (mensagem de espera). */
  sendWhatsAppToCustomer?: (text: string) => Promise<void>;
  availableUsers?: Array<Pick<User, "id" | "name">>;
  knowledge?: { hasEvidence: boolean; userText: string };
}

export interface ProcessPromptReplyActionsResult {
  cleanedResponse: string;
  pendingActions: PendingAction[];
}

/**
 * Blocos de instrução para o modelo (filas, tags, interna, agendar) — alinhado a handleOpenAi.
 */
export const buildPromptActionFormattingInstructions = (
  prompt: any,
  queuesList: string,
  tagsList: string,
  usersList = ""
): string => {
  if (!prompt) return "";
  let extra = "";
  if (prompt.canTransferToAgent) {
    extra += `\n\nFILAS DISPONÍVEIS PARA TRANSFERÊNCIA:\n${queuesList}\n\nIMPORTANTE: Seja direto e objetivo. Para transferir, use o formato: 'Ação: Transferir para o setor de atendimento [Fila: Nome da Fila]' ou apenas 'Ação: Transferir para o setor de atendimento' para usar a fila padrão.`;
  }
  if (prompt.canTransferToUser) {
    extra += `\n\nATENDENTES DISPONÍVEIS:\n${usersList || "(nenhum)"}\n\nPara transferir a uma pessoa, use: 'Ação: Transferir para o atendente [Usuário: Nome]'.`;
  }
  if (prompt.canChangeTag && tagsList) {
    extra += `\n\nTAGS DISPONÍVEIS PARA ALTERAÇÃO:\n${tagsList}\n\nPara alterar a tag/estágio do ticket, use o formato: 'Ação: Alterar tag [Tag: Nome da Tag]'`;
  }
  if (prompt.canSendInternalMessages) {
    extra += `\n\nANOTAÇÕES INTERNAS: Use [INTERNA]texto[/INTERNA] ANTES ou DEPOIS da resposta ao cliente. Sempre forneça resposta ao cliente.`;
  }
  if (prompt.permitirCriarAgendamentos) {
    extra += `\n\nAGENDAMENTOS: Use [AGENDAR]{"action":"criar|verificar|listar","profissional":"Nome","data":"YYYY-MM-DD","horarioInicio":"HH:mm","horarioFim":"HH:mm"(opcional),"titulo":"Título","descricao":"Desc"(opcional)}[/AGENDAR]. Execute comandos IMEDIATAMENTE sem dizer "vou verificar". Verifique disponibilidade antes de criar. Remova tags [AGENDAR] da resposta final.`;
    extra += `\n\nVISITA NA AGENDA: Use [AGENDA]{"title":"Título","appointment_date":"YYYY-MM-DDTHH:mm:ss","tecnico":"Nome do técnico","description":"Detalhe"}[/AGENDA]. O cliente é o contato desta conversa. Confirme data, horário e técnico antes de incluir o bloco. Não diga que a visita foi marcada sem o bloco [AGENDA].`;
  }
  return extra;
};

const persistInternalNote = async (
  ticket: Ticket,
  companyId: number,
  body: string
): Promise<void> => {
  const messageData: MessageData = {
    id: `${ticket.id}-${Date.now()}-${Math.random()}`,
    body: body.trim(),
    ticketId: ticket.id,
    contactId: ticket.contactId,
    fromMe: true,
    read: true,
    isInternal: true,
    mediaType: "conversation"
  };
  await CreateMessageService({ messageData, companyId });
};

/**
 * Pós-processamento da resposta do modelo: internas, [AGENDAR], tags, transferência.
 * `execute: false` apenas limpa o texto e preenche `pendingActions` (painel / pré-visualização).
 */
export const processPromptAiReplyActions = async (
  params: ProcessPromptReplyActionsParams
): Promise<ProcessPromptReplyActionsResult> => {
  const {
    response,
    prompt,
    ticket,
    contact,
    availableQueues,
    availableTags,
    execute,
    channel,
    sendWhatsAppToCustomer,
    availableUsers = [],
    knowledge
  } = params;

  const companyId = ticket.companyId;
  const writeTransferSummary = async (destination: string): Promise<void> => {
    try {
      const summary = await generateContextSummary({
        ticketId: ticket.id,
        companyId,
        provider: prompt.provider || "gemini",
        maxMessages: Math.max(Number(prompt.maxMessages) || 12, 8)
      });
      await persistInternalNote(
        ticket,
        companyId,
        `📋 RESUMO DA TRANSFERÊNCIA (${destination}):\n\n${summary}`
      );
      logger.info(`Resumo interno gravado na transferência do ticket ${ticket.id} para ${destination}`);
    } catch (err: any) {
      logger.error(`Erro ao gravar resumo da transferência: ${err.message}`);
    }
  };
  let cleanedResponse = response || "";
  const pendingActions: PendingAction[] = [];
  const internalMessages: string[] = [];
  let strippedAnyInternal = false;

  if (prompt.canSendInternalMessages) {
    const internalMessageRegex = /\[INTERNA\](.*?)\[\/INTERNA\]/gs;
    const processedMatches = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = internalMessageRegex.exec(response || "")) !== null) {
      const fullMatch = match[0];
      const internalContent = match[1].trim();
      if (internalContent && !processedMatches.has(fullMatch)) {
        processedMatches.add(fullMatch);
        internalMessages.push(internalContent);
        cleanedResponse = cleanedResponse.replace(fullMatch, "").trim();
      }
    }

    const openInternalRegex = /\[INTERNA\][^\[]*?(?=\[INTERNA\]|$)/gs;
    while ((match = openInternalRegex.exec(cleanedResponse)) !== null) {
      const fullMatch = match[0];
      const internalContent = match[0].replace(/\[INTERNA\]/g, "").trim();
      if (internalContent && !fullMatch.includes("[/INTERNA]") && !processedMatches.has(fullMatch)) {
        processedMatches.add(fullMatch);
        internalMessages.push(internalContent);
        cleanedResponse = cleanedResponse.replace(fullMatch, "").trim();
      }
    }

    cleanedResponse = cleanedResponse
      .replace(/\[INTERNA\][^\[]*?/g, "")
      .replace(/\[\/INTERNA\]/g, "")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim();

    const uniqueInternalMessages = [...new Set(internalMessages)];
    if (uniqueInternalMessages.length) {
      strippedAnyInternal = true;
      pendingActions.push({ type: "internal_notes", bodies: uniqueInternalMessages });
      if (execute) {
        for (const internalContent of uniqueInternalMessages) {
          if (internalContent.trim()) {
            try {
              await persistInternalNote(ticket, companyId, internalContent);
              logger.info(`✅ Mensagem interna: ${internalContent.substring(0, 50)}...`);
            } catch (err: any) {
              logger.error(`❌ Erro ao enviar mensagem interna: ${err.message}`);
            }
          }
        }
      }
    }
  }

  if (prompt.permitirCriarAgendamentos && response) {
    const appointmentCommandRegex = /\[AGENDAR\](.*?)\[\/AGENDAR\]/gs;
    const appointmentCommands: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = appointmentCommandRegex.exec(response)) !== null) {
      const commandContent = m[1].trim();
      if (commandContent) appointmentCommands.push(commandContent);
    }

    if (appointmentCommands.length) {
      pendingActions.push({ type: "agendar_commands", commands: appointmentCommands });

      if (execute) {
        const phrasesToRemove = [
          /vou verificar[^.]*/gi,
          /vou checar[^.]*/gi,
          /um momento[^.]*/gi,
          /aguarde[^.]*/gi,
          /por favor[^.]*/gi,
          /desculpe pela (demora|confusão)[^.]*/gi,
          /desculpe[^.]*/gi
        ];
        for (const phraseRegex of phrasesToRemove) {
          cleanedResponse = cleanedResponse.replace(phraseRegex, "").trim();
        }

        for (const command of appointmentCommands) {
          try {
            const result = await ParseAppointmentCommand({
              command: `[AGENDAR]${command}[/AGENDAR]`,
              companyId: ticket.companyId,
              contactId: contact.id,
              ticketId: ticket.id,
              allowCreate: prompt.permitirCriarAgendamentos
            });

            if (result.success && result.message) {
              cleanedResponse = cleanedResponse.replace(/\[AGENDAR\].*?\[\/AGENDAR\]/gs, result.message);
              logger.info(`✅ Comando de agendamento processado: ${result.message}`);
            } else {
              const errorMsg = result.message || result.error || "Erro ao processar agendamento";
              cleanedResponse = cleanedResponse.replace(/\[AGENDAR\].*?\[\/AGENDAR\]/gs, errorMsg);
              logger.error(`❌ Erro ao processar comando de agendamento: ${result.error}`);
            }
          } catch (err: any) {
            logger.error(`❌ Erro ao processar comando de agendamento: ${err.message}`);
            cleanedResponse = cleanedResponse.replace(
              /\[AGENDAR\].*?\[\/AGENDAR\]/gs,
              "Erro ao processar comando de agendamento. Tente novamente."
            );
          }
        }

        cleanedResponse = cleanedResponse
          .replace(/\n\s*\n\s*\n/g, "\n\n")
          .replace(/^\s+|\s+$/g, "")
          .trim();
      } else {
        cleanedResponse = cleanedResponse.replace(/\[AGENDAR\].*?\[\/AGENDAR\]/gs, "").trim();
      }
    }
  }

  const agendaCommands = prompt.permitirCriarAgendamentos ? parseAgendaCommands(response || "") : [];
  if (agendaCommands.length) {
    pendingActions.push({
      type: "agenda_commands",
      commands: agendaCommands.map(command => JSON.stringify(command))
    });
    if (execute) {
      for (const command of agendaCommands) {
        try {
          const result = await createComputicketAppointment({
            engine_contact_id: contact.id,
            contact_number: contact.number,
            title: command.title,
            appointment_date: command.appointment_date,
            tecnico: command.tecnico,
            user_id: command.user_id,
            description: command.description
          });
          cleanedResponse = cleanedResponse.replace(
            /\[AGENDA\][\s\S]*?\[\/AGENDA\]/i,
            result.message
          );
        } catch (err: any) {
          logger.error(`Erro ao criar agendamento no Computicket: ${err.message}`);
          cleanedResponse = cleanedResponse.replace(
            /\[AGENDA\][\s\S]*?\[\/AGENDA\]/i,
            "Não consegui criar o agendamento agora. Pode repetir a data e o técnico?"
          );
        }
      }
    } else {
      cleanedResponse = cleanedResponse.replace(/\[AGENDA\][\s\S]*?\[\/AGENDA\]/gi, "").trim();
    }
  } else if ((response || "").includes("[AGENDA]")) {
    cleanedResponse = cleanedResponse.replace(/\[AGENDA\][\s\S]*?\[\/AGENDA\]/gi, "").trim();
  }

  if (prompt.canChangeTag && response?.includes("Ação: Alterar tag")) {
    const tagMatch = response.match(/\[Tag:\s*([^\]]+)\]/i);
    if (tagMatch && tagMatch[1]) {
      const specifiedTagName = tagMatch[1].trim();
      pendingActions.push({ type: "change_tag", tagName: specifiedTagName });
      const matchedTag = availableTags.find(t => t.name.toLowerCase() === specifiedTagName.toLowerCase());
      if (execute && matchedTag) {
        try {
          await SyncTags({ tags: [matchedTag], ticketId: ticket.id });
          logger.info(`Tag alterada para "${matchedTag.name}" no ticket ${ticket.id}`);
        } catch (err: any) {
          logger.error(`Erro ao alterar tag: ${err.message}`);
        }
      } else if (execute && !matchedTag) {
        logger.warn(`Tag especificada pela IA não encontrada: "${specifiedTagName}"`);
      }
    }
    cleanedResponse = cleanedResponse
      .replace(/Ação: Alterar tag\s*\[Tag:[^\]]+\]/gi, "")
      .replace(/Ação: Alterar tag/gi, "")
      .trim();
  }

  if (response?.includes("Ação: Transferir para o setor de atendimento")) {
    if (!prompt.canTransferToAgent) {
      pendingActions.push({ type: "transfer_wait_only" });
      if (execute && channel === "whatsapp" && sendWhatsAppToCustomer) {
        const company = await Company.findByPk(ticket.companyId);
        const language = company?.language || "pt";
        const waitMessage = {
          pt: "Aguarde que algum de nossos atendentes já irá lhe atender.",
          en: "Please wait, one of our attendants will assist you shortly.",
          es: "Por favor espere, uno de nuestros atendentes le atenderá en breve."
        };
        const messageText = waitMessage[language as keyof typeof waitMessage] || waitMessage.pt;
        await sendWhatsAppToCustomer(messageText);
      }
      cleanedResponse = cleanedResponse
        .replace(/Ação: Transferir para o setor de atendimento\s*\[Fila:[^\]]+\]/gi, "")
        .replace(/Ação: Transferir para o setor de atendimento/gi, "")
        .trim();
    } else {
      let targetQueueId: number | null = null;
      let targetQueueName: string | null = null;
      const queueMatch = response.match(/\[Fila:\s*([^\]]+)\]/i);
      if (queueMatch && queueMatch[1]) {
        const specifiedQueueName = queueMatch[1].trim();
        const matchedQueue = availableQueues.find(
          q => q.name.toLowerCase() === specifiedQueueName.toLowerCase()
        );
        if (matchedQueue) {
          targetQueueId = matchedQueue.id;
          targetQueueName = matchedQueue.name;
          logger.info(`IA especificou fila: "${specifiedQueueName}" -> ID: ${targetQueueId}`);
        } else {
          logger.warn(`Fila especificada pela IA não encontrada: "${specifiedQueueName}". Usando fila padrão.`);
        }
      }
      if (!targetQueueId) {
        targetQueueId = prompt.transferQueueId || prompt.queueId || null;
        const defaultQueue = availableQueues.find(q => q.id === targetQueueId);
        targetQueueName = defaultQueue?.name || null;
        if (targetQueueId) {
          logger.info(`Usando fila padrão configurada: ID ${targetQueueId}`);
        }
      }

      pendingActions.push({
        type: "transfer_queue",
        queueId: targetQueueId,
        queueName: targetQueueName
      });

      if (execute && targetQueueId) {
        await writeTransferSummary(`fila ${targetQueueName || targetQueueId}`);
        await UpdateTicketService({
          ticketData: { queueId: targetQueueId },
          ticketId: ticket.id,
          companyId: ticket.companyId
        });
        logger.info(`Ticket ${ticket.id} transferido para fila ${targetQueueId} (${targetQueueName})`);
      } else if (execute && !targetQueueId) {
        logger.error(`Nenhuma fila disponível para transferência do ticket ${ticket.id}`);
      }

      cleanedResponse = cleanedResponse
        .replace(/Ação: Transferir para o setor de atendimento\s*\[Fila:[^\]]+\]/gi, "")
        .replace(/Ação: Transferir para o setor de atendimento/gi, "")
        .trim();
    }
  }

  const requestedUserName = parseUserTransferName(response || "");
  if (requestedUserName !== null && prompt.canTransferToUser) {
    const matchedUser = availableUsers.find(
      user => user.name && requestedUserName && user.name.toLowerCase() === requestedUserName.toLowerCase()
    );
    pendingActions.push({
      type: "transfer_user",
      userId: matchedUser?.id || null,
      userName: matchedUser?.name || requestedUserName || null
    });
    if (execute && matchedUser) {
      await writeTransferSummary(`atendente ${matchedUser.name}`);
      await UpdateTicketService({
        ticketData: {
          queueId: ticket.queueId,
          userId: matchedUser.id,
          status: "open"
        },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
      logger.info(`Ticket ${ticket.id} transferido para o usuário ${matchedUser.id} (${matchedUser.name})`);
    } else if (execute && requestedUserName) {
      logger.warn(`Atendente informado pela IA não encontrado: "${requestedUserName}"`);
    }
    cleanedResponse = cleanedResponse
      .replace(/Ação:\s*Transferir para o atendente\s*\[Usuário:[^\]]+\]/gi, "")
      .replace(/Ação:\s*Transferir para o atendente/gi, "")
      .trim();
  } else if (requestedUserName !== null) {
    cleanedResponse = cleanedResponse
      .replace(/Ação:\s*Transferir para o atendente\s*\[Usuário:[^\]]+\]/gi, "")
      .replace(/Ação:\s*Transferir para o atendente/gi, "")
      .trim();
  }

  const alreadyTransferring = pendingActions.some(
    action => action.type === "transfer_queue" || action.type === "transfer_user" || action.type === "transfer_wait_only"
  );
  const alreadyScheduling = pendingActions.some(
    action => action.type === "agenda_commands" || action.type === "agendar_commands"
  );
  if (
    knowledge &&
    shouldForceKnowledgeHandoff({
      answerFromKnowledge: !!prompt.answerFromKnowledge,
      hasEvidence: !!knowledge.hasEvidence,
      userText: knowledge.userText || "",
      alreadyTransferring,
      alreadyScheduling
    })
  ) {
    const fallbackQueueId = prompt.fallbackQueueId || prompt.transferQueueId || prompt.queueId || null;
    const fallbackUserId = prompt.fallbackUserId || null;
    pendingActions.push({
      type: "transfer_queue",
      queueId: fallbackQueueId,
      queueName: null
    });
    if (fallbackUserId) {
      pendingActions.push({
        type: "transfer_user",
        userId: fallbackUserId,
        userName: null
      });
    }
    if (execute && (fallbackQueueId || fallbackUserId)) {
      const destination = [
        fallbackQueueId
          ? `fila ${availableQueues.find(queue => queue.id === fallbackQueueId)?.name || fallbackQueueId}`
          : "",
        fallbackUserId
          ? `atendente ${availableUsers.find(user => user.id === fallbackUserId)?.name || fallbackUserId}`
          : ""
      ]
        .filter(Boolean)
        .join(" e ");
      await writeTransferSummary(destination || "atendimento");
      await UpdateTicketService({
        ticketData: {
          queueId: fallbackQueueId || ticket.queueId,
          ...(fallbackUserId ? { userId: fallbackUserId, status: "open" } : {})
        },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
      logger.info(`Ticket ${ticket.id} transferido por falta de evidência na base`);
    }
    cleanedResponse = "Não tenho essa informação confirmada. Vou transferir você para um atendente.";
  }

  if (cleanedResponse.includes("[INTERNA]") || cleanedResponse.includes("[/INTERNA]")) {
    logger.error(`⚠️ Marcadores [INTERNA] ainda presentes na resposta! Removendo...`);
    cleanedResponse = cleanedResponse
      .replace(/\[INTERNA\][^\[]*?/g, "")
      .replace(/\[\/INTERNA\]/g, "")
      .trim();
  }

  if (!cleanedResponse.trim() && strippedAnyInternal) {
    logger.warn(`Resposta limpa vazia após remover mensagens internas.`);
    cleanedResponse = "Entendi sua solicitação. Estou verificando e em breve retorno com mais informações.";
  }

  return { cleanedResponse, pendingActions };
};
