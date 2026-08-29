/**
 * Fila em memória para jobs de IA de longa duração.
 * Sem dependências externas (Redis, BullMQ, etc.) — o Map vive no processo.
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger";

// Importações dos serviços de IA (lazy — usadas dentro de runJob)
import AgentSummaryGeminiService from "../ReportService/AgentSummaryGeminiService";
import { generateInitialMessage, generateVariations } from "./CampaignMessageGeneratorService";
import { improveMessage, analyzeChatContext, applyChatModelReplyActions } from "./ChatAIService";
import DashboardCommandService from "./DashboardCommandService";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type AiJobType =
  | "campaign_initial"
  | "campaign_variations"
  | "agent_summary"
  | "general_summary"
  | "improve_message"
  | "analyze_chat"
  | "dashboard_command";

export type AiJobStatus = "pending" | "running" | "done" | "error";

export interface AiJob {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  /** 0–100 */
  progress: number;
  phase: string;
  result: any;
  error: string | null;
  createdAt: number;
  tickIntervalId?: ReturnType<typeof setInterval>;
  cleanupTimeoutId?: ReturnType<typeof setTimeout>;
}

// ─── Fases de progresso por tipo de job ─────────────────────────────────────

const PHASES: Record<AiJobType, string[]> = {
  campaign_initial: [
    "Iniciando geração…",
    "Analisando objetivo…",
    "A IA está a criar a mensagem…",
    "Refinando…",
    "A finalizar…",
  ],
  campaign_variations: [
    "Iniciando variações…",
    "Analisando mensagem original…",
    "Criando variações criativas…",
    "Ajustando tom e estilo…",
    "A finalizar…",
  ],
  agent_summary: [
    "Buscando mensagens…",
    "Analisando atendimentos…",
    "A IA está a resumir…",
    "Consolidando insights…",
    "A finalizar…",
  ],
  general_summary: [
    "Buscando dados gerais…",
    "Analisando todos os atendentes…",
    "A IA está a gerar o resumo…",
    "Consolidando…",
    "A finalizar…",
  ],
  improve_message: [
    "Analisando contexto…",
    "A IA está a melhorar a mensagem…",
    "Refinando texto…",
    "Verificando ações…",
    "A finalizar…",
  ],
  analyze_chat: [
    "Buscando histórico…",
    "Analisando conversa…",
    "A IA está a processar…",
    "Gerando insights…",
    "A finalizar…",
  ],
  dashboard_command: [
    "Interpretando comando…",
    "A IA está a processar…",
    "Executando ação…",
    "Verificando resultado…",
    "A finalizar…",
  ],
};

// Checkpoints de progresso (%) para cada fase (5 fases → 5 pontos)
const PROGRESS_CHECKPOINTS = [5, 20, 45, 70, 85];

// ─── Mapa global ─────────────────────────────────────────────────────────────

const jobMap = new Map<string, AiJob>();

const JOB_TTL_MS = 10 * 60 * 1000; // 10 min — janela para o frontend buscar o resultado

// ─── Progresso simulado ──────────────────────────────────────────────────────

function startProgressTick(job: AiJob): void {
  let phaseIdx = 0;
  const phases = PHASES[job.type];

  job.progress = PROGRESS_CHECKPOINTS[0];
  job.phase = phases[0];

  job.tickIntervalId = setInterval(() => {
    const current = jobMap.get(job.id);
    if (!current || current.status !== "running") {
      clearInterval(job.tickIntervalId);
      return;
    }
    phaseIdx = Math.min(phaseIdx + 1, phases.length - 1);
    current.progress = PROGRESS_CHECKPOINTS[phaseIdx];
    current.phase = phases[phaseIdx];
  }, 6_000); // avança fase a cada 6 s (30 s total antes de travar em 85 %)
}

function stopProgressTick(job: AiJob): void {
  if (job.tickIntervalId) {
    clearInterval(job.tickIntervalId);
    job.tickIntervalId = undefined;
  }
}

function scheduleCleanup(job: AiJob): void {
  job.cleanupTimeoutId = setTimeout(() => {
    jobMap.delete(job.id);
  }, JOB_TTL_MS);
}

// ─── Execução do job ─────────────────────────────────────────────────────────

async function runJob(job: AiJob, payload: any): Promise<void> {
  try {
    let result: any;

    switch (job.type) {
      case "campaign_initial":
        result = await generateInitialMessage({
          companyId: payload.companyId,
          objective: payload.objective,
        });
        break;

      case "campaign_variations":
        result = await generateVariations({
          companyId: payload.companyId,
          originalMessage: payload.originalMessage,
          objective: payload.objective,
        });
        break;

      case "agent_summary":
      case "general_summary":
        result = await AgentSummaryGeminiService({
          companyId: payload.companyId,
          agentId: payload.agentId,
          dateStart: payload.dateStart,
          dateEnd: payload.dateEnd,
          maxMessages: payload.maxMessages ?? 200,
        });
        break;

      case "improve_message":
        result = await improveMessage({
          ticketId: payload.ticketId,
          companyId: payload.companyId,
          draftText: payload.draftText,
        });
        break;

      case "analyze_chat":
        result = await analyzeChatContext({
          ticketId: payload.ticketId,
          companyId: payload.companyId,
          question: payload.question,
          suggestResponse: payload.suggestResponse,
        });
        break;

      case "dashboard_command":
        result = await DashboardCommandService({
          companyId: payload.companyId,
          userId: payload.userId,
          command: payload.command,
        });
        break;

      default:
        throw new Error(`Tipo de job desconhecido: ${(job as any).type}`);
    }

    stopProgressTick(job);
    job.status = "done";
    job.progress = 100;
    job.phase = "Concluído!";
    job.result = result;
  } catch (err: any) {
    stopProgressTick(job);
    job.status = "error";
    job.progress = 100;
    job.phase = "Erro";
    job.error = err?.message ?? "Erro desconhecido no processamento de IA";
    logger.error(`[AiJobQueue] Job ${job.id} (${job.type}) falhou: ${job.error}`);
  } finally {
    scheduleCleanup(job);
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Cria e inicia um job em segundo plano. Devolve o jobId imediatamente.
 */
export const createJob = (type: AiJobType, payload: any): string => {
  const id = uuidv4();
  const job: AiJob = {
    id,
    type,
    status: "running",
    progress: 5,
    phase: PHASES[type][0],
    result: null,
    error: null,
    createdAt: Date.now(),
  };

  jobMap.set(id, job);
  startProgressTick(job);

  // Fire-and-forget — não bloqueia o controller
  runJob(job, payload).catch((err) => {
    logger.error(`[AiJobQueue] Erro inesperado em runJob: ${err?.message}`);
  });

  return id;
};

/**
 * Lê o estado actual do job. Devolve `null` se não existir (já expirado ou inválido).
 */
export const getJob = (
  id: string
): Pick<AiJob, "id" | "status" | "progress" | "phase" | "result" | "error"> | null => {
  const job = jobMap.get(id);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    result: job.result,
    error: job.error,
  };
};
