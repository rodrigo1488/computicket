"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { Kpi } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBRL, formatHours } from "@/lib/format";

type DashTab = "tickets" | "helpdesk";

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

function connectionLabel(status?: string) {
  const s = (status || "").toLowerCase();
  if (s === "connected") return "Conectada";
  if (s === "qrcode") return "Aguardando QR";
  if (s === "opening") return "Abrindo…";
  if (s === "disconnected" || s === "pending") return "Desconectada";
  if (s === "timeout") return "Timeout";
  return status || "—";
}

function connectionClass(status?: string) {
  const s = (status || "").toLowerCase();
  if (s === "connected") return "bg-done-bg text-done";
  if (s === "qrcode" || s === "opening") return "bg-progress-bg text-progress";
  return "bg-[#f3f4f6] text-muted";
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
  const ranking = data?.technician_ranking || [];
  const hours = data?.hours_by_user || [];
  const [rankPage, setRankPage] = useState(1);
  const [hoursPage, setHoursPage] = useState(1);
  const perPage = 20;
  const rankSlice = ranking.slice((rankPage - 1) * perPage, rankPage * perPage);
  const hoursSlice = hours.slice((hoursPage - 1) * perPage, hoursPage * perPage);
  const rankMax = Math.max(...ranking.map((r) => r.tickets_count), 1);
  const hoursMax = Math.max(...hours.map((r) => r.hours), 1);
  const inProgress = data?.technicians_in_progress || [];

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

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy">Ranking de técnicos</h2>
          <p className="mb-4 text-sm text-muted">Tickets e OS finalizados neste mês</p>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted">Sem ranking neste mês</p>
          ) : (
            <>
              <div className="space-y-3">
                {rankSlice.map((r, i) => (
                  <RankRow
                    key={r.name}
                    place={(rankPage - 1) * perPage + i + 1}
                    name={r.name}
                    value={String(r.tickets_count)}
                    max={rankMax}
                    numeric={r.tickets_count}
                    barClass="bg-brand"
                  />
                ))}
              </div>
              <Pagination page={rankPage} perPage={perPage} total={ranking.length} onPage={setRankPage} />
            </>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy">Horas por técnico</h2>
          <p className="mb-4 text-sm text-muted">Apontamentos acumulados</p>
          {hours.length === 0 ? (
            <p className="text-sm text-muted">Sem horas apontadas</p>
          ) : (
            <>
              <div className="space-y-3">
                {hoursSlice.map((r, i) => (
                  <RankRow
                    key={r.name}
                    place={(hoursPage - 1) * perPage + i + 1}
                    name={r.name}
                    value={formatHours(r.hours)}
                    max={hoursMax}
                    numeric={r.hours}
                    barClass="bg-progress"
                  />
                ))}
              </div>
              <Pagination page={hoursPage} perPage={perPage} total={hours.length} onPage={setHoursPage} />
            </>
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

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-navy">Conexões WhatsApp</h2>
        {connections.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma conexão cadastrada</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {connections.map((c) => {
              const connected = (c.status || "").toLowerCase() === "connected";
              return (
                <div
                  key={c.id}
                  className={cn(
                    "rounded-2xl border p-5",
                    connected ? "border-done/20 bg-done-bg" : "border-[#eee] bg-white",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-navy">{c.name}</p>
                      <p className="text-xs text-muted">{c.number || "Sem número"}</p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", connectionClass(c.status))}>
                      {connectionLabel(c.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: DashTab = params.get("tab") === "helpdesk" ? "helpdesk" : "tickets";

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
      {tab === "helpdesk" ? <HelpdeskDash /> : <TicketsDash />}
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
