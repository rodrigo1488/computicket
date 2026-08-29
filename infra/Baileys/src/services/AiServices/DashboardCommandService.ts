import User from "../../models/User";
import { AIProviderSelector } from "./AIProviderSelector";
import { ChatMessage } from "./AIProviderInterface";
import CreateTaskService from "../TaskServices/CreateTaskService";
import CreateUserAppointmentService from "../UserAppointmentService/CreateService";

interface DashboardCommandRequest {
  companyId: number;
  userId: number;
  command: string;
}

interface DashboardCommandResult {
  success: boolean;
  action: "create_task" | "create_appointment" | "none";
  message: string;
  task?: any;
  appointment?: any;
}

interface ParsedCommand {
  action?: string;
  title?: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  assignedTo?: string;
  startTime?: string;
  endTime?: string;
  response?: string;
}

const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const extractJsonObject = (text: string): string | null => {
  if (!text) return null;

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
};

const parseDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
};

const mapPriority = (value?: string): "low" | "medium" | "high" | "urgent" => {
  const normalized = normalizeText(value || "medium");
  if (["baixa", "low"].includes(normalized)) return "low";
  if (["alta", "high"].includes(normalized)) return "high";
  if (["urgente", "urgent"].includes(normalized)) return "urgent";
  return "medium";
};

const mapAction = (value?: string): "create_task" | "create_appointment" | "none" => {
  const normalized = normalizeText(value || "none");

  if (["create_task", "criar_tarefa", "tarefa", "task"].includes(normalized)) {
    return "create_task";
  }

  if (["create_appointment", "create_schedule", "criar_agendamento", "agendamento", "appointment", "schedule"].includes(normalized)) {
    return "create_appointment";
  }

  return "none";
};

const findUserByName = async (companyId: number, name?: string): Promise<number | undefined> => {
  if (!name?.trim()) return undefined;

  const users = await User.findAll({
    where: { companyId },
    attributes: ["id", "name"],
    raw: true
  }) as Array<{ id: number; name: string }>;

  const target = normalizeText(name);
  const exact = users.find(u => normalizeText(u.name) === target);
  if (exact) return exact.id;

  const partial = users.find(u => {
    const candidate = normalizeText(u.name);
    return candidate.includes(target) || target.includes(candidate);
  });

  return partial?.id;
};

