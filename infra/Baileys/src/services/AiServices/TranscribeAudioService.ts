import { promises as fsp } from "fs";
import { constants as fsConstants } from "fs";
import path from "path";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import { AIProviderSelector } from "./AIProviderSelector";
import { logger } from "../../utils/logger";

interface TranscribeAudioParams {
  messageId: string;
  companyId: number;
}

interface TranscribeAudioResponse {
  transcription: string;
  messageId: string;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detecta o tipo MIME do arquivo de áudio baseado na extensão
 */
const getAudioMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/m4a",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".aac": "audio/aac"
  };
  return mimeTypes[ext] || "audio/mpeg";
};

/**
 * Valida o tamanho do arquivo (máximo 100MB)
 */
const validateFileSize = async (filePath: string): Promise<void> => {
  const stats = await fsp.stat(filePath);
  const fileSizeInMB = stats.size / (1024 * 1024);

  if (fileSizeInMB > 100) {
    throw new AppError(
      `Arquivo de áudio muito grande (${fileSizeInMB.toFixed(2)}MB). O tamanho máximo é 100MB.`,
      400
    );
  }
};

/**
 * Transcreve mensagem de áudio via provider configurado (LM Studio / OpenAI-compat quando suportado)
 */
const transcribeAudio = async ({
  messageId,
  companyId
}: TranscribeAudioParams): Promise<TranscribeAudioResponse> => {
  let providerName = "IA";

  try {
    const message = await Message.findOne({
      where: {
        id: messageId,
        companyId,
        mediaType: "audio",
        isDeleted: false
      }
    });

    if (!message) {
      throw new AppError("Mensagem de áudio não encontrada ou não pertence a esta empresa.", 404);
    }

    const provider = await AIProviderSelector.getProvider(companyId, "transcription");
    providerName = provider.name;

    const mediaUrlValue = message.getDataValue("mediaUrl");
    if (!mediaUrlValue) {
      throw new AppError("Arquivo de áudio não encontrado para esta mensagem.", 404);
    }

    const fileName = mediaUrlValue.includes("/public/")
      ? mediaUrlValue.split("/public/")[1]
      : mediaUrlValue.split("/").pop() || mediaUrlValue;

    const audioFilePath = path.join(publicFolder, fileName);

    if (!(await pathExists(audioFilePath))) {
      logger.error(`Arquivo de áudio não encontrado: ${audioFilePath}`);
      throw new AppError("Arquivo de áudio não encontrado no servidor.", 404);
    }

    await validateFileSize(audioFilePath);

    const mimeType = getAudioMimeType(audioFilePath);

    logger.info(`Lendo arquivo de áudio para transcrição: ${audioFilePath}`);
    const audioBuffer = await fsp.readFile(audioFilePath);

    logger.info(
      `Enviando áudio para transcrição usando ${providerName} (tamanho: ${(audioBuffer.length / 1024).toFixed(2)}KB)`
    );

    const transcription = await provider.transcribeAudio(audioBuffer, mimeType, {
      prompt: undefined
    });

    if (!transcription || transcription.trim() === "") {
      logger.error(`Transcrição vazia retornada pelo ${providerName}`);
      throw new AppError("ERR_AI_TRANSCRIPTION_EMPTY", 500);
    }

    logger.info(`✅ Transcrição concluída com sucesso usando ${providerName} (${transcription.length} caracteres)`);

    return {
      transcription: transcription.trim(),
      messageId
    };
  } catch (err: any) {
    if (err instanceof AppError) {
      throw err;
    }

    logger.error(`Erro ao transcrever áudio com ${providerName}:`, {
      message: err.message,
      messageId,
      companyId
    });

    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(
      `Erro ao transcrever áudio: ${err.message || "Erro desconhecido"}`,
      500
    );
  }
};

export default transcribeAudio;
