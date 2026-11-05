import {
  completionTokenBudget,
  conversationTurns,
  decideIdleScan,
  completeGroupFallback,
  formatGroupAlertSummary,
  summaryLooksComplete,
  formatIdleAlertContext,
  parseIdleAlertDecision,
  formatTemporaryNotices,
  noticeTextFromMention,
  groupMessageAddressesAgent,
  noticeSubjectMatches,
  parseTemporaryNotice,
  temporaryNoticeExpiry,
  matchPersonByName,
  parseAgendaCommands,
  parseUserTransferName,
  formatTransferNote,
  parseRecommendedQueueName,
  sanitizeCustomerReply,
  shouldForceKnowledgeHandoff,
  signAgentMessage,
  splitCustomerAndInternalNote,
  splitWhatsAppText
} from "../aiAgentActions";

describe("ações do agente de WhatsApp", () => {
  it("reconhece nome, número e menção do WhatsApp vinculado", () => {
    const identity = {
      names: ["Soraia", "Suporte Computicket"],
      phoneJids: ["5511999887766:12@s.whatsapp.net", "999@lid"]
    };
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "Soraia, o CLIPP não emite",
      mentionedJids: []
    })).toBe(true);
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "soraia pode ver?",
      mentionedJids: []
    })).toBe(true);
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "liga no (11) 99988-7766",
      mentionedJids: []
    })).toBe(true);
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "alguém vê isso?",
      mentionedJids: ["5511999887766@s.whatsapp.net"]
    })).toBe(true);
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "alguém vê isso?",
      mentionedJids: ["999@lid"]
    })).toBe(true);
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "Soraiana perguntou do chamado",
      mentionedJids: []
    })).toBe(false);
    expect(groupMessageAddressesAgent({
      ...identity,
      body: "só respondendo a mensagem dela",
      mentionedJids: ["5511888777666@s.whatsapp.net"]
    })).toBe(false);
    expect(groupMessageAddressesAgent({
      names: ["IA"],
      phoneJids: identity.phoneJids,
      body: "a IA do grupo",
      mentionedJids: []
    })).toBe(false);
  });

  it("guarda o aviso temporário só até o fim do dia em Brasília", () => {
    const notice = parseTemporaryNotice('{"acao":"guardar","texto":"A SEFAZ MG está fora do ar hoje.","validade":"hoje"}');
    expect(notice).toEqual({
      action: "guardar",
      text: "A SEFAZ MG está fora do ar hoje.",
      days: 0
    });
    const now = new Date("2026-11-05T13:00:00.000Z");
    expect(temporaryNoticeExpiry(0, now).toISOString()).toBe("2026-11-06T02:59:59.000Z");
    expect(temporaryNoticeExpiry(1, now).toISOString()).toBe("2026-11-07T02:59:59.000Z");
    expect(parseTemporaryNotice("sem json")).toBeNull();
    expect(noticeSubjectMatches("A SEFAZ MG está fora do ar hoje.", "a sefaz voltou")).toBe(true);
    expect(noticeSubjectMatches("A SEFAZ MG está fora do ar hoje.", "hoje acabou")).toBe(false);
    expect(formatTemporaryNotices([])).toBe("");
    expect(formatTemporaryNotices([{ body: "A SEFAZ MG está fora do ar hoje." }])).toContain("SEFAZ MG");
    expect(noticeTextFromMention("Soraia, a SEFAZ MG está fora do ar hoje", ["Soraia"])).toBe(
      "a SEFAZ MG está fora do ar hoje"
    );
  });

  it("encontra Rogério pelo primeiro nome, com ou sem acento", () => {
    const people = [{ id: 3, name: "Rogério Silva" }, { id: 4, name: "Ana Técnica" }];
    expect(matchPersonByName(people, "rogerio")?.id).toBe(3);
    expect(matchPersonByName(people, "Rogério")?.id).toBe(3);
    expect(matchPersonByName(people, "Ana")?.id).toBe(4);
  });

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
  const waiting = new Date("2026-11-04T14:00:00.000Z");
  const base = {
    ticketStatus: "pending",
    groupAlertStatus: null as number | null,
    groupAlertMessageId: null as string | null,
    lastMessageId: "m1",
    lastFromMe: false,
    lastMessageAt: waiting,
    idleMinutes: 30,
    now
  };

  it("marca 0 quando o cliente espera além do prazo", () => {
    expect(decideIdleScan(base)).toEqual({ action: "queue", messageId: "m1" });
  });

  it("não marca de novo a mesma mensagem já avisada", () => {
    expect(decideIdleScan({
      ...base,
      groupAlertStatus: 1,
      groupAlertMessageId: "m1"
    })).toEqual({ action: "none" });
  });

  it("recomeça o ciclo quando chega outra mensagem do cliente", () => {
    expect(decideIdleScan({
      ...base,
      groupAlertStatus: 1,
      groupAlertMessageId: "m0",
      lastMessageId: "m1"
    })).toEqual({ action: "queue", messageId: "m1" });
  });

  it("pede interpretação quando ninguém fala além do prazo", () => {
    expect(decideIdleScan({
      ...base,
      lastFromMe: true
    })).toEqual({ action: "ask", messageId: "m1" });
    expect(decideIdleScan({
      ...base,
      lastFromMe: true,
      groupAlertStatus: 2,
      groupAlertMessageId: "m1"
    })).toEqual({ action: "none" });
  });

  it("limpa o status se o ticket fechou ou a última fala ainda é recente", () => {
    expect(decideIdleScan({
      ...base,
      ticketStatus: "closed",
      groupAlertStatus: 0,
      groupAlertMessageId: "m1"
    })).toEqual({ action: "clear" });
    expect(decideIdleScan({
      ...base,
      lastFromMe: true,
      lastMessageAt: new Date("2026-11-04T14:50:00.000Z"),
      groupAlertStatus: 0,
      groupAlertMessageId: "antiga"
    })).toEqual({ action: "clear" });
  });

  it("entende o não da IA e monta o contexto com o histórico", () => {
    expect(parseIdleAlertDecision('{"alertar":false,"resumo":"já se despediram"}')).toEqual({
      alert: false,
      summary: "já se despediram"
    });
    expect(parseIdleAlertDecision("sem json")).toBeNull();
    expect(formatIdleAlertContext({
      contactName: "Ana",
      ticketStatus: "open",
      assigneeName: "Maria Souza",
      minutesSinceAny: 40,
      minutesSinceCustomer: 40,
      transcript: "Cliente: o sistema caiu"
    })).toContain("Cliente: o sistema caiu");
    expect(formatGroupAlertSummary('{"resumo":"Ana espera há 40 min por causa de um erro no sistema."}'))
      .toBe("*Resumo do contexto*\nAna espera há 40 min por causa de um erro no sistema.");
    expect(summaryLooksComplete("Cliente: Açougue São")).toBe(false);
    const fallback = completeGroupFallback({
      contactName: "Açougue São João",
      assigneeName: "Maria Souza",
      minutes: 35,
      lastCustomerText: "O sistema não abre o caixa desde cedo"
    });
    expect(fallback.endsWith(".")).toBe(true);
    expect(fallback).toContain("Responsável: Maria Souza.");
    expect(fallback).toContain("O sistema não abre o caixa desde cedo.");
    expect(summaryLooksComplete(fallback)).toBe(true);
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

  it("assina com o nome do agente e não duplica a assinatura", () => {
    expect(signAgentMessage("Olá, Rodrigo!", "Soraia")).toBe("*SORAIA*\nOlá, Rodrigo!");
    expect(signAgentMessage("*SORAIA*\nOlá, Rodrigo!", "Soraia")).toBe("*SORAIA*\nOlá, Rodrigo!");
    expect(signAgentMessage("Soraia: Entendi, Rodrigo.", "Soraia")).toBe("*SORAIA*\nEntendi, Rodrigo.");
    expect(signAgentMessage("   ", "Soraia")).toBe("");
  });

  it("tira a nota interna e a citação de ticket da resposta do cliente", () => {
    const raw = [
      "Soraia: Siga os passos (segundo o ticket #1156 — IMPRESSORA TRAVADA).",
      "",
      "---",
      "*Mensagem Interna de Transferência*",
      "- *Setor Recomendado:* MANUTENÇÃO (ID: 3) ou SUPORTE (ID: 1)"
    ].join("\n");
    const split = splitCustomerAndInternalNote(raw);
    expect(split.internalNote).toContain("MANUTENÇÃO");
    expect(split.customer).not.toContain("Mensagem Interna");
    expect(parseRecommendedQueueName(split.internalNote)).toBe("MANUTENÇÃO");
    expect(sanitizeCustomerReply(raw)).toBe("Soraia: Siga os passos.");
  });

  it("monta a nota de encaminhamento sem inventar campo vazio", () => {
    const note = formatTransferNote({
      cliente: "Rodrigo",
      sistema: "Impressora",
      problema: "Impressora travada",
      erros: "",
      resumo: "O cliente disse que a impressora travou.",
      motivo: "Problema técnico",
      setor: "fila MANUTENÇÃO",
      solucao: "Reinicie o serviço de impressão."
    });
    expect(note).toContain("- *Cliente:* Rodrigo");
    expect(note).toContain("- *Mensagens de erro:* Não informado");
    expect(note).toContain("- *Setor recomendado:* fila MANUTENÇÃO");
    expect(note).toContain("- *Solução:* Reinicie o serviço de impressão.");
    expect(note).not.toContain("histórico");
    expect(formatTransferNote({
      cliente: "Rodrigo",
      sistema: "Impressora",
      problema: "Impressora travada",
      erros: "",
      resumo: "O cliente disse que a impressora travou.",
      motivo: "Problema técnico",
      setor: "fila MANUTENÇÃO",
      solucao: "Não informado"
    })).not.toContain("*Solução:*");
  });
});
