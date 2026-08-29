import { getChatJid } from "../chatJid";

describe("getChatJid", () => {
  it("retorna JID privado quando ticket não é grupo", () => {
    const ticket = {
      contact: { number: "5511999999999" },
      isGroup: false,
      groupContact: null as { number: string } | null
    };
    expect(getChatJid(ticket)).toBe("5511999999999@s.whatsapp.net");
  });

  it("retorna JID do grupo com groupContact quando ticket é grupo", () => {
    const ticket = {
      contact: { number: "5511999999999" },
      isGroup: true,
      groupContact: { number: "120363123456789012" }
    };
    expect(getChatJid(ticket)).toBe("120363123456789012@g.us");
  });

  it("retorna JID do grupo usando contact quando ticket é grupo sem groupContact", () => {
    const ticket = {
      contact: { number: "120363123456789012" },
      isGroup: true,
      groupContact: undefined
    };
    expect(getChatJid(ticket)).toBe("120363123456789012@g.us");
  });

  it("retorna JID do grupo usando contact quando groupContact é null", () => {
    const ticket = {
      contact: { number: "120363123456789012" },
      isGroup: true,
      groupContact: null
    };
    expect(getChatJid(ticket)).toBe("120363123456789012@g.us");
  });
});
