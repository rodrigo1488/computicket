/**
 * Normaliza número/JID armazenado no banco para o formato esperado pelo Baileys.
 * Contatos de grupo costumam ter `number` = `120363...@g.us` (verifyContact).
 */
export const toWhatsAppGroupJid = (raw: string): string => {
  const base = String(raw || "")
    .trim()
    .replace(/@g\.us$/i, "")
    .replace(/@s\.whatsapp\.net$/i, "");
  return `${base}@g.us`;
};

export const toWhatsAppPrivateJid = (raw: string): string => {
  const digits = String(raw || "")
    .trim()
    .replace(/@.*$/, "")
    .replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
};

/**
 * Retorna o JID de destino para envio de mensagens a partir de um ticket.
 */
export const getChatJid = (ticket: {
  contact: { number: string };
  isGroup: boolean;
  groupContact?: { number: string } | null;
}): string => {
  if (ticket.isGroup) {
    const raw = ticket.groupContact?.number || ticket.contact?.number;
    return toWhatsAppGroupJid(raw);
  }
  return toWhatsAppPrivateJid(ticket.contact.number);
};
