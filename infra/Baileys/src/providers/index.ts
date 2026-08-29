import BaileysProvider from "./whatsapp/BaileysProvider";
import GupshupProvider from "./whatsapp/GupshupProvider";
import { IWhatsAppProvider } from "./whatsapp/IWhatsAppProvider";
import Whatsapp from "../models/Whatsapp";

/**
 * Factory para obter o provider correto baseado no tipo de conexão
 */
export function getWhatsAppProvider(whatsapp: Whatsapp): IWhatsAppProvider {
  if (whatsapp.provider === "gupshup") {
    return GupshupProvider;
  }
  
  // Default: Baileys (para "baileys", "stable", "beta" ou qualquer outro valor)
  return BaileysProvider;
}

