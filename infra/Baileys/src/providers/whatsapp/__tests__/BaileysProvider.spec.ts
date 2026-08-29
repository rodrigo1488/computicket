import BaileysProvider from "../BaileysProvider";
import Whatsapp from "../../../models/Whatsapp";

jest.mock("../../../helpers/GetWhatsappWbot");

const GetWhatsappWbot = require("../../../helpers/GetWhatsappWbot").default;

describe("BaileysProvider", () => {
  const mockSendMessage = jest.fn().mockResolvedValue({ key: { id: "msg1", remoteJid: "jid" } });
  const mockWhatsapp = { id: 1, status: "CONNECTED" } as Whatsapp;

  beforeEach(() => {
    jest.clearAllMocks();
    GetWhatsappWbot.mockResolvedValue({
      sendMessage: mockSendMessage
    });
  });

  describe("sendMessage (buildChatJid via chatId)", () => {
    it("passa JID completo quando number já contém @", async () => {
      await BaileysProvider.sendMessage(
        mockWhatsapp,
        "120363123456789012@g.us",
        "test"
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        "120363123456789012@g.us",
        expect.any(Object),
        expect.any(Object)
      );
    });

    it("adiciona @s.whatsapp.net quando number não contém @ e tem <= 15 dígitos", async () => {
      await BaileysProvider.sendMessage(
        mockWhatsapp,
        "5511999999999",
        "test"
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        "5511999999999@s.whatsapp.net",
        expect.any(Object),
        expect.any(Object)
      );
    });

    it("adiciona @g.us quando number sem @ tem mais de 15 dígitos", async () => {
      await BaileysProvider.sendMessage(
        mockWhatsapp,
        "120363123456789012",
        "test"
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        "120363123456789012@g.us",
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});
