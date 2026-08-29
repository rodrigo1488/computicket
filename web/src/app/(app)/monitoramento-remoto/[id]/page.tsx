"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Copy,
  Cpu,
  Download,
  HardDrive,
  MemoryStick,
  Network,
  RotateCw,
  Thermometer,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { PageTitle } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  formatDate,
  formatMetric,
  formatUptime,
  mergeAgent,
  metricValue,
  remoteSocketOrigin,
  statusLabel,
  type RemoteAgent,
  type RemoteAlert,
  type RemoteHistoryItem,
  type RemoteLiveEvent,
  type RemoteMetrics,
} from "@/lib/remote-monitor";

export default function RemoteAgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const id = Number(params.id);
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const [downloadError, setDownloadError] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [copied, setCopied] = useState(false);

  const detail = useQuery({
    queryKey: ["remote-agent", id],
    queryFn: () => flask.get<RemoteAgent>(`/api/remote-monitor/agents/${id}`),
    enabled: Number.isFinite(id),
    refetchInterval: 15000,
  });
  const history = useQuery({
    queryKey: ["remote-agent-history", id],
    queryFn: () => flask.get<{ items: RemoteHistoryItem[] }>(`/api/remote-monitor/agents/${id}/history?limit=1440`),
    enabled: Number.isFinite(id),
    refetchInterval: 15000,
  });
  const alerts = useQuery({
    queryKey: ["remote-agent-alerts", id],
    queryFn: () => flask.get<{ items: RemoteAlert[] }>(`/api/remote-monitor/alerts?agent_id=${id}&open=true`),
    enabled: Number.isFinite(id),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const socket = io(`${remoteSocketOrigin}/remote-monitor-view`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    socket.on("connect", () => socket.emit("join_agent", { agent_id: id }));
    const update = (payload: RemoteAgent | RemoteLiveEvent) => {
      if (Number(payload.id) !== id) return;
      qc.setQueryData<RemoteAgent>(["remote-agent", id], (current) => mergeAgent(current, payload));
      if ("status" in payload) {
        qc.invalidateQueries({ queryKey: ["remote-agent-alerts", id] });
        qc.invalidateQueries({ queryKey: ["remote-agent-history", id] });
      }
    };
    socket.on("telemetry_update", update);
    socket.on("live_telemetry", update);
    return () => {
      socket.close();
    };
  }, [id, qc]);

  const enrollment = useMutation({
    mutationFn: () =>
      flask.post<{ activation_code: string }>(`/api/remote-monitor/agents/${id}/enrollment`, {}),
    onSuccess: (data) => {
      setActivationCode(data.activation_code);
      setCopied(false);
    },
  });
  const revoke = useMutation({
    mutationFn: () => flask.post<RemoteAgent>(`/api/remote-monitor/agents/${id}/revoke`, {}),
    onSuccess: (agent) => {
      qc.setQueryData(["remote-agent", id], agent);
      qc.invalidateQueries({ queryKey: ["remote-agents"] });
      qc.invalidateQueries({ queryKey: ["remote-monitor-stats"] });
    },
  });
  const download = async () => {
    setDownloadError("");
    try {
      await flask.download("/api/remote-monitor/download");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível baixar o agente.";
      setDownloadError(
        message.includes("não está disponível")
          ? "O executável ainda não está disponível no servidor. Solicite a geração do instalador ao administrador."
          : message,
      );
    }
  };

  if (!Number.isFinite(id)) return <p className="text-open">Identificador de agente inválido.</p>;
  if (detail.isLoading) return <p className="text-muted">Carregando agente…</p>;
  if (detail.error || !detail.data) {
    return <p className="text-open">{detail.error instanceof Error ? detail.error.message : "Agente não encontrado."}</p>;
  }

  const agent = detail.data;
  const metrics = agent.snapshot?.metrics;
  const network = metrics?.network && typeof metrics.network === "object" ? metrics.network : {};
  const connected = typeof network.connected === "boolean" ? network.connected : null;
  const openAlerts = alerts.data?.items || agent.open_alerts || [];

  return (
    <div>
      <Link href="/monitoramento-remoto" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Voltar aos agentes
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <PageTitle className="mb-0">{agent.name}</PageTitle>
            <StatusBadge agent={agent} />
          </div>
          <p className="mt-1 text-sm text-muted">{agent.external_client_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={<Download className="h-4 w-4" />} onClick={download}>Baixar agente</ActionButton>
          {isAdmin && !agent.revoked ? (
            <>
              <ActionButton icon={<RotateCw className="h-4 w-4" />} onClick={() => enrollment.mutate()} disabled={enrollment.isPending}>
                Reemitir código
              </ActionButton>
              <ActionButton
                danger
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => {
                  if (window.confirm(`Revogar o agente "${agent.name}"? Ele perderá o acesso imediatamente.`)) revoke.mutate();
                }}
                disabled={revoke.isPending}
              >
                Revogar
              </ActionButton>
            </>
          ) : null}
        </div>
      </div>
      {downloadError ? (
        <p role="alert" className="mb-5 flex items-start gap-2 rounded-xl bg-open-bg p-3 text-sm text-open">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {downloadError}
        </p>
      ) : null}
      {enrollment.error || revoke.error ? (
        <p role="alert" className="mb-5 text-sm text-open">{((enrollment.error || revoke.error) as Error).message}</p>
      ) : null}

      <section aria-labelledby="live-title">
        <h2 id="live-title" className="mb-3 text-lg font-semibold text-navy">Estado ao vivo</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <MetricCard icon={<Cpu />} label="CPU" value={formatMetric(metricValue(metrics, "cpu"))} />
          <MetricCard icon={<MemoryStick />} label="RAM" value={formatMetric(metricValue(metrics, "ram"))} />
          <MetricCard icon={<HardDrive />} label="Disco" value={formatMetric(metricValue(metrics, "disk"))} />
          <MetricCard icon={<Thermometer />} label="Temperatura" value={formatMetric(metricValue(metrics, "temperature"), "°C")} />
          <MetricCard icon={<Network />} label="Conexão" value={connected == null ? "—" : connected ? "Conectada" : "Sem rede"} />
          <MetricCard icon={<Clock3 />} label="Uptime" value={formatUptime(metrics?.uptime_seconds)} />
        </div>
        <p className="mt-2 text-right text-xs text-muted">Última amostra persistida: {formatDate(agent.snapshot?.updated_at)}</p>
      </section>

      <section className="mt-8" aria-labelledby="history-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="history-title" className="text-lg font-semibold text-navy">Histórico das últimas 24 horas</h2>
          <div className="flex flex-wrap gap-3 text-xs">
            <Legend color="#7c3aed" label="CPU" />
            <Legend color="#2563eb" label="RAM" />
            <Legend color="#f59e0b" label="Disco" />
            <Legend color="#dc2626" label="Temperatura" />
          </div>
        </div>
        <HistoryChart items={history.data?.items || []} />
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <InventoryPanel inventory={agent.snapshot?.inventory} metrics={metrics} />
        <UpdatesPanel updates={agent.snapshot?.updates} />
        <AlertsPanel alerts={openAlerts} />
        <MetadataPanel agent={agent} />
      </div>

      <Modal open={!!activationCode} onClose={() => setActivationCode("")} title="Novo código de ativação">
        <p className="mb-4 text-sm text-muted">O código expira em 30 minutos e invalida códigos anteriores ainda não utilizados.</p>
        <div className="rounded-2xl border border-brand/20 bg-progress-bg p-5 text-center">
          <code className="block text-2xl font-semibold tracking-[0.12em] text-brand">{activationCode}</code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(activationCode);
              setCopied(true);
            }}
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand"
          >
            <Copy className="h-4 w-4" /> {copied ? "Código copiado" : "Copiar código"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function StatusBadge({ agent }: { agent: RemoteAgent }) {
  const label = statusLabel(agent);
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
      label === "Online" ? "bg-done-bg text-done" :
      label === "Pendente" ? "bg-progress-bg text-progress" :
      label === "Revogado" ? "bg-open-bg text-open" : "bg-[#f3f4f6] text-muted",
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
    </span>
  );
}

