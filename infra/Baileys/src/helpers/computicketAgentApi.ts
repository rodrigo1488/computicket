import axios from "axios";
import { logger } from "../utils/logger";
import { looksLikeFactualQuestion } from "../services/AiServices/aiAgentActions";

export type AgentContext = {
  draft: string;
  has_evidence: boolean;
  sources: { title?: string; snippet?: string; source_type?: string }[];
  technicians: { id?: number; name?: string; engine_user_id?: number | null }[];
};

const emptyContext = (): AgentContext => ({
  draft: "",
  has_evidence: false,
  sources: [],
  technicians: []
});

function computicketApiConfig() {
  const base = (
    process.env.COMPUTICKET_API_URL ||
    process.env.BACKEND_URL_COMPUTICKET ||
    "http://api:5000"
  ).replace(/\/$/, "");
  const token = (
    process.env.COMPUTICKET_INTERNAL_TOKEN ||
    process.env.JWT_SECRET ||
    ""
  ).trim();
  return { base, token };
}

export async function fetchComputicketAgentContext(
  question: string,
  history: string,
  includeKnowledge = true
): Promise<AgentContext> {
  const { base, token } = computicketApiConfig();
  if (!token) {
    logger.warn("fetchComputicketAgentContext: token interno ausente");
    return emptyContext();
  }
  try {
    const res = await axios.post(
      `${base}/helpdesk/api/internal/agent/context`,
      { question, history, include_knowledge: includeKnowledge },
      {
        headers: { "X-Internal-Token": token },
        timeout: 20000,
        validateStatus: () => true
      }
    );
    if (res.status < 200 || res.status >= 300) {
      logger.warn(`fetchComputicketAgentContext: HTTP ${res.status}`);
      return emptyContext();
    }
    const data = res.data || {};
    return {
      draft: data.draft || "",
      has_evidence: !!data.has_evidence,
      sources: Array.isArray(data.sources) ? data.sources : [],
      technicians: Array.isArray(data.technicians) ? data.technicians : []
    };
  } catch (err: any) {
    logger.error(`fetchComputicketAgentContext: ${err.message}`);
    return emptyContext();
  }
}

export async function loadAgentContext(
  prompt: { answerFromKnowledge?: boolean; permitirCriarAgendamentos?: boolean },
  userText: string,
  history: string
): Promise<AgentContext> {
  const includeKnowledge =
    (!!prompt?.answerFromKnowledge && looksLikeFactualQuestion(userText || "")) ||
    !!prompt?.permitirCriarAgendamentos;
  return fetchComputicketAgentContext(userText || "", history || "", includeKnowledge);
}

export type AppointmentApiResult = {
  ok: boolean;
  message: string;
};

export async function createComputicketAppointment(payload: {
  engine_contact_id: number;
  contact_number?: string | null;
  title: string;
  appointment_date: string;
  tecnico?: string;
  user_id?: number;
  description?: string;
}): Promise<AppointmentApiResult> {
  const { base, token } = computicketApiConfig();
  if (!token) {
    return { ok: false, message: "A agenda está indisponível no momento." };
  }
  try {
    const res = await axios.post(`${base}/agenda/api/internal/from-whatsapp`, payload, {
      headers: { "X-Internal-Token": token },
      timeout: 20000,
      validateStatus: () => true
    });
    const data = res.data || {};
    const message =
      data.message ||
      data.error ||
      "Não foi possível criar o agendamento.";
    return { ok: res.status < 300 && data.ok !== false, message: String(message) };
  } catch (err: any) {
    logger.error(`createComputicketAppointment: ${err.message}`);
    return { ok: false, message: "Não consegui criar o agendamento agora. Pode repetir a data e o técnico?" };
  }
}
