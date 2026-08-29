"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Cpu, HardDrive, MemoryStick, Thermometer } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { io } from "socket.io-client";
import { PageTitle } from "@/components/layout/AppShell";
import { Kpi } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { flask, type PageRes } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBRL, formatHours } from "@/lib/format";
import {
  formatDate,
  formatMetric,
  mergeAgentPage,
  metricValue,
  remoteSocketOrigin,
  statusLabel,
  type RemoteAgent,
  type RemoteLiveEvent,
  type RemoteStats,
} from "@/lib/remote-monitor";

type DashTab = "tickets" | "helpdesk" | "monitoramento";

type DailyCount = { date: string; count: number };

type ComparativoDia = { date: string; conversas: number; tickets: number };

type Dash = {
  status_counts: Record<string, number>;
  technician_ranking: { name: string; tickets_count: number }[];
  hours_by_user: { name: string; hours: number }[];
  technicians_in_progress: {
    name: string;
    tickets_count: number;
    total_hours: number;
    tickets: { id: number; title: string; client_name: string; hours: number; card_color?: string }[];
  }[];
  tickets_hoje_count: number;
  faturamento_hoje: number;
  tickets_mes_count: number;
  os_mes_count: number;
  total_hours: number;
  tickets_por_dia?: DailyCount[];
};

type HdDash = {
  ok: boolean;
  error?: string | null;
  summary: {
    active: number;
    pending: number;
    closed: number;
    unread: number;
    returns: number;
    potentials: number;
    online_attendants: number;
  };
  queues: { id: number | null; name: string; color: string; active: number; pending: number; unread: number; count: number }[];
  connections: { id: number; name: string; status: string; number?: string | null }[];
  users: { id: number; name: string; online: boolean; active: number; pending: number; unread: number; count: number }[];
  tickets_mes_count?: number;
  conversas_mes_count?: number;
  comparativo_por_dia?: ComparativoDia[];
};

