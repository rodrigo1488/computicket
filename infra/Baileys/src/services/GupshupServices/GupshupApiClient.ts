import axios from "axios";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import path from "path";

interface GupshupSendTextMessageParams {
  apiKey: string;
  appName: string;
  destination: string;
  message: string;
}

interface GupshupSendMediaMessageParams {
  apiKey: string;
  appName: string;
  destination: string;
  mediaPath: string;
  mediaType: "image" | "video" | "audio" | "file";
  caption?: string;
  fileName?: string;
}

class GupshupApiClient {
  // Endpoint correto conforme documentação: https://docs.gupshup.io/reference/
  private baseURL = "https://api.gupshup.io/wa/api/v1";

  /**
   * Envia mensagem de texto via Gupshup
   * Documentação: https://docs.gupshup.io/reference/msg
   */
  async sendTextMessage(params: GupshupSendTextMessageParams): Promise<any> {
    try {
      const { apiKey, appName, destination, message } = params;

      // Remove caracteres não numéricos do número e garante formato internacional
      let cleanNumber = destination.replace(/\D/g, "");
      
      // Se não começar com código de país, assumir Brasil (55)
      if (!cleanNumber.startsWith("55") && cleanNumber.length <= 11) {
        cleanNumber = "55" + cleanNumber;
      }

      // Formato conforme documentação: https://docs.gupshup.io/reference/msg
      const response = await axios.post(
        `${this.baseURL}/msg`,
        {
          source: appName,
          destination: cleanNumber,
          message: {
            type: "text",
            text: message
          }
        },
        {
          headers: {
            apikey: apiKey,
            "Content-Type": "application/json"
          }
        }
      );

      return response.data;
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Gupshup API Error:", error.response?.data || error.message);
      throw new AppError(
        error.response?.data?.message || "ERR_SENDING_GUPSHUP_MSG"
      );
    }
  }

  /**
   * Envia mídia via Gupshup
   * Documentação: https://docs.gupshup.io/reference/msg
   * Mídias devem usar URLs públicas, não base64
   */
  async sendMediaMessage(params: GupshupSendMediaMessageParams): Promise<any> {
    try {
      const { apiKey, appName, destination, mediaPath, mediaType, caption, fileName } = params;

      // Remove caracteres não numéricos do número e garante formato internacional
      let cleanNumber = destination.replace(/\D/g, "");
      
      // Se não começar com código de país, assumir Brasil (55)
      if (!cleanNumber.startsWith("55") && cleanNumber.length <= 11) {
        cleanNumber = "55" + cleanNumber;
      }

      // Gerar URL pública do arquivo
      // Os arquivos são servidos em /public conforme app.ts
      const backendUrl = process.env.BACKEND_URL || "http://localhost:8080";
      
      // Obter caminho relativo a partir da pasta public
      const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");
      let relativePath = path.relative(publicFolder, mediaPath);
      
      // Se o arquivo não estiver na pasta public, usar apenas o nome do arquivo
      if (relativePath.startsWith("..")) {
        relativePath = path.basename(mediaPath);
      }
      
      // Normalizar separadores de caminho para URL
      relativePath = relativePath.replace(/\\/g, "/");
      
      const publicUrl = `${backendUrl}/public/${relativePath}`;

      // Formato conforme documentação: https://docs.gupshup.io/reference/msg
      let messagePayload: any;

      if (mediaType === "image") {
        // Image: precisa de originalUrl, previewUrl (opcional), caption (opcional)
        messagePayload = {
          type: "image",
          originalUrl: publicUrl,
          previewUrl: publicUrl, // Usar mesma URL como preview
          ...(caption && { caption })
        };
      } else if (mediaType === "video") {
        // Video: precisa de url, caption (opcional)
        messagePayload = {
          type: "video",
          url: publicUrl,
          ...(caption && { caption })
        };
      } else if (mediaType === "audio") {
        // Audio: precisa de url
        messagePayload = {
          type: "audio",
          url: publicUrl
        };
      } else {
        // File/Document: precisa de url e filename
        messagePayload = {
          type: "file",
          url: publicUrl,
          filename: fileName || "file"
        };
      }

      const response = await axios.post(
        `${this.baseURL}/msg`,
        {
          source: appName,
          destination: cleanNumber,
          message: messagePayload
        },
        {
          headers: {
            apikey: apiKey,
            "Content-Type": "application/json"
          }
        }
      );

      return response.data;
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Gupshup API Error:", error.response?.data || error.message);
      throw new AppError(
        error.response?.data?.message || "ERR_SENDING_GUPSHUP_MSG"
      );
    }
  }

}

export default new GupshupApiClient();

