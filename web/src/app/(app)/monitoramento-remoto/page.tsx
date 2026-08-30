"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Download, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { PageTitle } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { ViewAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import {
  DEFAULT_REMOTE_THRESHOLDS,
  formatMetric,
  formatDate,
  mergeAgent,
  metricValue,
  reconcileAgentPage,
  remoteSocketOrigin,
  statusLabel,
  type RemoteAgent,
  type RemoteLiveEvent,
  type RemoteThresholds,
} from "@/lib/remote-monitor";

type Client = { id: number; name: string };
type CreateResult = { agent: RemoteAgent; activation_code: string };

const PREVIEW_COUNT = 3;
const PAGE_SIZE = 10;

const statusOptions = [
  { value: "", label: "Todos os status" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "pending", label: "Pendente" },
  { value: "revoked", label: "Revogado" },
];

type ClientGroup = {
  key: string;
  clientId: number;
  clientName: string;
  agents: RemoteAgent[];
};

export default function RemoteMonitoringPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  /** Quantos agentes visíveis por cliente (inicia em PREVIEW_COUNT). */
  const [shownByGroup, setShownByGroup] = useState<Record<string, number>>({});

  const agents = useQuery({
    queryKey: ["remote-agents", q, status],
    queryFn: async () => {
      const incoming = await flask.get<PageRes<RemoteAgent>>(
        `/api/remote-monitor/agents?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=1&per_page=200`,
      );
      return reconcileAgentPage(
        qc.getQueryData<PageRes<RemoteAgent>>(["remote-agents", q, status]),
        incoming,
      );
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    const socket = io(`${remoteSocketOrigin}/remote-monitor-view`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    const update = (payload: RemoteAgent | RemoteLiveEvent) => {
      qc.setQueriesData<PageRes<RemoteAgent>>({ queryKey: ["remote-agents"] }, (current) => {
        if (!current) return current;
        return { ...current, items: current.items.map((agent) => mergeAgent(agent, payload) || agent) };
      });
    };
    socket.on("telemetry_update", update);
    socket.on("live_telemetry", update);
    return () => {
      socket.close();
    };
  }, [qc]);

  const groups = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const agent of agents.data?.items || []) {
      const key = `${agent.external_client_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.agents.push(agent);
      } else {
        map.set(key, {
          key,
          clientId: agent.external_client_id,
          clientName: agent.external_client_name || "Cliente sem nome",
          agents: [agent],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
  }, [agents.data?.items]);

  const remove = useMutation({
    mutationFn: (agentId: number) => flask.post(`/api/remote-monitor/agents/${agentId}/delete`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-agents"] });
      qc.invalidateQueries({ queryKey: ["remote-monitor-stats"] });
    },
  });

  const shownCount = (key: string) => shownByGroup[key] ?? PREVIEW_COUNT;

  const showMore = (key: string, total: number) => {
    setShownByGroup((prev) => {
      const current = prev[key] ?? PREVIEW_COUNT;
      return { ...prev, [key]: Math.min(total, current + PAGE_SIZE) };
    });
  };

  const collapseGroup = (key: string) => {
    setShownByGroup((prev) => ({ ...prev, [key]: PREVIEW_COUNT }));
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Monitoramento remoto</PageTitle>
          <p className="text-sm text-muted">Saúde, inventário e atualizações dos computadores gerenciados</p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            Novo agente
          </button>
        ) : null}
      </div>

      {agents.error ? <p className="mb-4 text-sm text-open">{(agents.error as Error).message}</p> : null}
      {remove.error ? <p className="mb-4 text-sm text-open">{(remove.error as Error).message}</p> : null}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por agente, cliente ou dispositivo…"
          className="h-10 min-w-[220px] flex-1 rounded-lg border border-[#e5e7eb] bg-white px-3 text-sm text-ink"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-lg border border-[#e5e7eb] bg-white px-3 text-sm text-ink"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {agents.isLoading ? <p className="text-sm text-muted">Carregando agentes…</p> : null}

      {!agents.isLoading && !groups.length ? (
        <p className="rounded-2xl border border-dashed border-[#e5e7eb] px-5 py-10 text-center text-sm text-muted">
          Nenhum agente encontrado
        </p>
      ) : null}

      <div className="space-y-4">
        {groups.map((group) => {
          const total = group.agents.length;
          const limit = Math.min(shownCount(group.key), total);
          const visible = group.agents.slice(0, limit);
          const remaining = total - limit;
          const onlineCount = group.agents.filter((a) => statusLabel(a) === "Online").length;
          const canExpand = remaining > 0;
          const canCollapse = limit > PREVIEW_COUNT;

          return (
            <section key={group.key} className="overflow-hidden rounded-2xl border border-[#eee] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0f0f0] px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-navy">{group.clientName}</h2>
                  <p className="mt-0.5 text-sm text-muted">
                    {total} {total === 1 ? "agente" : "agentes"}
                    {onlineCount ? ` · ${onlineCount} online` : ""}
                    {total > PREVIEW_COUNT ? ` · exibindo ${limit}` : ""}
                  </p>
                </div>
              </div>

              <ul className="divide-y divide-[#f3f4f6]">
                {visible.map((agent) => {
                  const metrics = agent.snapshot?.metrics;
                  const alerts = agent.open_alerts?.length ?? 0;
                  return (
                    <li
                      key={agent.id}
                      className={cn(
                        "flex flex-wrap items-center gap-4 px-5 py-4",
                        alerts > 0 ? "bg-open-bg/60" : statusLabel(agent) === "Online" ? "bg-done-bg/25" : undefined,
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/monitoramento-remoto/${agent.id}`}
                          className="font-medium text-navy hover:text-brand"
                        >
                          {agent.name}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {agent.device_id || "Aguardando ativação"}
                        </p>
                      </div>
                      <StatusBadge agent={agent} />
                      <div className="min-w-[160px] text-xs text-muted">
                        <p>
                          CPU {formatMetric(metricValue(metrics, "cpu"), "%", 0)} · RAM{" "}
                          {formatMetric(metricValue(metrics, "ram"), "%", 0)}
                        </p>
                        <p>
                          Disco {formatMetric(metricValue(metrics, "disk"), "%", 0)} · Temp.{" "}
                          {formatMetric(metricValue(metrics, "temperature"), "°C", 0)}
                        </p>
                      </div>
                      <div className="min-w-[120px] text-xs text-muted">
                        <p className="uppercase tracking-wide">Último contato</p>
                        <p className="mt-0.5 text-ink">{formatDate(agent.last_seen)}</p>
                      </div>
                      {alerts > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-open">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {alerts}
                        </span>
                      ) : null}
                      <div className="flex items-center gap-1">
                        <ViewAction href={`/monitoramento-remoto/${agent.id}`} />
                        {isAdmin ? (
                          <button
                            type="button"
                            title="Apagar agente"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Apagar o agente "${agent.name}"? Esta ação remove o cadastro e os dados associados.`,
                                )
                              ) {
                                remove.mutate(agent.id);
                              }
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-open hover:bg-open-bg disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {canExpand || canCollapse ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#f0f0f0] px-5 py-3">
                  {canCollapse ? (
                    <button
                      type="button"
                      onClick={() => collapseGroup(group.key)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
                    >
                      <ChevronDown className="h-4 w-4 rotate-180" /> Ver menos
                    </button>
                  ) : (
                    <span />
                  )}
                  {canExpand ? (
                    <button
                      type="button"
                      onClick={() => showMore(group.key, total)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand hover:bg-progress-bg"
                    >
                      <ChevronRight className="h-4 w-4" />
                      Ver mais ({Math.min(PAGE_SIZE, remaining)} de {remaining})
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <CreateAgentModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function StatusBadge({ agent }: { agent: RemoteAgent }) {
  const label = statusLabel(agent);
  const tone =
    label === "Online"
      ? "bg-done-bg text-done"
      : label === "Pendente"
        ? "bg-progress-bg text-progress"
        : label === "Revogado"
          ? "bg-open-bg text-open"
          : "bg-[#f3f4f6] text-muted";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tone)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [clientQuery, setClientQuery] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [name, setName] = useState("");
  const [thresholds, setThresholds] = useState<RemoteThresholds>({ ...DEFAULT_REMOTE_THRESHOLDS });
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const clients = useQuery({
    queryKey: ["remote-agent-clients", clientQuery],
    queryFn: () =>
      flask.get<PageRes<Client>>(`/api/web/clients?q=${encodeURIComponent(clientQuery)}&page=1&per_page=8`),
    enabled: open && !result,
  });
  const create = useMutation({
    mutationFn: () => {
      if (!client) throw new Error("Selecione um cliente Unico.");
      if (!name.trim()) throw new Error("Informe o nome do agente.");
      return flask.post<CreateResult>("/api/remote-monitor/agents", {
        external_client_id: client.id,
        external_client_name: client.name,
        name: name.trim(),
        thresholds,
      });
    },
    onSuccess: (value) => {
      setResult(value);
      qc.invalidateQueries({ queryKey: ["remote-agents"] });
      qc.invalidateQueries({ queryKey: ["remote-monitor-stats"] });
    },
  });

  const close = () => {
    setClientQuery("");
    setClient(null);
    setName("");
    setThresholds({ ...DEFAULT_REMOTE_THRESHOLDS });
    setResult(null);
    setCopied(false);
    setCopyError("");
    setDownloadError("");
    create.reset();
    onClose();
  };
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

  return (
    <Modal open={open} onClose={close} title={result ? "Agente criado" : "Novo agente"} wide>
      {result ? (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Use o código abaixo no computador de{" "}
            <strong className="text-ink">{result.agent.external_client_name}</strong>. Ele expira em 30 minutos e só
            pode ser usado uma vez.
          </p>
          <div className="rounded-2xl border border-brand/20 bg-progress-bg p-5 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">Código de ativação</p>
            <code className="mt-2 block text-2xl font-semibold tracking-[0.12em] text-brand">
              {result.activation_code}
            </code>
            <button
              type="button"
              onClick={async () => {
                setCopyError("");
                try {
                  await copyText(result.activation_code);
                  setCopied(true);
                } catch (error) {
                  setCopied(false);
                  setCopyError(error instanceof Error ? error.message : "Não foi possível copiar o código.");
                }
              }}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand"
            >
              <Copy className="h-4 w-4" /> {copied ? "Código copiado" : "Copiar código"}
            </button>
            {copyError ? <p role="alert" className="mt-2 text-sm text-open">{copyError}</p> : null}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Baixe e execute o agente no computador que será monitorado.</li>
            <li>Informe o endereço do servidor, se solicitado.</li>
            <li>Cole o código de ativação e conclua a configuração.</li>
          </ol>
          <button
            type="button"
            onClick={download}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink text-sm font-medium text-white"
          >
            <Download className="h-4 w-4" /> Baixar executável
          </button>
          {downloadError ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-open-bg p-3 text-sm text-open">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {downloadError}
            </p>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div>
            <label
              className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
              htmlFor="remote-client-search"
            >
              Cliente Unico
            </label>
            <input
              id="remote-client-search"
              value={clientQuery}
              onChange={(event) => {
                setClientQuery(event.target.value);
                setClient(null);
              }}
              placeholder="Buscar cliente…"
              className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink"
              autoComplete="off"
            />
            {client ? (
              <p className="mt-2 text-sm font-medium text-done">Selecionado: {client.name}</p>
            ) : (
              <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-line">
                {(clients.data?.items || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setClient(item);
                      setClientQuery(item.name);
                    }}
                    className="block w-full border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-[#f7f7f8]"
                  >
                    {item.name}
                  </button>
                ))}
                {!clients.isLoading && !(clients.data?.items || []).length ? (
                  <p className="p-3 text-sm text-muted">Nenhum cliente encontrado.</p>
                ) : null}
              </div>
            )}
          </div>
          <UnderlineField label="Nome do agente" value={name} onChange={setName} placeholder="Ex.: Recepção - PC 01" />
          <fieldset>
            <legend className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Limites para alertas
            </legend>
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  ["cpu", "CPU (%)"],
                  ["ram", "RAM (%)"],
                  ["disk", "Disco (%)"],
                  ["temperature", "Temperatura (°C)"],
                ] as const
              ).map(([key, label]) => (
                <UnderlineField
                  key={key}
                  label={label}
                  type="number"
                  value={String(thresholds[key])}
                  onChange={(value) => setThresholds((current) => ({ ...current, [key]: Number(value) }))}
                />
              ))}
            </div>
          </fieldset>
          {create.error ? <p role="alert" className="text-sm text-open">{(create.error as Error).message}</p> : null}
          <PrimaryButton type="submit" disabled={create.isPending}>
            {create.isPending ? "Criando…" : "Criar agente"}
          </PrimaryButton>
        </form>
      )}
    </Modal>
  );
}
