import { WASocket } from "baileys";
import { getWbot } from "../libs/wbot";
import Ticket from "../models/Ticket";
import { Store } from "../libs/store";
import ResolveTicketWhatsApp from "./ResolveTicketWhatsApp";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const GetTicketWbot = async (ticket: Ticket): Promise<Session | null> => {
  const resolvedWhatsapp = await ResolveTicketWhatsApp(ticket);

  // Verificar se é Instagram - Instagram não usa sessão Baileys
  if (resolvedWhatsapp.type === "instagram") {
    // Instagram não precisa de sessão Baileys, retorna null
    // O código que usa GetTicketWbot deve verificar se é Instagram antes de chamar
    return null;
  }

  const wbot = getWbot(resolvedWhatsapp.id);
  return wbot;
};

export default GetTicketWbot;
