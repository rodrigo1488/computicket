/** Conversa direta com suporte de sistema — fora da fila do Help Desk. */
export const SUPPORT_TICKET_STATUS = "support";

export function isSupportContact(
  contact: { isSupport?: boolean | null } | null | undefined
): boolean {
  return contact?.isSupport === true;
}

/** Grupo continua no fluxo normal; só o contato privado marcado desvia do Help Desk. */
export function shouldBypassHelpdesk(
  contact: { isSupport?: boolean | null } | null | undefined,
  isGroup: boolean
): boolean {
  return !isGroup && isSupportContact(contact);
}

export function isSupportTicket(
  ticket: { isSupport?: boolean | null; status?: string | null } | null | undefined
): boolean {
  if (!ticket) return false;
  if (ticket.isSupport === true) return true;
  return String(ticket.status || "").toLowerCase() === SUPPORT_TICKET_STATUS;
}

export function buildSupportTicketCreate(input: {
  contactId: number;
  companyId: number;
  whatsappId: number;
  unreadMessages: number;
  userId?: number | null;
}) {
  return {
    contactId: input.contactId,
    companyId: input.companyId,
    whatsappId: input.whatsappId,
    status: SUPPORT_TICKET_STATUS,
    isSupport: true,
    isGroup: false,
    unreadMessages: input.unreadMessages,
    userId: input.userId ?? null,
    queueId: null,
    integrationId: null,
    promptId: null,
    useIntegration: false,
    chatbot: false
  };
}
