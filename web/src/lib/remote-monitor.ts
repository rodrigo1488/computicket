import type { PageRes } from "@/lib/api";

export type RemoteThresholds = {
  cpu: number;
  ram: number;
  disk: number;
  temperature: number;
};

export type RemoteMetrics = {
  cpu_percent?: number | null;
  ram_percent?: number | null;
  disk_percent?: number | null;
  temperature_c?: number | null;
  uptime_seconds?: number | null;
  memory?: Record<string, unknown> | null;
  volumes?: unknown[] | null;
  network?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type RemoteSnapshot = {
  metrics?: RemoteMetrics | null;
  inventory?: Record<string, unknown> | null;
  updates?: Record<string, unknown> | null;
  updated_at?: string | null;
};

export type RemoteAlert = {
  id: number;
  alert_type?: string;
  severity?: string;
  message: string;
  opened_at?: string | null;
  updated_at?: string | null;
  resolved_at?: string | null;
};

export type RemoteAgent = {
  id: number;
  external_client_id: number;
  external_client_name: string;
  name: string;
  device_id?: string | null;
  status: string;
  revoked?: boolean;
  version?: string | null;
  last_seen?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  thresholds?: Partial<RemoteThresholds> | null;
  snapshot?: RemoteSnapshot | null;
  open_alerts?: RemoteAlert[];
};

export type RemoteStats = {
  total: number;
  online: number;
  offline: number;
  pending: number;
  revoked: number;
  open_alerts: number;
};

export type RemoteHistoryItem = {
  timestamp: string;
  cpu_percent?: number | null;
  ram_percent?: number | null;
  disk_percent?: number | null;
  temperature_c?: number | null;
};

export type RemoteLiveEvent = {
  id: number;
  metrics?: RemoteMetrics;
  version?: string;
  status?: string;
  last_seen?: string | null;
};

export const DEFAULT_REMOTE_THRESHOLDS: RemoteThresholds = {
  cpu: 90,
  ram: 90,
  disk: 90,
  temperature: 85,
};
export const REMOTE_OFFLINE_AFTER_MS = 90_000;

export const remoteSocketOrigin =
  typeof window === "undefined"
    ? "http://127.0.0.1:5000"
    : process.env.NEXT_PUBLIC_FLASK_URL ||
      `${window.location.protocol}//${window.location.hostname}:5000`;

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function metricValue(metrics: RemoteMetrics | null | undefined, key: keyof RemoteThresholds) {
  if (!metrics) return null;
  if (key === "temperature") return finiteNumber(metrics.temperature_c ?? metrics.temperature);
  if (key === "cpu") return finiteNumber(metrics.cpu_percent ?? metrics.cpu);
  if (key === "ram") {
    const memory = metrics.memory && typeof metrics.memory === "object" ? metrics.memory : {};
    return finiteNumber(metrics.ram_percent ?? metrics.ram ?? memory.percent);
  }
  const direct = finiteNumber(metrics.disk_percent);
  if (direct != null) return direct;
  const volumes = Array.isArray(metrics.volumes) ? metrics.volumes : [];
  const values = volumes
    .map((volume) =>
      volume && typeof volume === "object"
        ? finiteNumber((volume as Record<string, unknown>).percent ?? (volume as Record<string, unknown>).usage_percent)
        : null,
    )
    .filter((value): value is number => value != null);
  return values.length ? Math.max(...values) : null;
}

export function formatMetric(value: number | null, unit = "%", digits = 1) {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })}${unit}`;
}

export function formatDate(value?: string | null, fallback = "Nunca") {
  if (!value) return fallback;
  const date = new Date(normalizeRemoteDate(value));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function normalizeRemoteDate(value: string) {
  // Datas naive do backend são UTC; sem Z o browser as interpreta como locais.
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ? `${value}Z`
    : value;
}

function remoteTimestamp(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(normalizeRemoteDate(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatBytes(value: unknown) {
  const bytes = finiteNumber(value);
  if (bytes == null || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[index]}`;
}

export function formatUptime(value: unknown) {
  const seconds = finiteNumber(value);
  if (seconds == null || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}min`].filter(Boolean).join(" ");
}

export function statusLabel(agent: Pick<RemoteAgent, "status" | "revoked" | "last_seen">) {
  if (agent.revoked || agent.status === "revoked") return "Revogado";
  const status = agent.status?.toLowerCase();
  if (status === "pending" && !agent.last_seen) return "Pendente";
  const lastSeen = remoteTimestamp(agent.last_seen);
  if (lastSeen != null) {
    const isFresh = Date.now() - lastSeen <= REMOTE_OFFLINE_AFTER_MS;
    if (isFresh) return "Online";
    if (status === "online") return "Offline";
  }
  const labels: Record<string, string> = { online: "Online", offline: "Offline", pending: "Pendente" };
  return labels[status] || agent.status || "Desconhecido";
}

export function mergeAgent(current: RemoteAgent | undefined, update: RemoteAgent | RemoteLiveEvent) {
  if (!current || current.id !== update.id) return current;
  const currentSeen = remoteTimestamp(current.last_seen);
  const updateSeen = remoteTimestamp(update.last_seen);
  const updateIsOlder = currentSeen != null && updateSeen != null && updateSeen < currentSeen;
  if (updateIsOlder) return current;
  const isLive =
    "metrics" in update &&
    !("snapshot" in update) &&
    !("external_client_id" in update) &&
    !("name" in update);
  if (!isLive) {
    return { ...current, ...(update as RemoteAgent) };
  }
  const live = update as RemoteLiveEvent;
  return {
    ...current,
    version: live.version || current.version,
    status: live.status || current.status,
    last_seen: live.last_seen ?? current.last_seen,
    snapshot: {
      ...current.snapshot,
      metrics: { ...current.snapshot?.metrics, ...live.metrics },
    },
  };
}

export function mergeAgentPage(
  current: PageRes<RemoteAgent> | undefined,
  update: RemoteAgent | RemoteLiveEvent,
) {
  if (!current) return current;
  return { ...current, items: current.items.map((agent) => mergeAgent(agent, update) || agent) };
}

export function reconcileAgentPage(
  current: PageRes<RemoteAgent> | undefined,
  incoming: PageRes<RemoteAgent>,
) {
  if (!current) return incoming;
  const previousById = new Map(current.items.map((agent) => [agent.id, agent]));
  return {
    ...incoming,
    items: incoming.items.map((agent) => mergeAgent(previousById.get(agent.id), agent) || agent),
  };
}
