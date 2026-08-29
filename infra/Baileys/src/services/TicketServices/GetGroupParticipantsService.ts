import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import ShowTicketService from "../TicketServices/ShowTicketService";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import { Op } from "sequelize";

export interface GroupParticipant {
  jid: string;
  name: string;
}

/**
 * Enriquece participantes do grupo com nomes do banco de dados.
 * Os nomes (ex: "Cesar Borges") vêm dos Contacts criados quando os participantes
 * enviam mensagens. O groupMetadata do WhatsApp retorna apenas IDs numéricos.
 */
const GetGroupParticipantsService = async (
  ticketId: string,
  companyId: number
): Promise<GroupParticipant[]> => {
  const ticket = await ShowTicketService(ticketId, companyId);

  if (!ticket.isGroup) {
    throw new AppError("Este ticket não é um grupo.", 400);
  }

  const wbot = await GetTicketWbot(ticket);
  if (!wbot) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  const groupJid = ticket.contact.number.includes("@")
    ? ticket.contact.number
    : `${ticket.contact.number}@g.us`;

  const metadata = await (wbot as any).groupMetadata(groupJid);
  const rawParticipants = metadata?.participants || [];

  // 1. Buscar nomes nas mensagens deste ticket (participantes que já enviaram mensagem aqui)
  const messagesWithContact = await Message.findAll({
    where: {
      ticketId: parseInt(ticketId),
      companyId,
      participant: { [Op.ne]: null }
    },
    attributes: ["participant", "contactId"],
    include: [{ model: Contact, as: "contact", attributes: ["id", "name", "number"] }]
  });

  const jidToName = new Map<string, string>();
  const numberToName = new Map<string, string>();
  messagesWithContact.forEach((msg: any) => {
    const participant = msg.participant;
    const contact = msg.contact;
    if (participant && contact?.name) {
      jidToName.set(participant, contact.name);
      const partDigits = participant.replace(/@.*$/, "").replace(/\D/g, "");
      const contactDigits = (contact?.number || "").replace(/\D/g, "");
      if (partDigits) numberToName.set(partDigits, contact.name);
      if (contactDigits) numberToName.set(contactDigits, contact.name);
    }
  });

  // 2. Buscar em TODOS os contatos da empresa - captura quem já conversou em outro ticket
  const allContacts = await Contact.findAll({
    where: { companyId, isGroup: false },
    attributes: ["number", "name"]
  });
  allContacts.forEach((c: Contact) => {
    const digits = (c.number || "").replace(/\D/g, "");
    if (digits && c.name && !numberToName.has(digits)) {
      numberToName.set(digits, c.name);
    }
  });

  return rawParticipants
    .map((p: any) => {
      const jid = p.id || p.userJid || p.jid || p.pn || "";
      const jidFormatted = jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;
      const digits = jid.replace(/@.*$/, "").replace(/\D/g, "");

      // Prioridade: nome do banco > pushName/notify do metadata > número formatado
      let dbName =
        jidToName.get(jidFormatted) ||
        jidToName.get(jid) ||
        numberToName.get(digits) ||
        jidToName.get(`${jid}@lid`) ||
        jidToName.get(`${digits}@lid`);
      if (!dbName && digits.length >= 10) {
        for (const [num, contactName] of numberToName.entries()) {
          if (num.length >= 10 && (digits.endsWith(num) || num.endsWith(digits))) {
            dbName = contactName;
            break;
          }
        }
      }
      const metadataName = p.pushName || p.notify || p.name || (p.lid && (p.lid.pushName || p.lid.notify));
      const name = dbName || metadataName || (digits ? `+${digits}` : jid.split("@")[0]);

      return {
        jid: jidFormatted,
        name: String(name).trim() || jid.split("@")[0]
      };
    })
    .filter((p: GroupParticipant) => p.jid);
};

export default GetGroupParticipantsService;
