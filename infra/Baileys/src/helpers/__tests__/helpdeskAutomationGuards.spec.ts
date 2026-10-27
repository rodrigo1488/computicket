import {
  decideCompanyAutoClose,
  isFeatureEnabled,
  shouldCloseForConnectionExpiry,
  shouldStartSectorAutomation,
  shouldSuppressRepeatedMenu
} from "../helpdeskAutomationGuards";

const minute = 60 * 1000;

describe("interruptores do help desk", () => {
  it("trata flag ausente como ligado e disabled como desligado", () => {
    expect(isFeatureEnabled(undefined)).toBe(true);
    expect(isFeatureEnabled("")).toBe(true);
    expect(isFeatureEnabled("enabled")).toBe(true);
    expect(isFeatureEnabled("disabled")).toBe(false);
    expect(isFeatureEnabled("DISABLED")).toBe(false);
  });

  it("não inicia saudação nem menu quando o interruptor está desligado", () => {
    expect(
      shouldStartSectorAutomation({
        sectorMenuEnabled: false,
        requestedMenu: true,
        alreadyShown: false
      })
    ).toBe(false);
  });

  it("manda o menu na primeira mensagem e não repete oi no mesmo ticket", () => {
    expect(
      shouldStartSectorAutomation({
        sectorMenuEnabled: true,
        requestedMenu: false,
        alreadyShown: false
      })
    ).toBe(true);
    expect(
      shouldStartSectorAutomation({
        sectorMenuEnabled: true,
        requestedMenu: false,
        alreadyShown: true
      })
    ).toBe(false);
  });

  it("o # pede o menu de novo quando o interruptor está ligado", () => {
    expect(
      shouldStartSectorAutomation({
        sectorMenuEnabled: true,
        requestedMenu: true,
        alreadyShown: true
      })
    ).toBe(true);
  });
});

describe("menu de setor repetido", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  it("deixa passar o primeiro envio", () => {
    expect(
      shouldSuppressRepeatedMenu({
        requestedMenu: false,
        amountUsedBotQueues: 0,
        maxUseBotQueues: 3,
        chatbotAt: null,
        now,
        timeUseBotQueuesMinutes: 10
      })
    ).toBe(false);
  });

  it("segura oi dentro da janela depois do primeiro menu", () => {
    expect(
      shouldSuppressRepeatedMenu({
        requestedMenu: false,
        amountUsedBotQueues: 1,
        maxUseBotQueues: 3,
        chatbotAt: new Date(now.getTime() - 2 * minute),
        now,
        timeUseBotQueuesMinutes: 10
      })
    ).toBe(true);
  });

  it("não segura o #", () => {
    expect(
      shouldSuppressRepeatedMenu({
        requestedMenu: true,
        amountUsedBotQueues: 3,
        maxUseBotQueues: 3,
        chatbotAt: new Date(now.getTime() - minute),
        now,
        timeUseBotQueuesMinutes: 10
      })
    ).toBe(false);
  });
});

describe("encerramento automático", () => {
  const now = Date.parse("2026-10-27T12:00:00.000Z");
  const base = {
    autoCloseEnabled: true,
    queueId: 4,
    userId: 9,
    chatbot: false,
    flowWebhook: false,
    useIntegration: false,
    lastMessage: "preciso de ajuda",
    updatedAt: new Date(now - 3 * minute),
    now,
    warnAfterMs: 5 * minute,
    closeAfterMs: 10 * minute,
    cached: null
  };

  it("não fecha quando o interruptor está desligado", () => {
    expect(
      decideCompanyAutoClose({
        ...base,
        autoCloseEnabled: false,
        updatedAt: new Date(now - 60 * minute)
      }).type
    ).toBe("skip");
  });

  it("não fecha ticket que ainda espera o setor", () => {
    expect(
      decideCompanyAutoClose({
        ...base,
        queueId: null,
        userId: null,
        updatedAt: new Date(now - 60 * minute)
      }).type
    ).toBe("skip");
  });

  it("não usa saudação ou menu automático como âncora", () => {
    expect(
      decideCompanyAutoClose({
        ...base,
        lastMessage: "\u200eOlá! Escolha o setor:\n\n*[ 1 ]* - Suporte",
        updatedAt: new Date(now - 60 * minute)
      }).type
    ).toBe("skip");
  });

  it("fecha conversa já na fila só depois do prazo", () => {
    expect(decideCompanyAutoClose(base).type).toBe("wait");
    expect(
      decideCompanyAutoClose({
        ...base,
        updatedAt: new Date(now - 6 * minute)
      }).type
    ).toBe("warn");
    expect(
      decideCompanyAutoClose({
        ...base,
        updatedAt: new Date(now - 11 * minute)
      }).type
    ).toBe("close");
  });

  it("reinicia a contagem quando o atendente fala", () => {
    expect(
      decideCompanyAutoClose({
        ...base,
        lastMessage: "já estou vendo",
        updatedAt: new Date(now - minute)
      }).type
    ).toBe("wait");
  });
});

describe("expiresTicket em horas", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  const openTicket = {
    status: "open",
    isGroup: false,
    fromMe: true,
    queueId: 2,
    userId: 3,
    chatbot: false,
    flowWebhook: false,
    useIntegration: false,
    expiresTicketHours: 1,
    now
  };

  it("não fecha meia hora depois quando o prazo é de 1 hora", () => {
    expect(
      shouldCloseForConnectionExpiry({
        ...openTicket,
        updatedAt: new Date(now.getTime() - 30 * minute)
      })
    ).toBe(false);
  });

  it("fecha depois de 1 hora numa conversa já assumida", () => {
    expect(
      shouldCloseForConnectionExpiry({
        ...openTicket,
        updatedAt: new Date(now.getTime() - 61 * minute)
      })
    ).toBe(true);
  });

  it("não fecha ticket ainda no menu", () => {
    expect(
      shouldCloseForConnectionExpiry({
        ...openTicket,
        queueId: null,
        userId: null,
        updatedAt: new Date(now.getTime() - 5 * 60 * minute)
      })
    ).toBe(false);
  });
});
