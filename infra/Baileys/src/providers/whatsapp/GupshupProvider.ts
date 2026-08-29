import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import {
  IWhatsAppProvider,
  SendMessageOptions,
  SendMediaOptions
} from "./IWhatsAppProvider";
import GupshupApiClient from "../../services/GupshupServices/GupshupApiClient";
import { lookup } from "mime-types";

class GupshupProvider implements IWhatsAppProvider {
  async sendMessage(
    whatsapp: Whatsapp,
    number: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<any> {
    try {
      if (!whatsapp.gupshupApiKey || !whatsapp.gupshupAppName) {
        throw new AppError("ERR_GUPSHUP_CONFIG_MISSING");
      }

      const result = await GupshupApiClient.sendTextMessage({
        apiKey: whatsapp.gupshupApiKey,
        appName: whatsapp.gupshupAppName,
        destination: number,
        message: body
      });

      return result;
    } catch (err) {
      Sentry.captureException(err);
      console.log(err);
      throw err instanceof AppError ? err : new AppError("ERR_SENDING_WAPP_MSG");
    }
  }

  async sendMedia(
    whatsapp: Whatsapp,
    number: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<any> {
    try {
      if (!whatsapp.gupshupApiKey || !whatsapp.gupshupAppName) {
        throw new AppError("ERR_GUPSHUP_CONFIG_MISSING");
      }

      // Determinar tipo de mídia baseado no mimetype ou opções
      // Conforme documentação: https://docs.gupshup.io/reference/msg
      const mimeType = options?.mimetype || lookup(mediaPath) || "";
      const typeMessage = mimeType.split("/")[0];

      let mediaType: "image" | "video" | "audio" | "file";

      if (typeMessage === "video") {
        mediaType = "video";
      } else if (typeMessage === "audio") {
        mediaType = "audio";
      } else if (typeMessage === "document" || typeMessage === "application" || typeMessage === "text") {
        // Documentos devem usar type "file" conforme documentação
        mediaType = "file";
      } else {
        mediaType = "image";
      }

      const result = await GupshupApiClient.sendMediaMessage({
        apiKey: whatsapp.gupshupApiKey,
        appName: whatsapp.gupshupAppName,
        destination: number,
        mediaPath,
        mediaType,
        caption: options?.caption,
        fileName: options?.fileName
      });

      return result;
    } catch (err) {
      Sentry.captureException(err);
      console.log(err);
      throw err instanceof AppError ? err : new AppError("ERR_SENDING_WAPP_MSG");
    }
  }

  async getStatus(whatsapp: Whatsapp): Promise<string> {
    // Para Gupshup, o status é sempre CONNECTED se tiver API key e App name
    if (whatsapp.gupshupApiKey && whatsapp.gupshupAppName) {
      return "CONNECTED";
    }
    return "DISCONNECTED";
  }
}

export default new GupshupProvider();

