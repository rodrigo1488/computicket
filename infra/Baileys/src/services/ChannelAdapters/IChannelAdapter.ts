import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";

export interface IChannelAdapter {
    init(): Promise<void>;
    sendMessage(
        whatsapp: Whatsapp,
        contact: Contact,
        messageData: {
            body: string;
            media?: Express.Multer.File;
            isMedia?: boolean;
        }
    ): Promise<Message>;

    sendMedia(
        whatsapp: Whatsapp,
        contact: Contact,
        mediaData: {
            mediaPath: string;
            fileName: string;
            mimetype: string;
            caption?: string;
        }
    ): Promise<Message>;

    // Future methods
    // refreshSession(whatsapp: Whatsapp): Promise<void>;
    // validateStatus(whatsapp: Whatsapp): Promise<boolean>;
}
