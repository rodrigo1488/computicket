import { WAMessage, AnyMessageContent } from "baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import { lookup } from "mime-types";
import formatBody from "../../helpers/Mustache";
import ResolveTicketWhatsApp from "../../helpers/ResolveTicketWhatsApp";
import { getChatJid } from "../../helpers/chatJid";
import { runWithFfmpegConcurrency } from "../../utils/ffmpegConcurrency";
import { logger } from "../../utils/logger";

/** WhatsApp rejeita vídeo “na conversa” acima disso; o arquivo ainda pode ir como documento. */
const WHATSAPP_INLINE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
/** Limite prático de documento no WhatsApp. */
const WHATSAPP_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const fileAsUpload = (filePath: string) => ({ stream: fs.createReadStream(filePath) });

const isInlineWhatsAppVideo = (mimeType: string, sizeBytes: number): boolean => {
  if (sizeBytes > WHATSAPP_INLINE_VIDEO_MAX_BYTES) return false;
  const mime = (mimeType || "").toLowerCase().split(";")[0].trim();
  return mime === "video/mp4" || mime === "video/3gpp" || mime === "video/3gpp2";
};

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

const processAudio = async (audio: string): Promise<string> =>
  runWithFfmpegConcurrency(() => {
    const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
    return new Promise<string>((resolve, reject) => {
      exec(
        `${ffmpegPath.path} -i ${audio} -vn -ab 128k -ar 44100 -f ipod ${outputAudio} -y`,
        (error, _stdout, _stderr) => {
          if (error) reject(error);
          fs.unlinkSync(audio);
          resolve(outputAudio);
        }
      );
    });
  });

const processAudioFile = async (audio: string): Promise<string> =>
  runWithFfmpegConcurrency(() => {
    const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
    return new Promise<string>((resolve, reject) => {
      exec(
        `${ffmpegPath.path} -i ${audio} -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio}`,
        (error, _stdout, _stderr) => {
          if (error) reject(error);
          fs.unlinkSync(audio);
          resolve(outputAudio);
        }
      );
    });
  });

export const getMessageOptions = async (
  fileName: string,
  pathMedia: string,
  body?: string
): Promise<any> => {
  let mimeType = lookup(pathMedia) || "";
  if (!mimeType && fileName) {
    mimeType = lookup(path.extname(fileName)) || "";
  }
  if (!mimeType) {
    mimeType = "application/octet-stream";
  }
  const typeMessage = mimeType.split("/")[0];

  try {
    const stats = fs.statSync(pathMedia);
    if (stats.size > WHATSAPP_MEDIA_MAX_BYTES) {
      throw new AppError(
        `Arquivo muito grande (${(stats.size / (1024 * 1024)).toFixed(1)} MB). O WhatsApp aceita no máximo 100 MB.`,
        413
      );
    }

    let options: AnyMessageContent;

    const safeName = fileName || path.basename(pathMedia) || "arquivo";

    const asDocument = (): AnyMessageContent => ({
      document: fileAsUpload(pathMedia),
      caption: body ? body : undefined,
      fileName: safeName,
      mimetype: mimeType
    });

    if (typeMessage === "video") {
      if (isInlineWhatsAppVideo(mimeType, stats.size)) {
        options = {
          video: fileAsUpload(pathMedia),
          caption: body ? body : "",
          fileName: safeName,
          mimetype: mimeType
        };
      } else {
        logger.info({
          msg: "SendWhatsAppMedia: vídeo enviado como documento (tamanho ou formato)",
          fileName: safeName,
          mimeType,
          sizeBytes: stats.size
        });
        options = asDocument();
      }
    } else if (typeMessage === "audio") {
      const typeAudio = true; //fileName.includes("audio-record-site");
      const convert = await processAudio(pathMedia);
      if (typeAudio) {
        options = {
          audio: fs.readFileSync(convert),
          mimetype: typeAudio ? "audio/mp4" : mimeType,
          caption: body ? body : null,
          ptt: true
        };
      } else {
        options = {
          audio: fs.readFileSync(convert),
          mimetype: typeAudio ? "audio/mp4" : mimeType,
          caption: body ? body : null,
          ptt: true
        };
      }
    } else if (typeMessage === "image") {
      options = {
        image: fileAsUpload(pathMedia),
        caption: body ? body : undefined,
        mimetype: mimeType
      };
    } else if (
      typeMessage === "document" ||
      typeMessage === "application" ||
      typeMessage === "text" ||
      typeMessage === "font"
    ) {
      options = asDocument();
    } else {
      // Tipos desconhecidos: enviar como documento (evita tratar .txt como imagem)
      options = asDocument();
    }

    return options;
  } catch (e) {
    Sentry.captureException(e);
    logger.error({ msg: "SendWhatsAppMedia: getMessageOptions falhou", pathMedia, error: e });
    if (e instanceof AppError) throw e;
    return null;
  }
};

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body
}: Request): Promise<WAMessage | any> => {
  try {
    // Obter whatsapp do ticket com fallback seguro para conexão ativa.
    const whatsapp = await ResolveTicketWhatsApp(ticket);

    const pathMedia = media.path;
    const typeMessage = media.mimetype.split("/")[0];
    const bodyMessage = formatBody(body, ticket.contact);
    const chatJid = getChatJid(ticket);

    // Se for Instagram, usa o Adapter
    if (whatsapp.type === "instagram") {
      const { ChannelAdapterFactory } = require("../ChannelAdapters/ChannelAdapterFactory");
      const adapter = ChannelAdapterFactory(whatsapp);
      try {
        const sentMessage = await adapter.sendMedia(whatsapp, ticket.contact, {
          mediaPath: pathMedia,
          fileName: media.originalname,
          mimetype: media.mimetype,
          caption: bodyMessage
        });
        await ticket.update({ lastMessage: bodyMessage });
        return sentMessage;
      } catch (err) {
        Sentry.captureException(err);
        console.log(err);
        throw new AppError("ERR_SENDING_INSTAGRAM_MEDIA");
      }
    }

    // Para Baileys, ainda precisa processar áudio
    let finalMediaPath = pathMedia;
    if (typeMessage === "audio") {
      const typeAudio = media.originalname.includes("audio-record-site");
      if (typeAudio) {
        finalMediaPath = await processAudio(media.path);
      } else {
        finalMediaPath = await processAudioFile(media.path);
      }
    }

    const WhatsAppService = (await import("../WhatsAppService")).default;
    const sentMessage = await WhatsAppService.sendMedia(
      whatsapp,
      chatJid,
      finalMediaPath,
      {
        fileName: media.originalname,
        caption: bodyMessage,
        mimetype: media.mimetype
      }
    );

    await ticket.update({ lastMessage: bodyMessage });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    logger.error({ msg: "SendWhatsAppMedia: falha ao enviar", error: err });
    if (err instanceof AppError) throw err;
    throw new AppError("Não foi possível enviar o arquivo pelo WhatsApp. Tente um vídeo menor ou em MP4.", 400);
  }
};

export default SendWhatsAppMedia;
