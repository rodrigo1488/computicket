import axios from "axios";
import { logger } from "../utils/logger";

export type FlowTicketPayload = {
  engine_ticket_id: number;
  engine_contact_id?: number | null;
  contact_number?: string | null;
  contact_name?: string | null;
  engine_user_id?: number | null;
  title?: string;
  description?: string;
  solicitante?: string;
  service_id?: number | null;
  assigned_to_id?: number | null;
  client_query?: string | null;
  external_client_id?: number | null;
  external_client_name?: string | null;
};

export type FlowTicketResult = {
  ok: boolean;
  ticket_id?: number;
  error?: string;
  already_linked?: boolean;
};

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

export type FlowIdentifyPayload = {
  engine_contact_id?: number | null;
  contact_number?: string | null;
  cnpj?: string | null;
};

export type FlowIdentifyResult = {
  linked: boolean;
  already_linked?: boolean;
  external_client_id?: number;
  external_client_name?: string;
  cnpj?: string;
  error?: string;
};

export async function identifyComputicketClientFromFlow(
  payload: FlowIdentifyPayload
): Promise<FlowIdentifyResult> {
  const { base, token } = computicketApiConfig();
  if (!token) {
    logger.warn("identifyComputicketClientFromFlow: token interno ausente");
    return { linked: false, error: "Token interno do Computicket não configurado." };
  }

  try {
    const res = await axios.post(
      `${base}/tickets/api/from-flow/identify-client`,
      payload,
      {
        headers: { "X-Internal-Token": token },
        timeout: 20000,
        validateStatus: () => true
      }
    );
    const data = res.data || {};
    if (res.status >= 200 && res.status < 300) {
      return {
        linked: !!data.linked,
        already_linked: !!data.already_linked,
        external_client_id: data.external_client_id
          ? Number(data.external_client_id)
          : undefined,
        external_client_name: data.external_client_name || "",
        cnpj: data.cnpj || payload.cnpj || undefined
      };
    }
    return {
      linked: false,
      error: String(data.error || data.message || `Erro ${res.status}`)
    };
  } catch (error: any) {
    logger.warn({
      msg: "identifyComputicketClientFromFlow: falha de rede",
      error: error?.message || error
    });
    return { linked: false, error: error?.message || "Falha ao identificar o cliente." };
  }
}

export async function createComputicketTicketFromFlow(
  payload: FlowTicketPayload
): Promise<FlowTicketResult> {
  const { base, token } = computicketApiConfig();
  if (!token) {
    logger.warn("createComputicketTicketFromFlow: token interno ausente");
    return { ok: false, error: "Token interno do Computicket não configurado." };
  }

  try {
    const res = await axios.post(`${base}/tickets/api/from-flow`, payload, {
      headers: { "X-Internal-Token": token },
      timeout: 20000,
      validateStatus: () => true
    });
    const data = res.data || {};
    if (res.status >= 200 && res.status < 300 && (data.ticket_id || data.id)) {
      return {
        ok: true,
        ticket_id: Number(data.ticket_id || data.id),
        already_linked: !!data.already_linked
      };
    }
    return {
      ok: false,
      error: String(data.error || data.message || `Erro ${res.status}`)
    };
  } catch (error: any) {
    logger.warn({
      msg: "createComputicketTicketFromFlow: falha de rede",
      error: error?.message || error
    });
    return { ok: false, error: error?.message || "Falha ao abrir o chamado." };
  }
}
