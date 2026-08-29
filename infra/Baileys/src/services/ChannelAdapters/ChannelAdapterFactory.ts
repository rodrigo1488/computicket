import Whatsapp from "../../models/Whatsapp";
import { IChannelAdapter } from "./IChannelAdapter";
import InstagramAdapter from "./InstagramAdapter";
import WhatsAppAdapter from "./WhatsAppAdapter";

export const ChannelAdapterFactory = (whatsapp: Whatsapp): IChannelAdapter => {
    if (whatsapp.type === "instagram") {
        return new InstagramAdapter();
    }

    // Default to WhatsAppAdapter (wrapper around Baileys)
    // Since we haven't fully implemented WhatsAppAdapter yet, 
    // we might return null or handle it in the caller for now, 
    // but for the Strategy pattern we should eventually have it.

    return new WhatsAppAdapter();
};
