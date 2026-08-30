"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleGauge,
  CircleHelp,
  Clock3,
  Cpu,
  DollarSign,
  HardDrive,
  Headphones,
  Inbox,
  MemoryStick,
  MessageCircle,
  Monitor,
  RefreshCw,
  Thermometer,
  TicketCheck,
  Tickets,
  UserCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { io } from "socket.io-client";
import { PageTitle } from "@/components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { flask, type PageRes } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBRL, formatHours } from "@/lib/format";
import {
  formatDate,
  formatMetric,
  mergeAgentPage,
  metricValue,
  reconcileAgentPage,
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

const STATUS_COLORS = { open: "#e11d48", progress: "#3b82f6", done: "#16a34a", muted: "#94a3b8" };

function shortDate(iso: string | number) {
  const raw = String(iso || "").slice(0, 10);
  const [, month, day] = raw.split("-");
  return day && month ? `${day}/${month}` : raw;
}

function DashboardLoading({ cards = 8 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-label="Carregando dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <Skeleton className="mt-5 h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-32 max-w-full" />
          </Card>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

function ErrorState({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  return (
    <Alert className="border-open/20 bg-open-bg/50">
      <AlertTriangle className="h-5 w-5 text-open" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{error instanceof Error ? error.message : "Não foi possível carregar os dados."}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 font-medium text-open hover:underline">
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

type MetricTone = "default" | "open" | "progress" | "done" | "brand";
const METRIC_TONES: Record<MetricTone, { icon: string; accent: string; wash: string }> = {
  default: { icon: "text-navy", accent: "bg-navy", wash: "bg-slate-100" },
  open: { icon: "text-open", accent: "bg-open", wash: "bg-open-bg" },
  progress: { icon: "text-progress", accent: "bg-progress", wash: "bg-progress-bg" },
  done: { icon: "text-done", accent: "bg-done", wash: "bg-done-bg" },
  brand: { icon: "text-brand", accent: "bg-brand", wash: "bg-progress-bg" },
};

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
  tone?: MetricTone;
}) {
  const colors = METRIC_TONES[tone];
  return (
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      <span className={cn("absolute inset-x-0 top-0 h-0.5", colors.accent)} />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-navy sm:text-3xl">{value}</p>
          </div>
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", colors.wash, colors.icon)}>
            <Icon className="h-4.5 w-4.5" />
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="mt-3 flex cursor-help items-center gap-1 truncate text-xs text-muted">
              <CircleHelp className="h-3.5 w-3.5 shrink-0" /> {hint}
            </p>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  );
}

function ChartLegend({ items }: { items: { label: string; color: string; value?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}{item.value === undefined ? "" : ` ${item.value}`}
        </span>
      ))}
    </div>
  );
}

function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="flex h-[260px] items-center justify-center text-center text-sm text-muted">{children}</div>;
}

