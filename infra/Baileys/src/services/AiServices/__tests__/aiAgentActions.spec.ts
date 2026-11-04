import {
  completionTokenBudget,
  conversationTurns,
  decideIdleAlert,
  parseAgendaCommands,
  parseUserTransferName,
  sanitizeCustomerReply,
  shouldForceKnowledgeHandoff,
  splitWhatsAppText
} from "../aiAgentActions";

describe("ações do agente de WhatsApp", () => {
  it("extrai o atendente pedido na transferência", () => {
    expect(
      parseUserTransferName("Claro. Ação: Transferir para o atendente [Usuário: Maria Souza]")
    ).toBe("Maria Souza");
    expect(parseUserTransferName("Só uma resposta normal.")).toBeNull();
  });

  it("extrai o comando de visita na agenda", () => {
    const commands = parseAgendaCommands(
      'Vou marcar. [AGENDA]{"title":"Visita","appointment_date":"2026-11-04T14:00:00","tecnico":"Ana","description":"Troca de nobreak"}[/AGENDA]'
    );
    expect(commands).toEqual([
      {
        title: "Visita",
        appointment_date: "2026-11-04T14:00:00",
        tecnico: "Ana",
        description: "Troca de nobreak",
        user_id: undefined
      }
    ]);
    expect(parseAgendaCommands("[AGENDA]nao-json[/AGENDA]")).toEqual([]);
  });

  it("transfere pergunta factual quando a base não tem fonte", () => {
    expect(
      shouldForceKnowledgeHandoff({
        answerFromKnowledge: true,
        hasEvidence: false,
        userText: "Qual o horário de atendimento?",
        alreadyTransferring: false,
        alreadyScheduling: false
      })
    ).toBe(true);
    expect(
      shouldForceKnowledgeHandoff({
        answerFromKnowledge: true,
        hasEvidence: true,
        userText: "Qual o horário de atendimento?",
        alreadyTransferring: false,
        alreadyScheduling: false
      })
    ).toBe(false);
    expect(
      shouldForceKnowledgeHandoff({
        answerFromKnowledge: true,
        hasEvidence: false,
        userText: "Oi, bom dia",
        alreadyTransferring: false,
        alreadyScheduling: false
      })
    ).toBe(false);
  });
});

describe("alerta de conversa parada", () => {
  const now = new Date("2026-11-04T15:00:00.000Z");

  it("não reenvia o mesmo messageId", () => {
    expect(
      decideIdleAlert({
        enabled: true,
        groupJid: "120363@g.us",
        idleMinutes: 30,
        lastFromMe: false,
        lastMessageAt: new Date("2026-11-04T14:00:00.000Z"),
        now,
        alreadyAlerted: true,
        status: "pending"
      })
    ).toBe(false);
  });

  it("alerta quando o cliente espera além do prazo e ainda não houve aviso", () => {
    expect(
      decideIdleAlert({
        enabled: true,
        groupJid: "120363@g.us",
        idleMinutes: 30,
        lastFromMe: false,
        lastMessageAt: new Date("2026-11-04T14:00:00.000Z"),
        now,
        alreadyAlerted: false,
        status: "pending"
      })
    ).toBe(true);
    expect(
      decideIdleAlert({
        enabled: true,
        groupJid: "120363@g.us",
        idleMinutes: 30,
        lastFromMe: true,
        lastMessageAt: new Date("2026-11-04T14:00:00.000Z"),
        now,
        alreadyAlerted: false,
        status: "pending"
      })
    ).toBe(false);
  });

  it("reserva saída longa no Gemini mesmo com prompt gigante", () => {
    const huge = "regra ".repeat(20000);
    expect(completionTokenBudget("gemini", 800, { prompt: huge })).toBe(8192);
    expect(completionTokenBudget("openai", 800, { prompt: huge })).toBeLessThan(512);
  });

  it("divide o texto do WhatsApp sem cortar no meio da palavra", () => {
    const text = `${"Primeiro bloco. ".repeat(200)}\n\n${"Segundo bloco. ".repeat(200)}`;
    const parts = splitWhatsAppText(text, 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(part => part.length <= 500)).toBe(true);
    expect(parts.join(" ").includes("Primeiro bloco.")).toBe(true);
  });

  it("mantém o histórico e não repete a fala atual", () => {
    const turns = conversationTurns(
      [
        { fromMe: false, body: "Ola", mediaType: "conversation" },
        { fromMe: true, body: "Olá, Rodrigo! Como posso ajudar?", mediaType: "conversation" },
        { fromMe: false, body: "Erro de digest value", mediaType: "extendedTextMessage" },
        { fromMe: true, body: "nota interna", mediaType: "conversation", isInternal: true }
      ],
      "Erro de digest value"
    );
    expect(turns.map(turn => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[2].content).toBe("Erro de digest value");
  });

  it("remove chave e json soltos da resposta", () => {
    expect(
      sanitizeCustomerReply("Entendi, Rodrigo.\n\nSiga estes passos: 1. Abra o Clipp.\n}")
    ).toBe("Entendi, Rodrigo.\n\nSiga estes passos: 1. Abra o Clipp.");
    expect(sanitizeCustomerReply("}")).toBe("");
  });
});
