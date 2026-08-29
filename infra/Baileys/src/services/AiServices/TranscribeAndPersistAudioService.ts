import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import { emitAppMessageUpdate } from "../../helpers/emitAppMessageUpdate";
import { logger } from "../../utils/logger";
import transcribeAudio from "./TranscribeAudioService";
import { runWithTranscriptionConcurrency } from "./transcriptionConcurrency";

export interface TranscribeAndPersistParams {
  messageId: string;
  companyId: number;
  /** Se true (ex.: retry manual), repõe pending mesmo com status pending. */
  force?: boolean;
}

export interface TranscribeAndPersistResult {
  transcription?: string;
  messageId: string;
  cached?: boolean;
  skipped?: boolean;
}

/**
 * Transcreve áudio (Whisper), persiste em Messages e notifica o frontend via socket.
 */
const transcribeAndPersistAudioMessage = async ({
  messageId,
  companyId,
  force = false
}: TranscribeAndPersistParams): Promise<TranscribeAndPersistResult> => {
  const existing = await Message.findOne({
    where: { id: messageId, companyId, mediaType: "audio", isDeleted: false },
    attributes: ["id", "transcription", "transcriptionStatus"]
  });

  if (!existing) {
    throw new AppError("Mensagem de áudio não encontrada ou não pertence a esta empresa.", 404);
  }

  if (!force && existing.transcriptionStatus === "completed" && existing.transcription?.trim()) {
    return {
      transcription: existing.transcription.trim(),
      messageId,
      cached: true
    };
  }

  if (force) {
    await Message.update(
      { transcriptionStatus: "pending", transcriptionError: null },
      { where: { id: messageId, companyId, mediaType: "audio", isDeleted: false } }
    );
  } else {
    const [claimed] = await Message.update(
      { transcriptionStatus: "pending", transcriptionError: null },
      {
        where: {
          id: messageId,
          companyId,
          mediaType: "audio",
          isDeleted: false,
          [Op.or]: [{ transcriptionStatus: null }, { transcriptionStatus: "failed" }]
        }
      }
    );

    if (claimed === 0) {
      const cur = await Message.findByPk(messageId, {
        attributes: ["transcription", "transcriptionStatus"]
      });
      if (cur?.transcriptionStatus === "completed" && cur.transcription?.trim()) {
        return {
          transcription: cur.transcription.trim(),
          messageId,
          cached: true
        };
      }
      logger.info(
        `TranscribeAndPersist: skip messageId=${messageId} (já em pending ou sem slot de claim)`
      );
      await emitAppMessageUpdate(messageId, companyId);
      return { messageId, skipped: true };
    }
  }

  await emitAppMessageUpdate(messageId, companyId);

  try {
    const result = await runWithTranscriptionConcurrency(() =>
      transcribeAudio({ messageId, companyId })
    );
    await Message.update(
      {
        transcription: result.transcription,
        transcriptionStatus: "completed",
        transcriptionError: null
      },
      { where: { id: messageId, companyId } }
    );
    await emitAppMessageUpdate(messageId, companyId);
    return { transcription: result.transcription, messageId };
  } catch (err: any) {
    const errMsg = err instanceof AppError ? err.message : err?.message || "Erro desconhecido";
    const short = String(errMsg).slice(0, 500);
    await Message.update(
      { transcriptionStatus: "failed", transcriptionError: short },
      { where: { id: messageId, companyId } }
    );
    await emitAppMessageUpdate(messageId, companyId);
    throw err;
  }
};

export default transcribeAndPersistAudioMessage;
