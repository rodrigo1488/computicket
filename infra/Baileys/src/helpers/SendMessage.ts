import Whatsapp from "../models/Whatsapp";
import WhatsAppService from "../services/WhatsAppService";
import { lookup } from "mime-types";

export type MessageData = {
  number: number | string;
  body: string;
  mediaPath?: string;
  fileName?: string;
};

export const SendMessage = async (
  whatsapp: Whatsapp,
  messageData: MessageData
): Promise<any> => {
  try {
    const number = messageData.number.toString();

    if (messageData.mediaPath) {
      // Determinar mimetype
      const mimeType = lookup(messageData.mediaPath) || "";
      const typeMessage = mimeType.split("/")[0];

      return await WhatsAppService.sendMedia(
        whatsapp,
        number,
        messageData.mediaPath,
        {
          fileName: messageData.fileName,
          caption: messageData.body,
          mimetype: mimeType
        }
      );
    } else {
      return await WhatsAppService.sendMessage(
        whatsapp,
        number,
        messageData.body
      );
    }
  } catch (err: any) {
    throw new Error(err);
  }
};
