import axios from "axios";
import { IChannelAdapter } from "./IChannelAdapter";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import AppError from "../../errors/AppError";
import fs from "fs";
import FormData from "form-data";

class InstagramAdapter implements IChannelAdapter {
    private apiUrl = "https://graph.facebook.com/v18.0";

    async init(): Promise<void> {
        // Initialization logic if needed
    }

    async sendMessage(
        whatsapp: Whatsapp,
        contact: Contact,
        messageData: { body: string; media?: Express.Multer.File; isMedia?: boolean }
    ): Promise<Message> {
        if (!whatsapp.facebookUserToken) {
            throw new AppError("ERR_WAPP_INVALID_TOKEN");
        }

        const { body } = messageData;

        // Logic to send text message via Instagram Graph API
        // POST /me/messages
        //Recipient: contact.number (IGSID)

        try {
            const { data } = await axios.post(
                `${this.apiUrl}/${whatsapp.fbPageId}/messages`,
                {
                    recipient: { id: contact.number },
                    message: { text: body }
                },
                {
                    params: {
                        access_token: whatsapp.facebookUserToken
                    }
                }
            );

            // Return a partial Message object or use a Service to create it.
            // Ideally this adapter returns the API response, and the Service creates the record.
            // But adhering to the interface returning Promise<Message>:

            // Note: In a real implementation, we would create the Message in the DB here or returns the data to the service.
            // For now, casting or mocking the return as we are in the initial phase.

            return data as unknown as Message;
        } catch (err) {
            console.error(err);
            throw new AppError("ERR_SENDING_INSTAGRAM_MSG");
        }
    }

    async sendMedia(
        whatsapp: Whatsapp,
        contact: Contact,
        mediaData: {
            mediaPath: string;
            fileName: string;
            mimetype: string;
            caption?: string;
        }
    ): Promise<Message> {
        if (!whatsapp.facebookUserToken) {
            throw new AppError("ERR_WAPP_INVALID_TOKEN");
        }

        if (!whatsapp.fbPageId) {
            throw new AppError("ERR_WAPP_INVALID_PAGE_ID");
        }

        try {
            const { mediaPath, fileName, mimetype, caption } = mediaData;
            
            // Determinar o tipo de mídia baseado no mimetype
            const mediaType = mimetype.split("/")[0];
            let messageType: "image" | "video" | "file" = "file";
            
            if (mediaType === "image") {
                messageType = "image";
            } else if (mediaType === "video") {
                messageType = "video";
            }

            // Passo 1: Fazer upload do arquivo para obter attachment_id
            const formData = new FormData();
            formData.append("message", fs.createReadStream(mediaPath), {
                filename: fileName,
                contentType: mimetype
            });

            const uploadResponse = await axios.post(
                `${this.apiUrl}/${whatsapp.fbPageId}/message_attachments`,
                formData,
                {
                    params: {
                        access_token: whatsapp.facebookUserToken
                    },
                    headers: {
                        ...formData.getHeaders()
                    }
                }
            );

            const attachmentId = uploadResponse.data.attachment_id;

            if (!attachmentId) {
                throw new AppError("ERR_INSTAGRAM_UPLOAD_FAILED");
            }

            // Passo 2: Enviar mensagem com o attachment
            const messagePayload: any = {
                recipient: { id: contact.number },
                message: {
                    attachment: {
                        type: messageType,
                        payload: {
                            attachment_id: attachmentId
                        }
                    }
                }
            };

            // Adicionar caption se fornecido (Instagram suporta caption em imagens e vídeos)
            if (caption && (messageType === "image" || messageType === "video")) {
                messagePayload.message.attachment.payload.caption = caption;
            }

            const { data } = await axios.post(
                `${this.apiUrl}/${whatsapp.fbPageId}/messages`,
                messagePayload,
                {
                    params: {
                        access_token: whatsapp.facebookUserToken
                    }
                }
            );

            return data as unknown as Message;
        } catch (err: any) {
            console.error("Erro ao enviar mídia para Instagram:", err.response?.data || err.message);
            throw new AppError("ERR_SENDING_INSTAGRAM_MEDIA");
        }
    }
}

export default InstagramAdapter;