function StatusDonut({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { name: string; value: number; color: string }[];
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const config = Object.fromEntries(items.map((item) => [item.name, { label: item.name, color: item.color }])) as ChartConfig;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <ChartLegend items={items.map((item) => ({ label: item.name, color: item.color, value: item.value }))} />
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyChart>Sem dados de status no período.</EmptyChart>
        ) : (
          <div className="relative">
            <ChartContainer className="h-[260px]">
              <PieChart>
                <Pie data={items} dataKey="value" nameKey="name" innerRadius={72} outerRadius={100} paddingAngle={3} strokeWidth={0}>
                  {items.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <RechartsTooltip content={<ChartTooltipContent config={config} />} />
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-navy">{total}</span>
              <span className="text-xs text-muted">total</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyAttendancesChart({ items }: { items: DailyCount[] }) {
  const config: ChartConfig = { count: { label: "Tickets finalizados", color: STATUS_COLORS.progress } };
  const hasData = items.some((item) => Number(item.count) > 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Atendimentos dia a dia</CardTitle>
          <CardDescription className="mt-1">Tickets finalizados neste mês</CardDescription>
        </div>
        <ChartLegend items={[{ label: "Finalizados", color: STATUS_COLORS.progress }]} />
      </CardHeader>
      <CardContent>
        {!items.length || !hasData ? (
          <EmptyChart>Sem atendimentos finalizados neste mês.</EmptyChart>
        ) : (
          <ChartContainer>
            <AreaChart data={items} margin={{ left: -20, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="ticketsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={STATUS_COLORS.progress} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={STATUS_COLORS.progress} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="4 4" />
              <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <RechartsTooltip content={<ChartTooltipContent config={config} labelFormatter={shortDate} />} />
              <Area type="monotone" dataKey="count" stroke={STATUS_COLORS.progress} strokeWidth={2.5} fill="url(#ticketsFill)" />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function RankingChart({
  title,
  description,
  items,
  valueKey,
  formatter,
  color,
  empty,
}: {
  title: string;
  description: string;
  items: Record<string, string | number>[];
  valueKey: string;
  formatter: (value: number) => string;
  color: string;
  empty: string;
}) {
  const config: ChartConfig = { [valueKey]: { label: title, color } };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!items.length ? (
          <EmptyChart>{empty}</EmptyChart>
        ) : (
          <ChartContainer className="h-[250px]">
            <BarChart data={items} layout="vertical" margin={{ left: 4, right: 20 }}>
              <CartesianGrid horizontal={false} strokeDasharray="4 4" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <RechartsTooltip
                cursor={{ fill: "#f7f8fa" }}
                content={<ChartTooltipContent config={config} />}
                formatter={(value) => formatter(Number(value))}
              />
              <Bar dataKey={valueKey} fill={color} radius={[0, 6, 6, 0]} barSize={18} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TicketsDash() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => flask.get<Dash>("/api/web/dashboard") });
  if (query.isLoading) return <DashboardLoading />;
  if (query.error || !query.data) {
    return <ErrorState title="Não foi possível carregar a operação" error={query.error} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const status = data.status_counts || {};
  const aberto = status.aberto ?? 0;
  const andamento = status.em_andamento ?? 0;
  const fechado = status.fechado ?? 0;
  const ranking = (data.technician_ranking || []).slice(0, 5);
  const hours = (data.hours_by_user || []).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Tickets do mês" value={data.tickets_mes_count} hint="Finalizados no mês" icon={TicketCheck} tone="brand" />
        <MetricCard label="Abertos" value={aberto} hint="Pendentes" icon={Inbox} tone="open" />
        <MetricCard label="Em atendimento" value={andamento} hint="Em andamento agora" icon={Activity} tone="progress" />
        <MetricCard label="Encerrados" value={fechado} hint="Concluídos" icon={CheckCircle2} tone="done" />
        <MetricCard label="OS do mês" value={data.os_mes_count} hint="Ordens no mês" icon={Wrench} tone="brand" />
        <MetricCard label="Horas apontadas" value={formatHours(data.total_hours)} hint="Total acumulado" icon={Clock3} />
        <MetricCard label="Faturamento do dia" value={formatBRL(data.faturamento_hoje)} hint="Tickets + OS de hoje" icon={DollarSign} tone="done" />
        <MetricCard label="Tickets hoje" value={data.tickets_hoje_count} hint="Fechados hoje" icon={Tickets} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
        <DailyAttendancesChart items={data.tickets_por_dia || []} />
        <StatusDonut
          title="Situação dos tickets"
          description="Distribuição atual por status"
          items={[
            { name: "Abertos", value: aberto, color: STATUS_COLORS.open },
            { name: "Em atendimento", value: andamento, color: STATUS_COLORS.progress },
            { name: "Encerrados", value: fechado, color: STATUS_COLORS.done },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RankingChart
          title="Ranking de técnicos"
          description="Tickets e OS finalizados neste mês"
          items={ranking}
          valueKey="tickets_count"
          formatter={String}
          color={STATUS_COLORS.progress}
          empty="Sem ranking neste mês."
        />
        <RankingChart
          title="Horas por técnico"
          description="Apontamentos acumulados"
          items={hours}
          valueKey="hours"
          formatter={formatHours}
          color="#6366f1"
          empty="Sem horas apontadas."
        />
      </div>

      {data.technicians_in_progress?.length ? (
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-navy">Em atendimento agora</h2>
            <p className="mt-1 text-sm text-muted">Chamados ativos agrupados por técnico</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.technicians_in_progress.map((tech) => (
              <Card key={tech.name} className="overflow-hidden border-progress/20">
                <CardHeader className="border-b border-line bg-progress-bg/60">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{tech.name}</CardTitle>
                      <CardDescription className="mt-1">{tech.tickets_count} em andamento</CardDescription>
                    </div>
                    <span className="rounded-lg bg-white px-2.5 py-1 text-sm font-semibold text-progress shadow-sm">
                      {formatHours(tech.total_hours)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-4">
                  {tech.tickets.map((ticket) => (
                    <div key={ticket.id} className="rounded-xl border border-line bg-[#fafbfc] px-3 py-2.5">
                      <p className="line-clamp-1 text-sm font-medium text-ink">{ticket.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">{ticket.client_name}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ComparisonChart({ items, conversasMes, ticketsMes }: { items: ComparativoDia[]; conversasMes: number; ticketsMes: number }) {
  const config: ChartConfig = {
    conversas: { label: "Conversas", color: STATUS_COLORS.done },
    tickets: { label: "Tickets", color: STATUS_COLORS.progress },
  };
  const hasData = items.some((item) => item.conversas > 0 || item.tickets > 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Conversas encerradas × tickets</CardTitle>
          <CardDescription className="mt-1">Comparativo dia a dia neste mês</CardDescription>
        </div>
        <ChartLegend items={[
          { label: "Conversas", color: STATUS_COLORS.done, value: conversasMes },
          { label: "Tickets", color: STATUS_COLORS.progress, value: ticketsMes },
        ]} />
      </CardHeader>
      <CardContent>
        {!items.length || !hasData ? (
          <EmptyChart>Sem encerramentos neste mês.</EmptyChart>
        ) : (
          <ChartContainer>
            <LineChart data={items} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 4" />
              <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <RechartsTooltip content={<ChartTooltipContent config={config} labelFormatter={shortDate} />} />
              <Line type="monotone" dataKey="conversas" stroke={STATUS_COLORS.done} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="tickets" stroke={STATUS_COLORS.progress} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ListRanking({
  title,
  description,
  children,
  empty,
  isEmpty,
}: {
  title: string;
  description: string;
  children: ReactNode;
  empty: string;
  isEmpty: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{isEmpty ? <EmptyChart>{empty}</EmptyChart> : children}</CardContent>
    </Card>
  );
}

function HelpdeskDash() {
  const query = useQuery({
    queryKey: ["dashboard-helpdesk"],
    queryFn: () => flask.get<HdDash>("/api/web/dashboard/helpdesk"),
    retry: 1,
  });
  const [queuePage, setQueuePage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const perPage = 20;

  if (query.isLoading) return <DashboardLoading />;
  if (query.error) {
    return <ErrorState title="Não foi possível carregar o Help Desk" error={query.error} onRetry={() => query.refetch()} />;
  }
  if (!query.data?.ok) {
    return <ErrorState title="Engine WhatsApp indisponível" error={new Error(query.data?.error || "Não foi possível obter as métricas do inbox.")} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const summary = data.summary;
  const queues = data.queues || [];
  const users = data.users || [];
  const connections = data.connections || [];
  const queueSlice = queues.slice((queuePage - 1) * perPage, queuePage * perPage);
  const userSlice = users.slice((userPage - 1) * perPage, userPage * perPage);
  const queueMax = Math.max(...queues.map((queue) => queue.count), 1);
  const userMax = Math.max(...users.map((user) => user.count), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Conversas abertas" value={summary.active} hint="Em atendimento no WhatsApp" icon={MessageCircle} tone="progress" />
        <MetricCard label="Aguardando" value={summary.pending} hint="Na fila, sem atendente" icon={Clock3} tone="open" />
        <MetricCard label="Finalizadas" value={summary.closed} hint="Conversas encerradas" icon={CheckCircle2} tone="done" />
        <MetricCard label="Não lidas" value={summary.unread} hint="Mensagens novas no inbox" icon={Inbox} tone="brand" />
        <MetricCard label="Retornos" value={summary.returns} hint="Aguardando com mensagem nova" icon={RefreshCw} />
        <MetricCard label="Sem atendente" value={summary.potentials} hint="Pendentes sem responsável" icon={CircleHelp} tone="open" />
        <MetricCard label="Atendentes online" value={summary.online_attendants} hint="Agentes conectados no engine" icon={UserCheck} tone="done" />
        <MetricCard
          label="Conexões WhatsApp"
          value={connections.filter((connection) => connection.status.toLowerCase() === "connected").length}
          hint={`${connections.length} cadastrada${connections.length === 1 ? "" : "s"}`}
          icon={Headphones}
          tone="done"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.65fr)]">
        <StatusDonut
          title="Situação das conversas"
          description="Distribuição atual no inbox"
          items={[
            { name: "Aguardando", value: summary.pending, color: STATUS_COLORS.open },
            { name: "Abertas", value: summary.active, color: STATUS_COLORS.progress },
            { name: "Finalizadas", value: summary.closed, color: STATUS_COLORS.done },
          ]}
        />
        <ComparisonChart
          items={data.comparativo_por_dia || []}
          conversasMes={data.conversas_mes_count ?? 0}
          ticketsMes={data.tickets_mes_count ?? 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ListRanking title="Por fila" description="Conversas abertas e aguardando" empty="Nenhuma fila no inbox." isEmpty={!queues.length}>
          <div className="space-y-3">
            {queueSlice.map((queue, index) => (
              <div key={`${queue.id ?? "none"}-${queue.name}`} className="rounded-xl border border-line p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: queue.color }}>
                      {(queuePage - 1) * perPage + index + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-navy">{queue.name}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-ink">{queue.count}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(6, (queue.count / queueMax) * 100)}%`, backgroundColor: queue.color }} />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {queue.active} abertas · {queue.pending} aguardando{queue.unread ? ` · ${queue.unread} não lidas` : ""}
                </p>
              </div>
            ))}
            <Pagination page={queuePage} perPage={perPage} total={queues.length} onPage={setQueuePage} />
          </div>
        </ListRanking>

        <ListRanking title="Atendentes" description="Volume atual no inbox" empty="Nenhum atendente no engine." isEmpty={!users.length}>
          <div className="space-y-3">
            {userSlice.map((user) => (
              <div key={user.id} className="rounded-xl border border-line p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", user.online ? "bg-done" : "bg-muted")} />
                    <span className="truncate text-sm font-medium text-navy">{user.name}</span>
                    {user.online ? <span className="text-[11px] text-done">online</span> : null}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-ink">{user.count}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]">
                  <div className="h-full rounded-full bg-progress" style={{ width: `${Math.max(6, (user.count / userMax) * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {user.active} abertas · {user.pending} aguardando{user.unread ? ` · ${user.unread} não lidas` : ""}
                </p>
              </div>
            ))}
            <Pagination page={userPage} perPage={perPage} total={users.length} onPage={setUserPage} />
          </div>
        </ListRanking>
      </div>
    </div>
  );
}

function agentStatusTone(agent: RemoteAgent) {
  const label = statusLabel(agent);
  if (label === "Online") return { badge: "bg-done-bg text-done", card: "border-done/20" };
  if (label === "Pendente") return { badge: "bg-progress-bg text-progress", card: "border-progress/20" };
  if (label === "Revogado") return { badge: "bg-open-bg text-open", card: "border-open/20" };
  return { badge: "bg-[#f3f4f6] text-muted", card: "border-line" };
}

function MetricChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f7f8fa] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted"><span className="text-brand">{icon}</span>{label}</div>
      <p className="mt-1 text-sm font-semibold tabular-nums text-navy">{value}</p>
    </div>
  );
}

function MachineCard({ agent }: { agent: RemoteAgent }) {
  const metrics = agent.snapshot?.metrics;
  const alerts = agent.open_alerts?.length ?? 0;
  const tone = agentStatusTone(agent);
  return (
    <Link href={`/monitoramento-remoto/${agent.id}`} className="group">
      <Card className={cn("h-full transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md", tone.card, alerts > 0 && "border-open/25")}>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate transition-colors group-hover:text-brand">{agent.name}</CardTitle>
              <CardDescription className="mt-1 truncate">{agent.external_client_name}</CardDescription>
              <p className="mt-1 truncate text-xs text-muted">{agent.device_id || "Aguardando ativação"}</p>
            </div>
            <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tone.badge)}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> {statusLabel(agent)}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <MetricChip icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={formatMetric(metricValue(metrics, "cpu"), "%", 0)} />
            <MetricChip icon={<MemoryStick className="h-3.5 w-3.5" />} label="RAM" value={formatMetric(metricValue(metrics, "ram"), "%", 0)} />
            <MetricChip icon={<HardDrive className="h-3.5 w-3.5" />} label="Disco" value={formatMetric(metricValue(metrics, "disk"), "%", 0)} />
            <MetricChip icon={<Thermometer className="h-3.5 w-3.5" />} label="Temp." value={formatMetric(metricValue(metrics, "temperature"), "°C", 0)} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
            <span className="truncate">Último contato: {formatDate(agent.last_seen)}</span>
            {alerts ? (
              <span className="inline-flex shrink-0 items-center gap-1 font-medium text-open"><AlertTriangle className="h-3.5 w-3.5" />{alerts}</span>
            ) : (
              <span className="shrink-0 text-done">Sem alertas</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function MonitoramentoDash() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const perPage = 12;
  const stats = useQuery({
    queryKey: ["remote-monitor-stats"],
    queryFn: () => flask.get<RemoteStats>("/api/remote-monitor/stats"),
    refetchInterval: 15000,
  });
  const agents = useQuery({
    queryKey: ["remote-agents-dash", page],
    queryFn: async () => {
      const incoming = await flask.get<PageRes<RemoteAgent>>(`/api/remote-monitor/agents?page=${page}&per_page=${perPage}`);
      return reconcileAgentPage(queryClient.getQueryData<PageRes<RemoteAgent>>(["remote-agents-dash", page]), incoming);
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    const socket = io(`${remoteSocketOrigin}/remote-monitor-view`, { transports: ["websocket", "polling"], withCredentials: true });
    const update = (payload: RemoteAgent | RemoteLiveEvent) => {
      queryClient.setQueriesData<PageRes<RemoteAgent>>({ queryKey: ["remote-agents-dash"] }, (current) => mergeAgentPage(current, payload));
      if ("status" in payload) queryClient.invalidateQueries({ queryKey: ["remote-monitor-stats"] });
    };
    socket.on("telemetry_update", update);
    socket.on("live_telemetry", update);
    return () => {
      socket.close();
    };
  }, [queryClient]);

  const items = agents.data?.items || [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">Máquinas monitoradas</h2>
          <p className="mt-1 text-sm text-muted">Saúde e métricas dos agentes remotos</p>
        </div>
        <Link href="/monitoramento-remoto" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
          Gerenciar agentes <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {(stats.error || agents.error) ? (
        <ErrorState
          title="Parte do monitoramento está indisponível"
          error={stats.error || agents.error}
          onRetry={() => { stats.refetch(); agents.refetch(); }}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Agentes" value={stats.data?.total ?? "—"} hint="Total cadastrado" icon={Monitor} />
        <MetricCard label="Online" value={stats.data?.online ?? "—"} hint="Agentes conectados" icon={Activity} tone="done" />
        <MetricCard label="Offline" value={stats.data?.offline ?? "—"} hint="Sem conexão atual" icon={CircleGauge} />
        <MetricCard label="Pendentes" value={stats.data?.pending ?? "—"} hint="Aguardando ativação" icon={Clock3} tone="progress" />
        <MetricCard label="Revogados" value={stats.data?.revoked ?? "—"} hint="Acesso revogado" icon={Users} />
        <MetricCard label="Alertas abertos" value={stats.data?.open_alerts ?? "—"} hint="Requerem atenção" icon={AlertTriangle} tone="open" />
      </div>

      {agents.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}
        </div>
      ) : !items.length ? (
        <Card className="py-12 text-center">
          <CardContent>
            <Monitor className="mx-auto h-9 w-9 text-muted" />
            <p className="mt-4 font-medium text-navy">Nenhuma máquina cadastrada</p>
            <p className="mt-1 text-sm text-muted">Crie um agente em Monitoramento remoto para começar.</p>
            <Link href="/monitoramento-remoto" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
              Ir para gerenciamento <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((agent) => <MachineCard key={agent.id} agent={agent} />)}</div>
          <Pagination page={agents.data?.page || page} perPage={agents.data?.per_page || perPage} total={agents.data?.total || 0} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: DashTab = raw === "helpdesk" ? "helpdesk" : raw === "monitoramento" ? "monitoramento" : "tickets";

  return (
    <TooltipProvider>
      <div>
        <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <PageTitle className="mb-1">Dashboard</PageTitle>
            <p className="text-sm text-muted">Visão consolidada da operação, atendimento e infraestrutura.</p>
          </div>
          <Tabs value={tab} onValueChange={(value) => router.replace(`/dashboard?tab=${value}`)}>
            <TabsList className="w-full overflow-x-auto sm:w-auto">
              <TabsTrigger value="tickets"><Tickets className="h-4 w-4" /> Operação</TabsTrigger>
              <TabsTrigger value="helpdesk"><Headphones className="h-4 w-4" /> Help Desk</TabsTrigger>
              <TabsTrigger value="monitoramento"><Monitor className="h-4 w-4" /> Monitoramento</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Tabs value={tab} onValueChange={(value) => router.replace(`/dashboard?tab=${value}`)}>
          <TabsContent value="tickets"><TicketsDash /></TabsContent>
          <TabsContent value="helpdesk"><HelpdeskDash /></TabsContent>
          <TabsContent value="monitoramento"><MonitoramentoDash /></TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardInner />
    </Suspense>
  );
}
/*
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
  reconcileAgentPage,
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
    queryFn: async () => {
      const incoming = await flask.get<PageRes<RemoteAgent>>(
        `/api/remote-monitor/agents?page=${page}&per_page=${perPage}`,
      );
      return reconcileAgentPage(
        qc.getQueryData<PageRes<RemoteAgent>>(["remote-agents-dash", page]),
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
*/
