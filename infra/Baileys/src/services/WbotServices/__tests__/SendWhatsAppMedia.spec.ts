import SendWhatsAppMedia from "../SendWhatsAppMedia";
import type Ticket from "../../../models/Ticket";

const mockSendMedia = jest.fn().mockResolvedValue({
  key: { id: "msg1", remoteJid: "jid" }
});

jest.mock("../../WhatsAppService", () => ({
  __esModule: true,
  default: {
    sendMedia: mockSendMedia
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

describe("SendWhatsAppMedia", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("envia mídia para JID privado quando ticket não é grupo", async () => {
    const ticket = {
      id: 1,
      contactId: 1,
      companyId: 1,
      contact: { id: 1, number: "5511999999999" },
      isGroup: false,
      groupContact: null,
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Ticket;

    await SendWhatsAppMedia({
      media: {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        originalname: "test.jpg"
      } as Express.Multer.File,
      ticket,
      body: "Legenda"
    });

    expect(mockSendMedia).toHaveBeenCalledWith(
      expect.anything(),
      "5511999999999@s.whatsapp.net",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("envia mídia para JID do grupo quando ticket é grupo", async () => {
    const ticket = {
      id: 1,
      contactId: 1,
      companyId: 1,
      contact: { id: 1, number: "120363123456789012" },
      isGroup: true,
      groupContact: { id: 2, number: "120363123456789012" },
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Ticket;

    await SendWhatsAppMedia({
      media: {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        originalname: "test.jpg"
      } as Express.Multer.File,
      ticket,
      body: "Legenda"
    });

    expect(mockSendMedia).toHaveBeenCalledWith(
      expect.anything(),
      "120363123456789012@g.us",
      expect.any(String),
      expect.any(Object)
    );
  });
});
