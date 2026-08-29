import { MessageUpsertType, proto, WASocket } from "baileys";
import {
  convertTextToSpeechAndSaveToFile,
  getBodyMessage,
  keepOnlySpecifiedChars,
  transferQueue,
  verifyMediaMessage,
  verifyMessage
} from "../WbotServices/wbotMessageListener";

import fs from "fs";
import path from "path";
import { Op } from "sequelize";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";
import { logger } from "../../utils/logger";
import {
  getLmStudioDefaultModel,
  getLmStudioContextWindowTokens
} from "../../config/openai";
import { getGeminiDefaultModel } from "../../config/gemini";
import { AIProviderFactory } from "../AiServices/AIProviderFactory";
import { AIProviderSelector } from "../AiServices/AIProviderSelector";
import { ChatMessage } from "../AiServices/AIProviderInterface";

type Session = WASocket & {
  id?: number;
};

interface IOpenAi {
  name: string;
  prompt: string;
  voice: string;
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  queueId: number;
  maxMessages: number;
  provider?: string;
  model?: string;
}

const deleteFileSync = (filePath: string): void => {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Erro ao deletar o arquivo:", error);
  }
};

const sanitizeName = (name: string): string => {
  let sanitized = name.split(" ")[0];
  sanitized = sanitized.replace(/[^\p{L}\p{N}]/gu, "");
  return sanitized.substring(0, 60);
};

const computeSafeMaxTokens = (
  messages: ChatMessage[],
  requestedMax: number,
  minCompletion: number
): number => {
  const ctxWindow = getLmStudioContextWindowTokens();
  const estPromptTokens = Math.ceil(JSON.stringify(messages).length / 3.2);
  const headroom = 128;
  const safeMax = Math.max(64, ctxWindow - estPromptTokens - headroom);
  return Math.min(Math.max(requestedMax, minCompletion), safeMax);
};

export const handleOpenAi = async (
  openAiSettings: IOpenAi,
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  mediaSent: Message | undefined,
  ticketTraking: TicketTraking
): Promise<void> => {
  if (contact.disableBot) {
    return;
  }

  const bodyMessage = getBodyMessage(msg);
  if (!bodyMessage) return;

  if (!openAiSettings) return;

  if (msg.messageStubType) return;

  const available = await AIProviderFactory.getAvailableProviders(ticket.companyId);
  const targetProvider = (openAiSettings.provider || "openai").toLowerCase();
  const providerAvailable =
    targetProvider === "gemini" ? available.gemini : available.openai;

  if (!providerAvailable) {
    logger.error(
      targetProvider === "gemini"
        ? "Gemini não configurado (GEMINI_API_KEY)."
        : "LM Studio não configurado (LM_STUDIO_BASE_URL)."
    );
    return;
  }

  let aiProvider;
  try {
    aiProvider = await AIProviderSelector.getProvider(
      ticket.companyId,
      "chat",
      openAiSettings.provider
    );
  } catch (err: any) {
    logger.error(`Provider de IA indisponível no fluxo: ${err.message}`);
    return;
  }

  const providerName = await AIProviderSelector.getProviderName(
    ticket.companyId,
    "chat",
    openAiSettings.provider
  );
  const model =
    openAiSettings.model ||
    (providerName === "gemini" ? getGeminiDefaultModel() : getLmStudioDefaultModel());

  const publicFolder: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    `company${ticket.companyId}`
  );

  const whereMessages: any = { ticketId: ticket.id };
  if (ticket.sessionStartedAt) {
    whereMessages.createdAt = { [Op.gte]: ticket.sessionStartedAt };
  }

  const messages = await Message.findAll({
    where: whereMessages,
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages
  });

  const promptSystem = `Nas respostas utilize o nome ${sanitizeName(
    contact.name || "Amigo(a)"
  )} para identificar o cliente.\nSua resposta deve usar no máximo ${
    openAiSettings.maxTokens
  } tokens e cuide para não truncar o final.\nSempre que possível, mencione o nome dele para ser mais personalizado o atendimento e mais educado. Quando a resposta requer uma transferência para o setor de atendimento, comece sua resposta com 'Ação: Transferir para o setor de atendimento'.\n
                ${openAiSettings.prompt}\n`;

  const buildHistoryMessages = (): ChatMessage[] => {
    const history: ChatMessage[] = [{ role: "system", content: promptSystem }];
    for (let i = 0; i < Math.min(openAiSettings.maxMessages, messages.length); i++) {
      const message = messages[i];
      if (
        message.mediaType === "conversation" ||
        message.mediaType === "extendedTextMessage"
      ) {
        if (message.fromMe) {
          history.push({ role: "assistant", content: message.body });
        } else {
          history.push({ role: "user", content: message.body });
        }
      }
    }
    return history;
  };

  const sendResponse = async (responseRaw: string): Promise<void> => {
    let response = responseRaw;
    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response
        .replace("Ação: Transferir para o setor de atendimento", "")
        .trim();
    }

    if (openAiSettings.voice === "texto") {
      logger.info(`Resposta IA (${providerName}): ${response?.slice(0, 120)}`);
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${response!}`
      });
      await verifyMessage(sentMessage!, ticket, contact);
      return;
    }

    const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
    convertTextToSpeechAndSaveToFile(
      keepOnlySpecifiedChars(response!),
      `${publicFolder}/${fileNameWithOutExtension}`,
      openAiSettings.voiceKey,
      openAiSettings.voiceRegion,
      openAiSettings.voice,
      "mp3"
    ).then(async () => {
      try {
        const sendMessage = await wbot.sendMessage(msg.key.remoteJid!, {
          audio: { url: `${publicFolder}/${fileNameWithOutExtension}.mp3` },
          mimetype: "audio/mpeg",
          ptt: true
        });
        await verifyMediaMessage(
          sendMessage!,
          ticket,
          contact,
          ticketTraking,
          false,
          false,
          wbot
        );
        deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.mp3`);
        deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.wav`);
      } catch (error) {
        console.log(`Erro para responder com audio: ${error}`);
      }
    });
  };

  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    const messagesOpenAi = buildHistoryMessages();
    messagesOpenAi.push({ role: "user", content: bodyMessage! });

    const maxTokens = computeSafeMaxTokens(messagesOpenAi, openAiSettings.maxTokens, 512);
    const response = await aiProvider.chat(messagesOpenAi, {
      model,
      maxTokens,
      temperature: openAiSettings.temperature
    });
    await sendResponse(response);
  } else if (msg.message?.audioMessage && mediaSent?.mediaUrl) {
    const mediaUrl = mediaSent.mediaUrl.split("/").pop();
    const file = fs.createReadStream(`${publicFolder}/${mediaUrl}`);

    let transcriptionText = "";
    try {
      const txProvider = await AIProviderSelector.getProvider(
        ticket.companyId,
        "transcription"
      );
      transcriptionText = await txProvider.transcribeAudio(
        file,
        mediaSent.mediaType || "audio/ogg",
        {}
      );
    } catch (err: any) {
      logger.error(`Transcrição no fluxo OpenAI: ${err.message}`);
      return;
    }

    const messagesOpenAi = buildHistoryMessages();
    messagesOpenAi.push({ role: "user", content: transcriptionText });

    const maxTokens = computeSafeMaxTokens(messagesOpenAi, openAiSettings.maxTokens, 768);
    const response = await aiProvider.chat(messagesOpenAi, {
      model,
      maxTokens,
      temperature: openAiSettings.temperature
    });
    await sendResponse(response);
  }
};
