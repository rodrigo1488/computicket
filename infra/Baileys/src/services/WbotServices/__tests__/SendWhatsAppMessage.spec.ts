import SendWhatsAppMessage from "../SendWhatsAppMessage";
import type Ticket from "../../../models/Ticket";
import type Message from "../../../models/Message";

const mockSendMessage = jest.fn().mockResolvedValue({
  key: { id: "msg1", remoteJid: "jid" }
});

jest.mock("../../WhatsAppService", () => ({
  __esModule: true,
  default: {
    sendMessage: mockSendMessage
  }
}));

jest.mock("../../../helpers/ResolveTicketWhatsApp", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({
    id: 1,
    type: "whatsapp",
    status: "CONNECTED"
  })
}));

jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: class {},
  findOne: jest.fn().mockResolvedValue(null)
}));

const ResolveTicketWhatsApp = require("../../../helpers/ResolveTicketWhatsApp").default;

describe("SendWhatsAppMessage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ResolveTicketWhatsApp.mockResolvedValue({
      id: 1,
      type: "whatsapp",
      status: "CONNECTED"
    });
  });

  it("envia para JID privado quando ticket não é grupo", async () => {
    const ticket = {
      id: 1,
      contactId: 1,
      companyId: 1,
      contact: { id: 1, number: "5511999999999" },
      isGroup: false,
      groupContact: null,
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Ticket;

    await SendWhatsAppMessage({
      body: "Olá",
      ticket
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.anything(),
      "5511999999999@s.whatsapp.net",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("envia para JID do grupo quando ticket é grupo com groupContact", async () => {
    const ticket = {
      id: 1,
      contactId: 1,
      companyId: 1,
      contact: { id: 1, number: "5511999999999" },
      isGroup: true,
      groupContact: { id: 2, number: "120363123456789012" },
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Ticket;

    await SendWhatsAppMessage({
      body: "Olá grupo",
      ticket
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.anything(),
      "120363123456789012@g.us",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("normaliza contact.number que já contém @g.us (evita JID duplicado)", async () => {
    const ticket = {
      id: 1,
      contactId: 1,
      companyId: 1,
      contact: { id: 1, number: "120363123456789012@g.us" },
      isGroup: true,
      groupContact: null,
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Ticket;

    await SendWhatsAppMessage({
      body: "Olá grupo",
      ticket
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.anything(),
      "120363123456789012@g.us",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("envia para JID do grupo usando contact quando ticket é grupo sem groupContact", async () => {
    const ticket = {
      id: 1,
      contactId: 1,
      companyId: 1,
      contact: { id: 1, number: "120363123456789012" },
      isGroup: true,
      groupContact: null,
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Ticket;

    await SendWhatsAppMessage({
      body: "Olá grupo",
      ticket
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.anything(),
      "120363123456789012@g.us",
      expect.any(String),
      expect.any(Object)
    );
  });
});
