import { logger } from "../../utils/logger";
import { getLmStudioDefaultModel } from "../../config/openai";
import { loadAgentContext } from "../../helpers/computicketAgentApi";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { AIProviderSelector } from "./AIProviderSelector";
import { normalizeGroupJid } from "../PromptServices/promptAgentFields";
import {
  completionTokenBudget,
  conversationTurns,
  formatAgentContext,
  groupMessageAddressesAgent,
  looksLikeFactualQuestion,
  noticeTextFromMention,
  sanitizeCustomerReply,
  signAgentMessage
} from "./aiAgentActions";
import {
  clearTemporaryContexts,
  rememberTemporaryContext,
  temporaryNoticeBlock,
  temporaryNoticeInstruction,
  temporaryNoticeReply
} from "./temporaryContext";

const MAX_LINES = 12;
const WAIT_MS = 500;
const HANDOFF = "Uma pessoa da equipe vai ver isso.";

type TrackLine = { fromAgent: boolean; sender: string; body: string };
type ReplySocket = {
  id?: number;
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
};

const tracks = new Map<string, TrackLine[]>();
const timers = new Map<string, NodeJS.Timeout>();
const scheduled = new Set<string>();
const answered = new Set<string>();

export type LinkedGroupObservation = {
  wbot: ReplySocket;
  companyId: number;
  chatId: string;
  fromMe: boolean;
  senderName: string;
  body: string;
  mentionedJids: string[];
  profileName: string;
  phoneJids: string[];
  messageId: string;
  isReaction: boolean;
};

const rememberAnswered = (messageId: string): void => {
  if (!messageId) return;
  answered.add(messageId);
  if (answered.size <= 200) return;
  const oldest = answered.values().next().value;
  if (oldest) answered.delete(oldest);
};

const replyToMention = async (input: {
  wbot: ReplySocket;
  companyId: number;
  groupJid: string;
  prompt: any;
  trackKey: string;
  messageId: string;
}): Promise<void> => {
  if (input.messageId && answered.has(input.messageId)) return;
  const lines = tracks.get(input.trackKey) || [];
  const latest = lines[lines.length - 1];
  if (!latest || latest.fromAgent) return;
  try {
    const history = lines.slice(0, -1);
    const userText = `${latest.sender}: ${latest.body}`;
    const historyText = history
      .map(line => `${line.fromAgent ? "Atendente" : line.sender}: ${line.body}`)
      .join("\n");
    const context = await loadAgentContext(input.prompt, userText, historyText);
    const factual = looksLikeFactualQuestion(latest.body);
    const noticeBlock = await temporaryNoticeBlock(input.companyId, input.prompt.id);
    const provider = await AIProviderSelector.getProvider(
      input.companyId,
      "chat",
      input.prompt.provider
    );
    const decisionRaw = await provider.chat(
      [
        { role: "system", content: temporaryNoticeInstruction() },
        { role: "user", content: latest.body }
      ],
      {
        model: input.prompt.model || getLmStudioDefaultModel(),
        maxTokens: 256,
        temperature: 0
      }
    );
    const decision = temporaryNoticeReply(typeof decisionRaw === "string" ? decisionRaw : "");
    let text = "";
    if (decision.action === "guardar") {
      const stated = noticeTextFromMention(latest.body, [input.prompt.name]);
      const saved = await rememberTemporaryContext({
        companyId: input.companyId,
        promptId: input.prompt.id,
        body: stated,
        days: decision.days,
        sourceMessageId: input.messageId
      });
      const until = decision.days === 0 ? "até o fim de hoje" : decision.days === 1 ? "até o fim de amanhã" : "até o fim da semana";
      text = saved ? `Anotei este aviso ${until}: ${saved.body}` : "";
    } else if (decision.action === "encerrar") {
      const cleared = await clearTemporaryContexts({
        companyId: input.companyId,
        promptId: input.prompt.id,
        subject: decision.text || latest.body
      });
      text = cleared
        ? `Encerrei o aviso sobre ${decision.text}.`
        : "Não encontrei um aviso ativo sobre isso.";
    } else if (factual && !context.has_evidence && !noticeBlock) {
      text = HANDOFF;
    } else {
      const messages = [
        {
          role: "system" as const,
          content:
            `Você é ${input.prompt.name || "o agente"}. Alguém citou você no grupo de WhatsApp.\n${input.prompt.prompt || ""}` +
            formatAgentContext(context) +
            noticeBlock +
            `\n\nNESTA FALA DE GRUPO:
- Responda à pessoa que citou você, em frases completas.
- Não transfira, não mude fila e não escreva ação, JSON ou nota interna.
- Não tente solucionar problema técnico e não invente.
- Sem fonte para uma pergunta factual, diga apenas que uma pessoa da equipe vai ver.
- Não escreva seu nome no início. A assinatura é colocada automaticamente.`
        },
        ...conversationTurns(
          history.map(line => ({
            fromMe: line.fromAgent,
            body: line.fromAgent ? line.body : `${line.sender}: ${line.body}`,
            mediaType: "conversation"
          })),
          userText
        )
      ];
      const response = await provider.chat(messages as any, {
        model: input.prompt.model || getLmStudioDefaultModel(),
        maxTokens: completionTokenBudget(input.prompt.provider, input.prompt.maxTokens, messages),
        temperature: input.prompt.temperature
      });
      text = sanitizeCustomerReply(typeof response === "string" ? response : "");
      if (!text && factual) text = HANDOFF;
    }
    const signed = signAgentMessage(text, input.prompt.name);
    if (!signed) return;
    await input.wbot.sendMessage(input.groupJid, { text: signed });
    rememberAnswered(input.messageId);
    const stored = tracks.get(input.trackKey) || [];
    stored.push({ fromAgent: true, sender: input.prompt.name || "Agente", body: signed });
    tracks.set(input.trackKey, stored.slice(-MAX_LINES));
  } catch (err: any) {
    logger.warn(`Resposta no grupo vinculado falhou: ${err?.message || err}`);
  }
};