function ActionButton({ children, icon, onClick, danger, disabled }: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(
      "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium disabled:opacity-50",
      danger ? "border-open/20 text-open hover:bg-open-bg" : "border-line text-ink hover:bg-[#f7f7f8]",
    )}>
      {icon}{children}
    </button>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <span className="mb-3 block h-5 w-5 text-brand [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-navy">{value}</p>
    </div>
  );
}

const chartSeries = [
  { key: "cpu_percent", color: "#7c3aed" },
  { key: "ram_percent", color: "#2563eb" },
  { key: "disk_percent", color: "#f59e0b" },
  { key: "temperature_c", color: "#dc2626" },
] as const;

function HistoryChart({ items }: { items: RemoteHistoryItem[] }) {
  if (!items.length) {
    return <div className="flex h-56 items-center justify-center rounded-2xl border border-line text-sm text-muted">Ainda não há histórico para este agente.</div>;
  }
  const x = (index: number) => 42 + (index / Math.max(1, items.length - 1)) * 650;
  const y = (value: number) => 210 - (Math.min(100, Math.max(0, value)) / 100) * 180;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white p-3">
      <svg viewBox="0 0 720 240" role="img" aria-label="Gráfico de histórico de CPU, RAM, disco e temperatura" className="h-auto min-w-[620px] w-full">
        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line x1="42" x2="692" y1={y(value)} y2={y(value)} stroke="#e5e7eb" strokeWidth="1" />
            <text x="34" y={y(value) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{value}</text>
          </g>
        ))}
        {chartSeries.map((series) => {
          const points = items
            .map((item, index) => {
              const value = item[series.key];
              return typeof value === "number" && Number.isFinite(value) ? `${x(index)},${y(value)}` : null;
            })
            .filter(Boolean)
            .join(" ");
          return points ? <polyline key={series.key} points={points} fill="none" stroke={series.color} strokeWidth="2" strokeLinejoin="round" /> : null;
        })}
        <text x="42" y="232" fontSize="10" fill="#6b7280">{formatChartTime(items[0]?.timestamp)}</text>
        <text x="692" y="232" textAnchor="end" fontSize="10" fill="#6b7280">{formatChartTime(items.at(-1)?.timestamp)}</text>
      </svg>
    </div>
  );
}

function formatChartTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1 text-muted"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line p-5">
      <h2 className="mb-4 text-lg font-semibold text-navy">{title}</h2>
      {children}
    </section>
  );
}

function InventoryPanel({ inventory, metrics }: { inventory?: Record<string, unknown> | null; metrics?: RemoteMetrics | null }) {
  const status = textValue(inventory?.status);
  const data = objectValue(inventory?.data);
  const basic = objectValue(inventory?.basic);
  const source = Object.keys(data).length ? data : basic;
  const memory = objectValue(metrics?.memory);
  const volumes = Array.isArray(metrics?.volumes) ? metrics.volumes : [];
  return (
    <Panel title="Inventário">
      {status && status !== "available" ? <p className="mb-3 rounded-lg bg-progress-bg p-3 text-sm text-progress">Inventário: {status}{inventory?.reason ? ` — ${textValue(inventory.reason)}` : ""}</p> : null}
      {Object.keys(source).length ? (
        <div className="space-y-3 text-sm">
          {Object.entries(source).map(([key, value]) => <InfoRow key={key} label={humanize(key)} value={displayValue(value)} />)}
        </div>
      ) : <p className="text-sm text-muted">Inventário ainda não coletado.</p>}
      {(Object.keys(memory).length || volumes.length) ? (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Armazenamento e memória</h3>
          {memory.total_bytes != null ? <InfoRow label="Memória total" value={formatBytes(memory.total_bytes)} /> : null}
          {volumes.map((volume, index) => {
            const item = objectValue(volume);
            return <InfoRow key={index} label={textValue(item.mountpoint || item.device) || `Volume ${index + 1}`} value={`${formatBytes(item.used_bytes)} usados de ${formatBytes(item.total_bytes)}`} />;
          })}
        </div>
      ) : null}
    </Panel>
  );
}

function UpdatesPanel({ updates }: { updates?: Record<string, unknown> | null }) {
  const status = textValue(updates?.status);
  const data = objectValue(updates?.data);
  const items = Array.isArray(data.updates) ? data.updates : [];
  return (
    <Panel title="Atualizações pendentes">
      {status && status !== "available" ? <p className="mb-3 rounded-lg bg-progress-bg p-3 text-sm text-progress">Consulta: {status}{updates?.error ? ` — ${textValue(updates.error)}` : ""}</p> : null}
      <p className="mb-3 text-2xl font-semibold text-navy">{typeof data.count === "number" ? data.count : items.length}</p>
      {items.length ? (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {items.map((update, index) => {
            const item = objectValue(update);
            return (
              <li key={index} className="rounded-xl bg-[#f7f7f8] p-3 text-sm">
                <p className="font-medium text-ink">{textValue(item.title) || `Atualização ${index + 1}`}</p>
                <p className="mt-1 text-xs text-muted">{[displayValue(item.kb), textValue(item.severity)].filter(Boolean).join(" · ") || "Sem detalhes adicionais"}</p>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted">Nenhuma atualização pendente informada.</p>}
    </Panel>
  );
}

function AlertsPanel({ alerts }: { alerts: RemoteAlert[] }) {
  return (
    <Panel title={`Alertas abertos (${alerts.length})`}>
      {alerts.length ? (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <li key={alert.id} className={cn("rounded-xl border-l-4 p-3 text-sm", alert.severity === "critical" ? "border-open bg-open-bg" : "border-progress bg-progress-bg")}>
              <p className="font-medium text-ink">{alert.message}</p>
              <p className="mt-1 text-xs text-muted">{formatDate(alert.opened_at, "Data não informada")}</p>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nenhum alerta aberto.</p>}
    </Panel>
  );
}

function MetadataPanel({ agent }: { agent: RemoteAgent }) {
  const thresholds = agent.thresholds || {};
  return (
    <Panel title="Metadados">
      <div className="space-y-3 text-sm">
        <InfoRow label="Cliente" value={`${agent.external_client_name} (#${agent.external_client_id})`} />
        <InfoRow label="Dispositivo" value={agent.device_id || "Aguardando ativação"} mono />
        <InfoRow label="Versão" value={agent.version || "—"} />
        <InfoRow label="Último contato" value={formatDate(agent.last_seen)} />
        <InfoRow label="Criado em" value={formatDate(agent.created_at, "—")} />
        <InfoRow label="Limites" value={`CPU ${thresholds.cpu ?? "—"}% · RAM ${thresholds.ram ?? "—"}% · Disco ${thresholds.disk ?? "—"}% · Temp. ${thresholds.temperature ?? "—"}°C`} />
      </div>
    </Panel>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line pb-2 last:border-0">
      <span className="text-muted">{label}</span>
      <span className={cn("max-w-full text-right text-ink", mono && "break-all font-mono text-xs")}>{value}</span>
    </div>
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function displayValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${humanize(key)}: ${displayValue(item)}`)
      .join(" · ");
  }
  return "—";
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
