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
  attendanceCustomerName,
  looksLikeAppointmentRequest,
  idleAlertSource,
  looksLikeAttendanceClosure,
  staffReplyClosesAttendance,
  looksLikeOpenChatNotice,
  quotedLooksLikeIdleAlert,
  replyClosesQuotedAlert,
  replyTargetsAgent,
  noticeSubjectMatches,
  parseTemporaryNotice,
  temporaryNoticeExpiry,
  matchPersonByName,
  parseAgendaCommands,
  parseOpenChatNotices,
  parseUserTransferName,
  formatDailyReportFallback,
  dailyReportLooksUsable,
  shouldSendDailyReport,
  withDailyReportHeading,
  formatTransferNote,
  parseRecommendedQueueName,
  sanitizeCustomerReply,
  selectOpenChats,
  shouldDeferCustomerTransfer,
  shouldForceKnowledgeHandoff,
  signAgentMessage,
  splitCustomerAndInternalNote,
  splitWhatsAppText
} from "../aiAgentActions";
import { getBrazilClock } from "../../../helpers/BrazilTimezone";

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
        cliente: undefined,
        contact_number: undefined,
        user_id: undefined
      }
    ]);
    expect(parseAgendaCommands("[AGENDA]nao-json[/AGENDA]")).toEqual([]);
  });

  it("entende que o atendimento do cliente foi concluído", () => {
    const said = "O atendimento da Carol foi concluído junior... obrigado";
    const summary =
      "A cliente Carol está com o atendimento parado há 30 minutos. Ela informou que seguiu as recomendações enviadas. Responsável: Rodrigo Gomes.";
    expect(looksLikeAttendanceClosure(said)).toBe(true);
    expect(looksLikeAttendanceClosure("pode esquecer o aviso, a SEFAZ voltou")).toBe(false);
    expect(attendanceCustomerName(said, [summary], ["junior"])).toBe("Carol");
    expect(attendanceCustomerName("pode encerrar esse atendimento", [summary], ["junior"])).toBe("Carol");
  });

  it("interpreta a resposta citada ao alerta que o agente enviou", () => {
    const summary = "*JUNIOR*\n*Resumo do contexto*\nA cliente Carol está com o atendimento parado há 30 minutos.";
    expect(replyTargetsAgent({ quotedBody: summary, names: ["junior"] })).toBe(true);
    expect(replyTargetsAgent({ quotedBody: "Rogério: vou ver isso", names: ["junior"] })).toBe(false);
    expect(replyClosesQuotedAlert(summary, "concluído, obrigado")).toBe(true);
    expect(replyClosesQuotedAlert(summary, "qual o horário?")).toBe(false);
    expect(attendanceCustomerName("concluído, obrigado", [summary], ["junior"])).toBe("Carol");
    expect(quotedLooksLikeIdleAlert("A SEFAZ está fora hoje")).toBe(false);
    const rodrigo =
      "*JUNIOR*\n*Resumo do contexto*\nO cliente Rodrigo Gomes está aguardando retorno há 30 minutos após relatar que o seu Clipp não está abrindo. Responsável: ninguém.";
    expect(staffReplyClosesAttendance("Estava testando. Pode encerrar", rodrigo)).toBe(true);
    expect(staffReplyClosesAttendance("Estava testando. Pode encerrar", "", [rodrigo])).toBe(true);
    expect(attendanceCustomerName("Estava testando. Pode encerrar", [rodrigo], ["junior"])).toBe(
      "Rodrigo Gomes"
    );
    expect(staffReplyClosesAttendance("pode encerrar o aviso", rodrigo)).toBe(false);
    expect(idleAlertSource("", [rodrigo])).toBe(rodrigo);
  });

  it("entende pedido de visita e aviso para chats abertos", () => {
    expect(looksLikeAppointmentRequest("Soraia, agenda a Padaria amanhã às 14h")).toBe(true);
    expect(looksLikeAppointmentRequest("qual o horário de atendimento?")).toBe(false);
    expect(looksLikeOpenChatNotice("avisa os chats abertos que a SEFAZ voltou")).toBe(true);
    expect(looksLikeOpenChatNotice("a SEFAZ voltou")).toBe(false);
    const notices = parseOpenChatNotices(
      'Certo. [AVISAR]{"destino":"Padaria","texto":"O técnico está a caminho."}[/AVISAR]'
    );
    expect(notices).toEqual([{ target: "Padaria", text: "O técnico está a caminho." }]);
    expect(parseOpenChatNotices("[AVISAR]{}[/AVISAR]")).toEqual([]);
    const chats = [
      { name: "Padaria Central", number: "5511988880000" },
      { name: "Mercado Silva", number: "5511977770000" }
    ];
    expect(selectOpenChats(chats, "abertos").matches).toHaveLength(2);
    expect(selectOpenChats(chats, "Padaria").matches[0].name).toBe("Padaria Central");
    expect(selectOpenChats(chats, "11977770000").matches[0].name).toBe("Mercado Silva");
    expect(selectOpenChats(
      [{ name: "Ana Costa" }, { name: "Ana Souza" }],
      "Ana"
    ).ambiguous).toBe(true);
    expect(sanitizeCustomerReply('Vou avisar. [AVISAR]{"destino":"abertos","texto":"oi"}[/AVISAR]')).toBe(
      "Vou avisar."
    );
  });

  it("monta o relatório das 18:30 só dentro da janela e sem repetir o dia", () => {
    const clock = getBrazilClock(new Date("2026-11-15T21:30:00.000Z"));
    expect(clock).toEqual({ date: "2026-11-15", minuteOfDay: 18 * 60 + 30 });
    expect(shouldSendDailyReport({ date: clock.date, minuteOfDay: clock.minuteOfDay, sentOn: null })).toBe(true);
    expect(shouldSendDailyReport({
      date: clock.date,
      minuteOfDay: getBrazilClock(new Date("2026-11-15T21:29:00.000Z")).minuteOfDay,
      sentOn: null
    })).toBe(false);
    expect(shouldSendDailyReport({
      date: clock.date,
      minuteOfDay: getBrazilClock(new Date("2026-11-15T22:30:00.000Z")).minuteOfDay,
      sentOn: null
    })).toBe(false);
    expect(shouldSendDailyReport({ date: clock.date, minuteOfDay: clock.minuteOfDay, sentOn: clock.date })).toBe(false);

    const report = formatDailyReportFallback({
      dateLabel: "15/11/2026",
      pending: [{ name: "Padaria Central", status: "na fila", assignee: "", wait: "Última mensagem há 2 h." }],
      hiddenPending: 0,
      dayCount: 4,
      closedCount: 2,
      samples: ["Padaria Central: a nota não sai"]
    });
    expect(report).toContain("*Pendências*");
    expect(report).toContain("Padaria Central");
    expect(report).toContain("responsável ninguém");
    expect(report).toContain("4 conversa(s)");
    expect(dailyReportLooksUsable("*Pendências*\nNinguém esperando.\n*Conversas do dia*\nDuas conversas sobre nota.")).toBe(true);
    expect(withDailyReportHeading("*Pendências*\nNada.\n*Conversas do dia*\nCalmo.", "15/11/2026")).toContain("15/11/2026");
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
    expect(
      shouldForceKnowledgeHandoff({
        answerFromKnowledge: true,
        hasEvidence: false,
        userText: "Qual o horário de atendimento?",
        alreadyTransferring: false,
        alreadyScheduling: false,
        waitingForCustomer: true
      })
    ).toBe(false);
  });

  it("segura a transferência enquanto o cliente ainda não concluiu a fala", () => {
    expect(shouldDeferCustomerTransfer({
      userText: "Oi, bom dia",
      customerReply: "Vou encaminhar você para um atendente."
    })).toBe(true);
    expect(shouldDeferCustomerTransfer({
      userText: "preciso de ajuda",
      customerReply: "Certo, vou transferir."
    })).toBe(true);
    expect(shouldDeferCustomerTransfer({
      userText: "o caixa não abre",
      customerReply: "Qual sistema apresenta isso?"
    })).toBe(true);
    expect(shouldDeferCustomerTransfer({
      userText: "o caixa não abre",
      customerReply: "Vou encaminhar para um atendente."
    })).toBe(false);
    expect(shouldDeferCustomerTransfer({
      userText: "sim",
      customerReply: "Vou encaminhar para um atendente."
    })).toBe(false);
    expect(shouldDeferCustomerTransfer({
      userText: "quero falar com um atendente",
      customerReply: "Pode me contar o que aconteceu?"
    })).toBe(false);
    expect(shouldDeferCustomerTransfer({
      userText: "Qual o horário de atendimento?",
      customerReply: "Vou encaminhar para um atendente."
    })).toBe(false);
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