/** Guarda o trecho do grupo do alerta e responde só quando a mensagem cita o agente. */
export async function observeLinkedGroupMessage(input: LinkedGroupObservation): Promise<void> {
  if (!input.wbot.id || input.isReaction) return;
  let whatsapp;
  try {
    whatsapp = await ShowWhatsAppService(input.wbot.id, input.companyId);
  } catch (err: any) {
    logger.warn(`Grupo vinculado: conexão ${input.wbot.id} indisponível (${err?.message || err})`);
    return;
  }
  const prompt = whatsapp.prompt;
  const linked = normalizeGroupJid(prompt?.idleAlertGroupJid);
  const current = normalizeGroupJid(input.chatId);
  if (!prompt || !linked || linked !== current) return;

  const body = (input.body || "").trim();
  const mentionedJids = input.mentionedJids || [];
  if (!body && mentionedJids.length === 0) return;
  if (!input.fromMe && input.messageId && (scheduled.has(input.messageId) || answered.has(input.messageId))) {
    return;
  }

  const trackKey = `${input.wbot.id}:${linked}`;
  const lines = tracks.get(trackKey) || [];
  lines.push({
    fromAgent: input.fromMe,
    sender: input.fromMe ? (prompt.name || "Agente") : (input.senderName || "Participante"),
    body: body || "(menção)"
  });
  tracks.set(trackKey, lines.slice(-MAX_LINES));
  if (input.fromMe) return;

  const addressed = groupMessageAddressesAgent({
    body,
    mentionedJids,
    names: [input.profileName, whatsapp.name, prompt.name],
    phoneJids: input.phoneJids
  });
  if (!addressed) return;
  if (input.messageId && (scheduled.has(input.messageId) || answered.has(input.messageId))) return;
  if (input.messageId) {
    scheduled.add(input.messageId);
    if (scheduled.size > 200) {
      const oldest = scheduled.values().next().value;
      if (oldest) scheduled.delete(oldest);
    }
  }

  const existing = timers.get(trackKey);
  if (existing) clearTimeout(existing);
  const messageId = input.messageId;
  timers.set(
    trackKey,
    setTimeout(() => {
      timers.delete(trackKey);
      void replyToMention({
        wbot: input.wbot,
        companyId: input.companyId,
        groupJid: linked,
        prompt,
        trackKey,
        messageId
      });
    }, WAIT_MS)
  );
}