function StatusBar({
  aberto,
  andamento,
  fechado,
  labels,
}: {
  aberto: number;
  andamento: number;
  fechado: number;
  labels?: { aberto: string; andamento: string; fechado: string };
}) {
  const total = aberto + andamento + fechado;
  if (!total) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const L = labels || { aberto: "Abertos", andamento: "Em atendimento", fechado: "Encerrados" };
  return (
    <div className="mb-8">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[#f1f1f1]">
        <div className="bg-open" style={{ width: pct(aberto) }} />
        <div className="bg-progress" style={{ width: pct(andamento) }} />
        <div className="bg-done" style={{ width: pct(fechado) }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-open" /> {L.aberto} {aberto}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-progress" /> {L.andamento} {andamento}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-done" /> {L.fechado} {fechado}
        </span>
      </div>
    </div>
  );
}

function RankRow({
  place,
  name,
  value,
  max,
  numeric,
  barClass,
  barColor,
}: {
  place: number;
  name: string;
  value: string;
  max: number;
  barClass: string;
  numeric: number;
  barColor?: string;
}) {
  const width = max > 0 ? Math.max(6, (numeric / max) * 100) : 0;
  const medal =
    place === 1 ? "bg-brand text-white" : place === 2 ? "bg-navy text-white" : place === 3 ? "bg-open text-white" : "bg-[#f3f4f6] text-navy";
  return (
    <div className="rounded-2xl border border-[#eee] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", medal)}>
            {place}º
          </span>
          <span className="truncate font-medium text-navy">{name}</span>
        </div>
        <span className="shrink-0 text-sm font-semibold text-ink">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f1f1]">
        <div
          className={cn("h-full rounded-full", barColor ? undefined : barClass)}
          style={{ width: `${width}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

function shortDate(iso: string) {
  const raw = (iso || "").slice(0, 10);
  const [, m, d] = raw.split("-");
  if (!d || !m) return raw;
  return `${d}/${m}`;
}

function DailyAttendancesChart({ items }: { items: DailyCount[] }) {
  const values = items.map((i) => Number(i.count || 0));
  const max = Math.max(...values, 0);
  const chartH = 160;
  const labelEvery = Math.max(1, Math.ceil(items.length / 10));

  return (
    <section className="mb-8 rounded-2xl border border-[#eee] bg-white p-5">
      <h2 className="mb-1 text-lg font-semibold text-navy">Atendimentos dia a dia</h2>
      <p className="mb-4 text-sm text-muted">Tickets finalizados neste mês</p>
      {!items.length || max <= 0 ? (
        <p className="flex h-40 items-center text-sm text-muted">Sem atendimentos finalizados neste mês</p>
      ) : (
        <div className="h-52">
          <div className="flex h-44 gap-2">
            <div className="flex h-40 w-8 shrink-0 flex-col justify-between pb-px text-right text-[10px] text-muted">
              <span>{max}</span>
              <span>0</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-40 items-stretch gap-px border-b border-[#e5e5e5] sm:gap-1">
                {items.map((item) => {
                  const v = Number(item.count || 0);
                  const h = v > 0 ? Math.max(4, (v / max) * chartH) : 0;
                  return (
                    <div
                      key={item.date}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                      title={`${shortDate(item.date)}: ${v}`}
                    >
                      <div className="w-full max-w-8 rounded-t bg-brand" style={{ height: `${h}px` }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-px text-[10px] text-muted sm:gap-1">
                {items.map((item, idx) => (
                  <span key={item.date} className="min-w-0 flex-1 truncate text-center">
                    {idx % labelEvery === 0 || idx === items.length - 1 ? shortDate(item.date) : "\u00a0"}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ClosedVsTicketsChart({
  items,
  conversasMes,
  ticketsMes,
}: {
  items: ComparativoDia[];
  conversasMes: number;
  ticketsMes: number;
}) {
  const max = Math.max(...items.flatMap((i) => [Number(i.conversas || 0), Number(i.tickets || 0)]), 0);
  const labelEvery = Math.max(1, Math.ceil(items.length / 10));
  const vbW = 1000;
  const vbH = 160;
  const n = items.length;
  const xAt = (idx: number) => (n <= 1 ? vbW / 2 : (idx / (n - 1)) * vbW);
  const yAt = (value: number) => vbH - (max > 0 ? (Number(value || 0) / max) * vbH : 0);
  const xPct = (idx: number) => (n <= 1 ? 50 : (idx / (n - 1)) * 100);
  const yPct = (value: number) => (max > 0 ? 100 - (Number(value || 0) / max) * 100 : 100);
  const linePoints = (key: "conversas" | "tickets") =>
    items.map((item, idx) => `${xAt(idx)},${yAt(Number(item[key] || 0))}`).join(" ");

  return (
    <section className="mt-10 rounded-2xl border border-[#eee] bg-white p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">Conversas encerradas × tickets</h2>
          <p className="mt-1 text-sm text-muted">Comparativo dia a dia neste mês</p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-done" /> Conversas {conversasMes}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand" /> Tickets {ticketsMes}
          </span>
        </div>
      </div>
      {!items.length || max <= 0 ? (
        <p className="flex h-40 items-center text-sm text-muted">Sem encerramentos neste mês</p>
      ) : (
        <div className="h-52">
          <div className="flex h-44 gap-2">
            <div className="flex h-40 w-8 shrink-0 flex-col justify-between pb-px text-right text-[10px] text-muted">
              <span>{max}</span>
              <span>0</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="relative h-40 border-b border-[#e5e5e5]">
                <svg viewBox={`0 0 ${vbW} ${vbH}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
                  <polyline fill="none" stroke="#16a34a" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={linePoints("conversas")} vectorEffect="non-scaling-stroke" />
                  <polyline fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={linePoints("tickets")} vectorEffect="non-scaling-stroke" />
                </svg>
                {items.map((item, idx) => {
                  const conversas = Number(item.conversas || 0);
                  const tickets = Number(item.tickets || 0);
                  return (
                    <div
                      key={item.date}
                      className="absolute inset-y-0 w-4 -translate-x-1/2"
                      style={{ left: `${xPct(idx)}%` }}
                      title={`${shortDate(item.date)}: ${conversas} conversas · ${tickets} tickets`}
                    >
                      <span className="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-done" style={{ top: `${yPct(conversas)}%` }} />
                      <span className="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" style={{ top: `${yPct(tickets)}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex text-[10px] text-muted">
                {items.map((item, idx) => (
                  <span
                    key={item.date}
                    className="min-w-0 flex-1 truncate text-center"
                    style={idx === 0 ? { textAlign: "left" } : idx === items.length - 1 ? { textAlign: "right" } : undefined}
                  >
                    {idx % labelEvery === 0 || idx === items.length - 1 ? shortDate(item.date) : "\u00a0"}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TicketsDash() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => flask.get<Dash>("/api/web/dashboard"),
  });
  const sc = data?.status_counts || {};
  const aberto = sc.aberto ?? 0;
  const andamento = sc.em_andamento ?? 0;
  const fechado = sc.fechado ?? 0;
  const ranking = (data?.technician_ranking || []).slice(0, 3);
  const hours = (data?.hours_by_user || []).slice(0, 3);
  const rankMax = Math.max(...ranking.map((r) => r.tickets_count), 1);
  const hoursMax = Math.max(...hours.map((r) => r.hours), 1);
  const inProgress = data?.technicians_in_progress || [];
  const daily = data?.tickets_por_dia || [];

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Tickets do mês" value={data?.tickets_mes_count ?? "—"} hint="Finalizados no mês" tone="brand" />
        <Kpi label="Abertos" value={aberto} hint="Pendentes" tone="open" />
        <Kpi label="Em atendimento" value={andamento} hint="Em andamento agora" tone="progress" />
        <Kpi label="Encerrados" value={fechado} hint="Concluídos" tone="done" />
        <Kpi label="OS do mês" value={data?.os_mes_count ?? "—"} hint="Ordens no mês" tone="brand" />
        <Kpi label="Horas apontadas" value={formatHours(data?.total_hours)} hint="Total acumulado" />
        <Kpi label="Faturamento do dia" value={formatBRL(data?.faturamento_hoje)} hint="Tickets + OS de hoje" tone="done" />
        <Kpi label="Tickets hoje" value={data?.tickets_hoje_count ?? 0} hint="Fechados hoje" />
      </div>
      <StatusBar aberto={aberto} andamento={andamento} fechado={fechado} />

      <DailyAttendancesChart items={daily} />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy">Ranking de técnicos</h2>
          <p className="mb-4 text-sm text-muted">Tickets e OS finalizados neste mês</p>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted">Sem ranking neste mês</p>
          ) : (
            <div className="space-y-3">
              {ranking.map((r, i) => (
                <RankRow
                  key={r.name}
                  place={i + 1}
                  name={r.name}
                  value={String(r.tickets_count)}
                  max={rankMax}
                  numeric={r.tickets_count}
                  barClass="bg-brand"
                />
              ))}
            </div>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy">Horas por técnico</h2>
          <p className="mb-4 text-sm text-muted">Apontamentos acumulados</p>
          {hours.length === 0 ? (
            <p className="text-sm text-muted">Sem horas apontadas</p>
          ) : (
            <div className="space-y-3">
              {hours.map((r, i) => (
                <RankRow
                  key={r.name}
                  place={i + 1}
                  name={r.name}
                  value={formatHours(r.hours)}
                  max={hoursMax}
                  numeric={r.hours}
                  barClass="bg-progress"
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {inProgress.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-navy">Em atendimento agora</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {inProgress.map((tech) => (
              <div key={tech.name} className="rounded-2xl border border-progress/20 bg-progress-bg p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-navy">{tech.name}</p>
                    <p className="text-xs text-muted">{tech.tickets_count} em andamento</p>
                  </div>
                  <span className="text-sm font-semibold text-progress">{formatHours(tech.total_hours)}</span>
                </div>
                <ul className="mt-4 space-y-2">
                  {tech.tickets.map((t) => (
                    <li key={t.id} className="rounded-xl bg-white px-3 py-2">
                      <p className="text-sm font-medium text-ink">{t.title}</p>
                      <p className="text-xs text-muted">{t.client_name}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HelpdeskDash() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-helpdesk"],
    queryFn: () => flask.get<HdDash>("/api/web/dashboard/helpdesk"),
    retry: 1,
  });
  const [queuePage, setQueuePage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const perPage = 20;

  if (isLoading) {
    return <p className="text-sm text-muted">Carregando métricas do Help Desk…</p>;
  }

  if (!data?.ok) {
    return (
      <div className="rounded-2xl border border-[#eee] p-6">
        <p className="font-medium text-navy">Engine WhatsApp indisponível</p>
        <p className="mt-1 text-sm text-muted">{data?.error || "Não foi possível obter as métricas do inbox."}</p>
      </div>
    );
  }

  const s = data.summary;
  const queues = data.queues || [];
  const users = data.users || [];
  const connections = data.connections || [];
  const queueSlice = queues.slice((queuePage - 1) * perPage, queuePage * perPage);
  const userSlice = users.slice((userPage - 1) * perPage, userPage * perPage);
  const queueMax = Math.max(...queues.map((q) => q.count), 1);
  const userMax = Math.max(...users.map((u) => u.count), 1);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Conversas abertas" value={s.active} hint="Em atendimento no WhatsApp" tone="progress" />
        <Kpi label="Aguardando" value={s.pending} hint="Na fila, sem atendente" tone="open" />
        <Kpi label="Finalizadas" value={s.closed} hint="Conversas encerradas" tone="done" />
        <Kpi label="Não lidas" value={s.unread} hint="Mensagens novas no inbox" tone="brand" />
        <Kpi label="Retornos" value={s.returns} hint="Aguardando com mensagem nova" />
        <Kpi label="Sem atendente" value={s.potentials} hint="Pendentes sem responsável" tone="open" />
        <Kpi label="Atendentes online" value={s.online_attendants} hint="Agentes conectados no engine" />
        <Kpi
          label="Conexões WhatsApp"
          value={connections.filter((c) => (c.status || "").toLowerCase() === "connected").length}
          hint={`${connections.length} cadastrada${connections.length === 1 ? "" : "s"}`}
          tone="done"
        />
      </div>
      <StatusBar
        aberto={s.pending}
        andamento={s.active}
        fechado={s.closed}
        labels={{ aberto: "Aguardando", andamento: "Abertas", fechado: "Finalizadas" }}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy">Por fila</h2>
          <p className="mb-4 text-sm text-muted">Conversas abertas e aguardando</p>
          {queues.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma fila no inbox</p>
          ) : (
            <>
              <div className="space-y-3">
                {queueSlice.map((q, i) => (
                  <div key={`${q.id ?? "none"}-${q.name}`} className="rounded-2xl border border-[#eee] p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: q.color }}
                        >
                          {(queuePage - 1) * perPage + i + 1}º
                        </span>
                        <span className="truncate font-medium text-navy">{q.name}</span>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-ink">{q.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f1f1]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${queueMax > 0 ? Math.max(6, (q.count / queueMax) * 100) : 0}%`,
                          backgroundColor: q.color,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {q.active} abertas · {q.pending} aguardando
                      {q.unread ? ` · ${q.unread} não lidas` : ""}
                    </p>
                  </div>
                ))}
              </div>
              <Pagination page={queuePage} perPage={perPage} total={queues.length} onPage={setQueuePage} />
            </>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy">Atendentes</h2>
          <p className="mb-4 text-sm text-muted">Volume atual no inbox</p>
          {users.length === 0 ? (
            <p className="text-sm text-muted">Nenhum atendente no engine</p>
          ) : (
            <>
              <div className="space-y-3">
                {userSlice.map((u, i) => (
                  <RankRow
                    key={u.id}
                    place={(userPage - 1) * perPage + i + 1}
                    name={u.online ? `${u.name} · online` : u.name}
                    value={String(u.count)}
                    max={userMax}
                    numeric={u.count}
                    barClass="bg-progress"
                  />
                ))}
              </div>
              <Pagination page={userPage} perPage={perPage} total={users.length} onPage={setUserPage} />
            </>
          )}
        </section>
      </div>

      <ClosedVsTicketsChart
        items={data.comparativo_por_dia || []}
        conversasMes={data.conversas_mes_count ?? 0}
        ticketsMes={data.tickets_mes_count ?? 0}
      />
    </div>
  );
}

function agentStatusTone(agent: RemoteAgent) {
  const label = statusLabel(agent);
  if (label === "Online") return { badge: "bg-done-bg text-done", card: "border-done/20" };
  if (label === "Pendente") return { badge: "bg-progress-bg text-progress", card: "border-progress/20" };
  if (label === "Revogado") return { badge: "bg-open-bg text-open", card: "border-open/20" };
  return { badge: "bg-[#f3f4f6] text-muted", card: "border-[#eee]" };
}

function MachineCard({ agent }: { agent: RemoteAgent }) {
  const metrics = agent.snapshot?.metrics;
  const alerts = agent.open_alerts?.length ?? 0;
  const label = statusLabel(agent);
  const tone = agentStatusTone(agent);
  const cpu = metricValue(metrics, "cpu");
  const ram = metricValue(metrics, "ram");
  const disk = metricValue(metrics, "disk");
  const temp = metricValue(metrics, "temperature");

  return (
    <Link
      href={`/monitoramento-remoto/${agent.id}`}
      className={cn(
        "group flex flex-col rounded-2xl border bg-white p-5 transition hover:border-brand/30 hover:shadow-sm",
        tone.card,
        alerts > 0 && "border-open/25",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy group-hover:text-brand">{agent.name}</p>
          <p className="mt-0.5 truncate text-sm text-muted">{agent.external_client_name}</p>
          <p className="mt-1 max-w-full truncate text-xs text-muted">
            {agent.device_id || "Aguardando ativação"}
          </p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tone.badge)}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricChip icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={formatMetric(cpu, "%", 0)} />
        <MetricChip icon={<MemoryStick className="h-3.5 w-3.5" />} label="RAM" value={formatMetric(ram, "%", 0)} />
        <MetricChip icon={<HardDrive className="h-3.5 w-3.5" />} label="Disco" value={formatMetric(disk, "%", 0)} />
        <MetricChip icon={<Thermometer className="h-3.5 w-3.5" />} label="Temp." value={formatMetric(temp, "°C", 0)} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#f0f0f0] pt-3 text-xs text-muted">
        <span>Último contato: {formatDate(agent.last_seen)}</span>
        {alerts > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-open">
            <AlertTriangle className="h-3.5 w-3.5" />
            {alerts} alerta{alerts === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-done">Sem alertas</span>
        )}
      </div>
    </Link>
  );
}

function MetricChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f7f7f8] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="text-brand">{icon}</span>
        {label}
      </div>
      <p className="mt-0.5 text-sm font-semibold text-navy">{value}</p>
    </div>
  );
}

function MonitoramentoDash() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const perPage = 12;

  const stats = useQuery({
    queryKey: ["remote-monitor-stats"],
    queryFn: () => flask.get<RemoteStats>("/api/remote-monitor/stats"),
    refetchInterval: 15000,
  });
  const agents = useQuery({
    queryKey: ["remote-agents-dash", page],
    queryFn: () =>
      flask.get<PageRes<RemoteAgent>>(
        `/api/remote-monitor/agents?page=${page}&per_page=${perPage}`,
      ),
    refetchInterval: 15000,
  });

  useEffect(() => {
    const socket = io(`${remoteSocketOrigin}/remote-monitor-view`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    const update = (payload: RemoteAgent | RemoteLiveEvent) => {
      qc.setQueriesData<PageRes<RemoteAgent>>(
        { queryKey: ["remote-agents-dash"] },
        (current) => mergeAgentPage(current, payload),
      );
      if ("status" in payload) qc.invalidateQueries({ queryKey: ["remote-monitor-stats"] });
    };
    socket.on("telemetry_update", update);
    socket.on("live_telemetry", update);
    return () => {
      socket.close();
    };
  }, [qc]);

  const items = agents.data?.items || [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">Máquinas monitoradas</h2>
          <p className="mt-1 text-sm text-muted">Saúde e métricas dos agentes remotos</p>
        </div>
        <Link
          href="/monitoramento-remoto"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          Gerenciar agentes <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {(stats.error || agents.error) && (
        <p className="mb-4 text-sm text-open">{((stats.error || agents.error) as Error).message}</p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Agentes" value={stats.data?.total ?? "—"} />
        <Kpi label="Online" value={stats.data?.online ?? "—"} tone="done" />
        <Kpi label="Offline" value={stats.data?.offline ?? "—"} />
        <Kpi label="Pendentes" value={stats.data?.pending ?? "—"} tone="progress" />
        <Kpi label="Revogados" value={stats.data?.revoked ?? "—"} />
        <Kpi label="Alertas abertos" value={stats.data?.open_alerts ?? "—"} tone="open" />
      </div>

      {agents.isLoading ? (
        <p className="text-sm text-muted">Carregando máquinas…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-[#eee] p-8 text-center">
          <p className="font-medium text-navy">Nenhuma máquina cadastrada</p>
          <p className="mt-1 text-sm text-muted">Crie um agente em Monitoramento remoto para começar.</p>
          <Link
            href="/monitoramento-remoto"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            Ir para gerenciamento <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((agent) => (
              <MachineCard key={agent.id} agent={agent} />
            ))}
          </div>
          <Pagination
            page={agents.data?.page || page}
            perPage={agents.data?.per_page || perPage}
            total={agents.data?.total || 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: DashTab =
    raw === "helpdesk" ? "helpdesk" : raw === "monitoramento" ? "monitoramento" : "tickets";

  function go(next: DashTab) {
    router.replace(`/dashboard?tab=${next}`);
  }

  return (
    <div>
      <PageTitle>Dashboard</PageTitle>
      <div className="mb-8 flex gap-1 border-b border-line">
        {(
          [
            { key: "tickets", label: "Operação" },
            { key: "helpdesk", label: "Help Desk" },
            { key: "monitoramento", label: "Monitoramento" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item.key)}
            className={cn(
              "relative px-5 py-2.5 text-sm font-semibold",
              tab === item.key ? "text-brand" : "text-muted hover:text-ink",
            )}
          >
            {item.label}
            {tab === item.key ? <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
          </button>
        ))}
      </div>
      {tab === "helpdesk" ? <HelpdeskDash /> : tab === "monitoramento" ? <MonitoramentoDash /> : <TicketsDash />}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando dashboard…</p>}>
      <DashboardInner />
    </Suspense>
  );
}
