export function initials(name?: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatBRL(value?: number | null) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatHours(value?: number | null) {
  const hours = Number(value || 0);
  if (!Number.isFinite(hours) || hours <= 0) return "0min";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}min`;
  }
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (minutes === 0) return `${whole}h`;
  if (minutes === 60) return `${whole + 1}h`;
  return `${whole}h ${minutes}m`;
}

export function stripHtml(html?: string | null) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMoney(raw: string) {
  const cleaned = raw.replace(/R\$\s?/g, "").trim();
  if (!cleaned) return 0;
  if (cleaned.includes(",")) {
    return Number(cleaned.replace(/\./g, "").replace(",", ".")) || 0;
  }
  return Number(cleaned) || 0;
}

export type TicketStatus = "aberto" | "em_andamento" | "fechado" | "cancelado";

export type TicketCard = {
  id: number;
  code: string;
  title: string;
  description?: string;
  status: TicketStatus;
  category: string;
  created_at: string | null;
  updated_at?: string | null;
  base_price: number;
  client_name: string;
  solicitante?: string | null;
  assigned_to_id?: number | null;
  assigned_to_name?: string | null;
  hours?: number;
  hours_label?: string;
  time_entries_count?: number;
  hourly_rate?: number;
  value?: number;
  total_cost?: number;
  ps_printed?: boolean;
  ps_number?: string | null;
};

export type TicketAddon = {
  id: number;
  description: string;
  value: number;
};

export type TimeEntry = {
  id: number;
  user_id: number;
  user_name?: string | null;
  hours: number;
  hours_label?: string;
  comment?: string;
  start_time?: string | null;
  end_time?: string | null;
  no_charge?: boolean;
  created_at?: string | null;
};

export type TicketDetail = TicketCard & {
  solicitante?: string | null;
  external_client_id?: number | null;
  service_id?: number | null;
  addons: TicketAddon[];
  addons_total: number;
  total: number;
  technician: { id: number; name: string; email: string } | null;
  time_entries?: TimeEntry[];
  no_charge?: boolean;
  charge_reason?: string;
  should_show_costs?: boolean;
  client_phone?: string | null;
  ps_printed?: boolean;
  ps_number?: string | null;
  ps_file?: string | null;
  helpdesk_conversation?: {
    engine_ticket_id: number;
    href?: string;
    contact_name?: string | null;
    contact_number?: string | null;
    status?: string | null;
  } | null;
  in_progress_started_at?: string | null;
  created_at_input?: string | null;
};

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  team?: string | null;
  status?: string;
  avatar_url?: string | null;
  availability: string[];
};
