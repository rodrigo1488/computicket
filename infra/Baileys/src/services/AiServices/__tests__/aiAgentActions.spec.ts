import {
  decideIdleAlert,
  parseAgendaCommands,
  parseUserTransferName,
  shouldForceKnowledgeHandoff
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
});