const DashboardCommandService = async ({
  companyId,
  userId,
  command
}: DashboardCommandRequest): Promise<DashboardCommandResult> => {
  const provider = await AIProviderSelector.getProvider(companyId, "chat");

  const now = new Date();
  const nowIsoLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  
  // Calcular datas de referência para facilitar interpretação
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const nowHour = now.getHours();
  const nowMinute = now.getMinutes();

  const systemPrompt = [
    "Voce e um parser de comandos do dashboard.",
    "Responda SOMENTE um JSON valido (sem markdown).",
    "",
    "PRIORIDADE: Se o usuario pedir para AGENDAR, MARCAR REUNIAO, MARCAR ENCONTRO, CRIAR AGENDAMENTO -> use action=create_appointment",
    "Se o usuario pedir para CRIAR TAREFA, LEMBRAR DE ALGO -> use action=create_task",
    "",
    "Acoes disponiveis:",
    "- create_appointment: Para agendamentos, reunioes, encontros, compromissos com data/hora especifica",
    "- create_task: Para tarefas, lembretes, coisas a fazer",
    "- none: Apenas se nao conseguir identificar o comando",
    "",
    "Formato de saida (JSON):",
    '{"action":"create_task|create_appointment|none","title":"titulo do agendamento/tarefa","description":"descricao opcional","priority":"low|medium|high|urgent","dueDate":"YYYY-MM-DDTHH:mm","startTime":"YYYY-MM-DDTHH:mm","endTime":"YYYY-MM-DDTHH:mm","assignedTo":"nome opcional","response":"mensagem curta"}',
    "",
    "DATAS E HORARIOS - CONVERSAO OBRIGATORIA:",
    `- Data/hora atual de referencia: ${nowIsoLocal}`,
    `- HOJE = ${todayStr}`,
    `- AMANHA = ${tomorrowStr}`,
    "- Se o usuario disser 'hoje', use a data de HOJE acima.",
    "- Se o usuario disser 'amanha' ou 'amanha', use a data de AMANHA acima.",
    "- Se o usuario disser 'depois de amanha', some 2 dias a data de hoje.",
    "- Se o usuario disser dia da semana (segunda, terca, quarta, etc.), calcule a proxima ocorrencia dessa semana.",
    "- Se o usuario disser apenas hora (ex: '12:30', '10h', '14h30'), combine com a data mencionada (hoje/amanha) ou use hoje se nao mencionar.",
    "- SEMPRE use o formato YYYY-MM-DDTHH:mm (ex: 2026-02-28T12:30).",
    "- NUNCA use datas antigas ou do passado. Se nao tiver certeza, use a data de hoje ou amanha.",
    "",
    "IMPORTANTE:",
    "- Para create_appointment: SEMPRE preencha startTime (obrigatorio) no formato YYYY-MM-DDTHH:mm. Se nao tiver endTime, calcule 1h depois do startTime.",
    "- Para create_task: use dueDate se tiver prazo especifico.",
    "- Se o usuario mencionar um nome (ex: 'com chesterfield', 'com joao'), coloque no campo assignedTo.",
    "",
    "Idioma: portugues do Brasil."
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: command }
  ];

  const raw = await provider.chat(messages, { temperature: 0.1, maxTokens: 500, topP: 0.9 });
  const jsonText = extractJsonObject(raw);

  if (!jsonText) {
    console.log("❌ DashboardCommandService: Nao conseguiu extrair JSON da resposta da IA");
    console.log("Resposta bruta:", raw?.substring(0, 200));
    return {
      success: false,
      action: "none",
      message: "Nao consegui interpretar o comando. Tente algo como: criar tarefa ligar para cliente amanha as 10h."
    };
  }

  let parsed: ParsedCommand;
  try {
    parsed = JSON.parse(jsonText);
    console.log("✅ DashboardCommandService: JSON parseado com sucesso:", {
      action: parsed.action,
      title: parsed.title?.substring(0, 50),
      startTime: parsed.startTime,
      dueDate: parsed.dueDate
    });
  } catch (_err) {
    console.log("❌ DashboardCommandService: Erro ao fazer parse do JSON:", _err);
    console.log("JSON recebido:", jsonText?.substring(0, 200));
    return {
      success: false,
      action: "none",
      message: "Nao consegui interpretar o comando em formato estruturado."
    };
  }

  const action = mapAction(parsed.action);
  console.log(`🔍 DashboardCommandService: Acao mapeada: ${parsed.action} -> ${action}`);

  if (action === "create_task") {
    if (!parsed.title?.trim()) {
      return {
        success: false,
        action: "none",
        message: parsed.response || "Para criar a tarefa preciso pelo menos do titulo."
      };
    }

    const assignedToId = await findUserByName(companyId, parsed.assignedTo);
    const dueDate = parseDate(parsed.dueDate);

    const task = await CreateTaskService({
      title: parsed.title.trim(),
      description: parsed.description?.trim() || "",
      priority: mapPriority(parsed.priority),
      status: "pending",
      dueDate,
      userId,
      assignedToId,
      companyId
    });

    return {
      success: true,
      action,
      message: parsed.response || `Tarefa criada com sucesso: ${task.title}`,
      task
    };
  }

  if (action === "create_appointment") {
    console.log("📅 DashboardCommandService: Processando criacao de agendamento...");
    
    if (!parsed.title?.trim()) {
      console.log("❌ DashboardCommandService: Titulo vazio");
      return {
        success: false,
        action: "none",
        message: parsed.response || "Para criar o agendamento preciso de um titulo."
      };
    }

    const startTime = parseDate(parsed.startTime || parsed.dueDate);
    if (!startTime) {
      console.log("❌ DashboardCommandService: Data/hora invalida", {
        startTime: parsed.startTime,
        dueDate: parsed.dueDate
      });
      return {
        success: false,
        action: "none",
        message: parsed.response || "Informe data e hora do agendamento (ex: amanha as 14h)."
      };
    }
    
    // Validar se a data não está no passado
    const now = new Date();
    if (startTime < now) {
      console.log("❌ DashboardCommandService: Data no passado detectada", {
        startTime: startTime.toISOString(),
        now: now.toISOString()
      });
      return {
        success: false,
        action: "none",
        message: "A data/hora do agendamento não pode ser no passado. Por favor, informe uma data futura."
      };
    }

    const endTime = parseDate(parsed.endTime) || new Date(startTime.getTime() + 60 * 60 * 1000);
    const assignedUserId = await findUserByName(companyId, parsed.assignedTo);

    console.log("📅 DashboardCommandService: Criando agendamento com:", {
      title: parsed.title.trim(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      userId,
      assignedUserId
    });

    try {
      const appointment = await CreateUserAppointmentService({
        title: parsed.title.trim(),
        description: parsed.description?.trim() || "",
        startTime,
        endTime,
        userId,
        assignedUserId,
        companyId,
        status: "pending",
        reminderMinutes: 15
      });

      console.log("✅ DashboardCommandService: Agendamento criado com sucesso:", {
        id: appointment.id,
        title: appointment.title
      });

      return {
        success: true,
        action,
        message: parsed.response || `Agendamento criado com sucesso: ${appointment.title}`,
        appointment
      };
    } catch (err: any) {
      console.error("❌ DashboardCommandService: Erro ao criar agendamento:", err);
      return {
        success: false,
        action: "none",
        message: `Erro ao criar agendamento: ${err.message || "Erro desconhecido"}`
      };
    }
  }

  return {
    success: false,
    action: "none",
    message: parsed.response || "Comando reconhecido, mas sem acao executavel."
  };
};

export default DashboardCommandService;
