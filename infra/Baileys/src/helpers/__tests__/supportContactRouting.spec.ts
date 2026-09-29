import {
  SUPPORT_TICKET_STATUS,
  buildSupportTicketCreate,
  isSupportTicket,
  shouldBypassHelpdesk
} from "../supportContactRouting";

describe("roteamento de contato de suporte", () => {
  it("desvia do Help Desk quando o contato privado está marcado como suporte", () => {
    expect(shouldBypassHelpdesk({ isSupport: true }, false)).toBe(true);
  });

  it("mantém o fluxo normal para cliente e para grupo", () => {
    expect(shouldBypassHelpdesk({ isSupport: false }, false)).toBe(false);
    expect(shouldBypassHelpdesk(null, false)).toBe(false);
    expect(shouldBypassHelpdesk({ isSupport: true }, true)).toBe(false);
  });

  it("reconhece ticket de suporte pelo status ou pela flag", () => {
    expect(isSupportTicket({ status: "support", isSupport: false })).toBe(true);
    expect(isSupportTicket({ status: "open", isSupport: true })).toBe(true);
    expect(isSupportTicket({ status: "pending", isSupport: false })).toBe(false);
    expect(isSupportTicket({ status: "open" })).toBe(false);
  });

  it("cria a conversa fora do Help Desk, sem fila e sem bot", () => {
    const attrs = buildSupportTicketCreate({
      contactId: 9,
      companyId: 1,
      whatsappId: 4,
      unreadMessages: 1,
      userId: null
    });
    expect(attrs.status).toBe(SUPPORT_TICKET_STATUS);
    expect(attrs.status).not.toBe("pending");
    expect(attrs.status).not.toBe("open");
    expect(attrs.isSupport).toBe(true);
    expect(attrs.queueId).toBeNull();
    expect(attrs.promptId).toBeNull();
    expect(attrs.integrationId).toBeNull();
    expect(attrs.useIntegration).toBe(false);
    expect(attrs.chatbot).toBe(false);
  });
});
