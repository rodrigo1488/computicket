"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText } from "lucide-react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable, Kpi } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { applyColFilters, applyTextSearch } from "@/lib/col-filters";
import { cn } from "@/lib/cn";
import { formatBRL, formatHours } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type HoursClient = {
  client_id?: number | null;
  external_client_id?: number | null;
  external_client_name?: string | null;
  client_name: string;
  client_type: string;
  total_hours: number;
  tickets_count: number;
  avg_hours_per_entry: number;
};
type HoursTech = {
  name: string;
  role: string;
  total_hours: number;
  entries_count: number;
  tickets_count: number;
  avg_hours_per_entry: number;
};
type BillingTech = {
  name: string;
  role: string;
  total_billing: number;
  tickets_count: number;
  service_orders_count: number;
};
type TicketsTech = {
  name: string;
  role: string;
  total_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  closed_tickets: number;
  total_hours: number;
};
type TicketsClient = {
  client_id?: number | null;
  external_client_id?: number | null;
  external_client_name?: string | null;
  client_name: string;
  client_type: string;
  total_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  closed_tickets: number;
  cancelled_tickets?: number;
  total_hours: number;
};
type ServicePerf = {
  name: string;
  hourly_rate: number;
  tickets_count: number;
  total_hours: number;
  avg_hours_per_ticket: number;
  total_revenue: number;
};
type Daily = { date: string; count?: number; hours?: number };
type Reports = {
  status_counts: Record<string, number>;
  total_hours: number;
  total_tickets: number;
  total_os: number;
  hours_by_client: HoursClient[];
  hours_by_technician: HoursTech[];
  billing_by_technician: BillingTech[];
  tickets_by_technician: TicketsTech[];
  tickets_by_client: TicketsClient[];
  productivity: {
    total_tickets: number;
    closed_tickets: number;
    closure_rate: number;
    avg_resolution_time: number;
    daily_tickets: Daily[];
    daily_hours: Daily[];
  };
  service_performance: ServicePerf[];
};

type TabId =
  | "hours-client"
  | "hours-technician"
  | "billing-technician"
  | "tickets-technician"
  | "tickets-client"
  | "productivity"
  | "service-performance";

const TABS: { id: TabId; label: string }[] = [
  { id: "hours-client", label: "Horas por cliente" },
  { id: "hours-technician", label: "Horas por técnico" },
  { id: "billing-technician", label: "Faturamento" },
  { id: "tickets-technician", label: "Tickets por técnico" },
  { id: "tickets-client", label: "Tickets por cliente" },
  { id: "productivity", label: "Produtividade" },
  { id: "service-performance", label: "Performance por serviço" },
];

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthBounds() {
  const now = new Date();
  return { start: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoDate(now) };
}

function roleLabel(role?: string) {
  const r = (role || "").toLowerCase();
  if (r === "admin" || r === "administrador" || r === "administrator") return "Admin";
  if (r === "tecnico") return "Técnico";
  if (r === "viewer") return "Visualizador";
  return role || "—";
}

function shortDate(iso: string) {
  const raw = (iso || "").slice(0, 10);
  const [y, m, d] = raw.split("-");
  if (!d || !m) return raw;
  return `${d}/${m}`;
}

function fillDaily(items: Daily[], start: string, end: string, valueKey: "count" | "hours"): Daily[] {
  if (!items.length || !start || !end) return items;
  const map = new Map(items.map((i) => [String(i.date).slice(0, 10), i]));
  const out: Daily[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return items;
  while (cur <= last) {
    const key = isoDate(cur);
    const found = map.get(key);
    out.push(found ?? { date: key, [valueKey]: 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function MiniBars({
  items,
  valueKey,
  barClass,
  formatValue,
}: {
  items: Daily[];
  valueKey: "count" | "hours";
  barClass: string;
  formatValue?: (n: number) => string;
}) {
  const values = items.map((i) => Number(i[valueKey] || 0));
  const max = Math.max(...values, 0);
  if (!items.length || max <= 0) {
    return <p className="flex h-64 items-center text-sm text-muted">Sem dados no período</p>;
  }

  const chartH = 208;
  const labelEvery = Math.max(1, Math.ceil(items.length / 8));
  const fmt = formatValue ?? ((n: number) => String(n));

  return (
    <div className="h-72">
      <div className="flex h-56 gap-2">
        <div className="flex h-52 w-10 shrink-0 flex-col justify-between pb-px text-right text-[10px] text-muted">
          <span>{fmt(max)}</span>
          <span>{fmt(0)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-52 items-stretch gap-px border-b border-line sm:gap-1">
            {items.map((item) => {
              const v = Number(item[valueKey] || 0);
              const h = v > 0 ? Math.max(6, (v / max) * chartH) : 0;
              return (
                <div
                  key={item.date}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                  title={`${shortDate(item.date)}: ${fmt(v)}`}
                >
                  <div className={cn("w-full max-w-8 rounded-t", barClass)} style={{ height: `${h}px` }} />
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
  );
}

const EXPORT_PATH: Record<TabId, string> = {
  "hours-client": "/relatorios/export/hours-by-client-excel",
  "hours-technician": "/relatorios/export/hours-by-technician",
  "billing-technician": "/relatorios/export/billing-by-technician",
  "tickets-technician": "/relatorios/export/tickets-by-technician",
  "tickets-client": "/relatorios/export/tickets-by-client",
  productivity: "/relatorios/export/productivity",
  "service-performance": "/relatorios/export/service-performance",
};

function ExportBar({
  onExcel,
  onPdf,
  exporting,
}: {
  onExcel: () => void;
  onPdf?: () => void;
  exporting?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={onExcel}
        disabled={exporting}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-wash disabled:opacity-50"
      >
        <FileSpreadsheet className="h-4 w-4" />
        {exporting ? "Exportando…" : "Exportar Excel"}
      </button>
      {onPdf ? (
        <button
          type="button"
          onClick={onPdf}
          disabled={exporting}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          Exportar PDF
        </button>
      ) : null}
    </div>
  );
}

export default function RelatoriosPage() {
  const defaults = useMemo(() => monthBounds(), []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [applied, setApplied] = useState(defaults);
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState<TabId>("hours-client");
  const [tablePage, setTablePage] = useState(1);
  const [tableQ, setTableQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfClient, setPdfClient] = useState("");
  const [pdfKind, setPdfKind] = useState<"detailed" | "synthetic">("detailed");
  const { colFilters, onFiltersChange } = useColFilters();
  const perPage = 25;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["reports", applied.start, applied.end],
    queryFn: () =>
      flask.get<Reports>(`/api/web/reports?start=${encodeURIComponent(applied.start)}&end=${encodeURIComponent(applied.end)}`),
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    setTablePage(1);
  }, [tab, tableQ, colFilters, applied.start, applied.end]);

  const hoursClient = useMemo(() => {
    const rows = applyTextSearch(data?.hours_by_client || [], tableQ, (r) => [r.client_name, r.client_type]);
    return applyColFilters(rows, colFilters);
  }, [data?.hours_by_client, tableQ, colFilters]);
  const hoursTech = useMemo(() => {
    const rows = applyTextSearch(data?.hours_by_technician || [], tableQ, (r) => [r.name, roleLabel(r.role)]).map(
      (r) => ({ ...r, role: roleLabel(r.role) }),
    );
    return applyColFilters(rows, colFilters);
  }, [data?.hours_by_technician, tableQ, colFilters]);
  const billingTech = useMemo(() => {
    const rows = applyTextSearch(data?.billing_by_technician || [], tableQ, (r) => [r.name, roleLabel(r.role)]).map(
      (r) => ({ ...r, role: roleLabel(r.role) }),
    );
    return applyColFilters(rows, colFilters);
  }, [data?.billing_by_technician, tableQ, colFilters]);
  const ticketsTech = useMemo(() => {
    const rows = applyTextSearch(data?.tickets_by_technician || [], tableQ, (r) => [r.name, roleLabel(r.role)]).map(
      (r) => ({ ...r, role: roleLabel(r.role) }),
    );
    return applyColFilters(rows, colFilters);
  }, [data?.tickets_by_technician, tableQ, colFilters]);
  const ticketsClient = useMemo(() => {
    const rows = applyTextSearch(data?.tickets_by_client || [], tableQ, (r) => [r.client_name, r.client_type]);
    return applyColFilters(rows, colFilters);
  }, [data?.tickets_by_client, tableQ, colFilters]);
  const servicePerf = useMemo(() => {
    const rows = applyTextSearch(data?.service_performance || [], tableQ, (r) => [r.name]);
    return applyColFilters(rows, colFilters);
  }, [data?.service_performance, tableQ, colFilters]);

  const sc = data?.status_counts || {};
  const prod = data?.productivity;

  function applyQuick(value: string) {
    setPeriod(value);
    if (!value) return;
    const today = new Date();
    let from = today;
    if (value === "today") from = today;
    if (value === "week") {
      from = new Date(today);
      from.setDate(today.getDate() - 6);
    }
    if (value === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
    if (value === "quarter") {
      const q = Math.floor(today.getMonth() / 3) * 3;
      from = new Date(today.getFullYear(), q, 1);
    }
    if (value === "year") from = new Date(today.getFullYear(), 0, 1);
    const next = { start: isoDate(from), end: isoDate(today) };
    setStart(next.start);
    setEnd(next.end);
    setApplied(next);
  }

  async function exportExcel() {
    setExportErr("");
    setExporting(true);
    try {
      const qs = `start=${encodeURIComponent(applied.start)}&end=${encodeURIComponent(applied.end)}`;
      await flask.download(`${EXPORT_PATH[tab]}?${qs}`);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Não foi possível exportar");
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    const client = (data?.hours_by_client || []).find((c, i) => clientKey(c, i) === pdfClient);
    if (!client) {
      setExportErr("Selecione um cliente para o PDF");
      return;
    }
    setExportErr("");
    setExporting(true);
    try {
      const params = new URLSearchParams({ start: applied.start, end: applied.end });
      if (client.client_id) params.set("client_id", String(client.client_id));
      else if (client.external_client_id) params.set("external_client_id", String(client.external_client_id));
      if (client.external_client_name) params.set("external_client_name", client.external_client_name);
      const path =
        pdfKind === "synthetic"
          ? "/relatorios/export/hours-by-client-synthetic-pdf"
          : "/relatorios/export/hours-by-client-pdf";
      await flask.download(`${path}?${params.toString()}`);
      setPdfOpen(false);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Não foi possível gerar o PDF");
    } finally {
      setExporting(false);
    }
  }

  function clientKey(c: HoursClient, i?: number) {
    if (c.client_id) return `int-${c.client_id}`;
    if (c.external_client_id) return `ext-${c.external_client_id}`;
    if (c.external_client_name) return `name-${c.external_client_name}`;
    return `idx-${i ?? c.client_name}`;
  }

  return (
    <div>
      <PageTitle>Relatórios</PageTitle>
      <p className="mb-6 -mt-6 text-sm text-muted">Análise de horas, faturamento e produtividade no período</p>

      <div className="mb-8 grid gap-6 md:grid-cols-4">
        <UnderlineField label="Data início" type="date" value={start} onChange={setStart} />
        <UnderlineField label="Data fim" type="date" value={end} onChange={setEnd} />
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Período rápido</span>
          <select
            value={period}
            onChange={(e) => applyQuick(e.target.value)}
            className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
          >
            <option value="">Selecionar período</option>
            <option value="today">Hoje</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mês</option>
            <option value="quarter">Este trimestre</option>
            <option value="year">Este ano</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setApplied({ start, end })}
            className="h-11 rounded-xl bg-inverse px-5 text-sm font-medium text-on-inverse"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      {exportErr ? <p className="mb-4 text-sm text-open">{exportErr}</p> : null}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Tickets" value={data?.total_tickets ?? 0} tone="brand" />
        <Kpi label="Abertos" value={sc.aberto ?? 0} tone="open" />
        <Kpi label="Em atendimento" value={sc.em_andamento ?? 0} tone="progress" />
        <Kpi label="Encerrados" value={sc.fechado ?? 0} tone="done" />
        <Kpi label="Horas apontadas" value={formatHours(data?.total_hours)} />
        <Kpi label="Ordens de serviço" value={data?.total_os ?? 0} tone="brand" />
        <Kpi label="Taxa de fechamento" value={`${Number(prod?.closure_rate || 0).toFixed(1)}%`} tone="done" />
        <Kpi label="Tickets fechados" value={prod?.closed_tickets ?? 0} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setTablePage(1);
              setTableQ("");
              onFiltersChange([]);
            }}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition",
              tab === item.id ? "bg-inverse text-on-inverse" : "bg-wash text-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "hours-client" ? (
        <>
          <ExportBar
            onExcel={exportExcel}
            onPdf={() => {
              setPdfClient("");
              setPdfOpen(true);
            }}
            exporting={exporting}
          />
          <DataTable
            id="relatorios-horas-cliente"
            loading={isLoading}
            refreshing={isFetching}
            key="hours-client"
            searchPlaceholder="Buscar por cliente, tipo…"
            searchValue={tableQ}
            onSearch={setTableQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Tipo: { field: "client_type" },
              Horas: { field: "total_hours" },
              Tickets: { field: "tickets_count" },
              "Média por entrada": { field: "avg_hours_per_entry" },
            }}
            columns={["Cliente", "Tipo", "Horas", "Tickets", "Média por entrada"]}
            rows={hoursClient
              .slice((tablePage - 1) * perPage, tablePage * perPage)
              .map((r) => [
                r.client_name,
                r.client_type,
                formatHours(r.total_hours),
                String(r.tickets_count),
                formatHours(r.avg_hours_per_entry),
              ])}
            empty="Nenhum dado de horas por cliente no período"
          />
          <Pagination
            page={tablePage}
            perPage={perPage}
            total={hoursClient.length}
            onPage={setTablePage}
          />
        </>
      ) : null}

      {tab === "hours-technician" ? (
        <>
          <ExportBar onExcel={exportExcel} exporting={exporting} />
          <DataTable
            id="relatorios-horas-tecnico"
            loading={isLoading}
            refreshing={isFetching}
            key="hours-technician"
            searchPlaceholder="Buscar por técnico…"
            searchValue={tableQ}
            onSearch={setTableQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Técnico: { field: "name" },
              Função: { field: "role" },
              Horas: { field: "total_hours" },
              Entradas: { field: "entries_count" },
              Tickets: { field: "tickets_count" },
              "Média por entrada": { field: "avg_hours_per_entry" },
            }}
            columns={["Técnico", "Função", "Horas", "Entradas", "Tickets", "Média por entrada"]}
            rows={hoursTech
              .slice((tablePage - 1) * perPage, tablePage * perPage)
              .map((r) => [
                r.name,
                roleLabel(r.role),
                formatHours(r.total_hours),
                String(r.entries_count),
                String(r.tickets_count),
                formatHours(r.avg_hours_per_entry),
              ])}
            empty="Nenhum dado de horas por técnico no período"
          />
          <Pagination
            page={tablePage}
            perPage={perPage}
            total={hoursTech.length}
            onPage={setTablePage}
          />
        </>
      ) : null}

      {tab === "billing-technician" ? (
        <>
          <ExportBar onExcel={exportExcel} exporting={exporting} />
          <DataTable
            id="relatorios-faturamento"
            loading={isLoading}
            refreshing={isFetching}
            key="billing-technician"
            searchPlaceholder="Buscar por técnico…"
            searchValue={tableQ}
            onSearch={setTableQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Técnico: { field: "name" },
              Função: { field: "role" },
              Faturamento: { field: "total_billing" },
              Tickets: { field: "tickets_count" },
              OS: { field: "service_orders_count" },
            }}
            columns={["Técnico", "Função", "Faturamento", "Tickets", "OS"]}
            rows={billingTech
              .slice((tablePage - 1) * perPage, tablePage * perPage)
              .map((r) => [
                r.name,
                roleLabel(r.role),
                formatBRL(r.total_billing),
                String(r.tickets_count),
                String(r.service_orders_count),
              ])}
            empty="Nenhum faturamento no período"
          />
          <Pagination
            page={tablePage}
            perPage={perPage}
            total={billingTech.length}
            onPage={setTablePage}
          />
        </>
      ) : null}

      {tab === "tickets-technician" ? (
        <>
          <ExportBar onExcel={exportExcel} exporting={exporting} />
          <DataTable
            id="relatorios-tickets-tecnico"
            loading={isLoading}
            refreshing={isFetching}
            key="tickets-technician"
            searchPlaceholder="Buscar por técnico…"
            searchValue={tableQ}
            onSearch={setTableQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Técnico: { field: "name" },
              Função: { field: "role" },
              Total: { field: "total_tickets" },
              Abertos: { field: "open_tickets" },
              "Em atendimento": { field: "in_progress_tickets" },
              Encerrados: { field: "closed_tickets" },
              Horas: { field: "total_hours" },
            }}
            columns={["Técnico", "Função", "Total", "Abertos", "Em atendimento", "Encerrados", "Horas"]}
            rows={ticketsTech
              .slice((tablePage - 1) * perPage, tablePage * perPage)
              .map((r) => [
                r.name,
                roleLabel(r.role),
                String(r.total_tickets),
                String(r.open_tickets),
                String(r.in_progress_tickets),
                String(r.closed_tickets),
                formatHours(r.total_hours),
              ])}
            empty="Nenhum ticket no período"
          />
          <Pagination
            page={tablePage}
            perPage={perPage}
            total={ticketsTech.length}
            onPage={setTablePage}
          />
        </>
      ) : null}

      {tab === "tickets-client" ? (
        <>
          <ExportBar onExcel={exportExcel} exporting={exporting} />
          <DataTable
            id="relatorios-tickets-cliente"
            loading={isLoading}
            refreshing={isFetching}
            key="tickets-client"
            searchPlaceholder="Buscar por cliente…"
            searchValue={tableQ}
            onSearch={setTableQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Tipo: { field: "client_type" },
              Total: { field: "total_tickets" },
              Abertos: { field: "open_tickets" },
              "Em atendimento": { field: "in_progress_tickets" },
              Encerrados: { field: "closed_tickets" },
              Horas: { field: "total_hours" },
            }}
            columns={["Cliente", "Tipo", "Total", "Abertos", "Em atendimento", "Encerrados", "Horas"]}
            rows={ticketsClient
              .slice((tablePage - 1) * perPage, tablePage * perPage)
              .map((r) => [
                r.client_name,
                r.client_type,
                String(r.total_tickets),
                String(r.open_tickets),
                String(r.in_progress_tickets),
                String(r.closed_tickets),
                formatHours(r.total_hours),
              ])}
            empty="Nenhum ticket por cliente no período"
          />
          <Pagination
            page={tablePage}
            perPage={perPage}
            total={ticketsClient.length}
            onPage={setTablePage}
          />
        </>
      ) : null}

      {tab === "productivity" ? (
        <>
          <ExportBar onExcel={exportExcel} exporting={exporting} />
          <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line p-5">
            <h3 className="mb-4 font-semibold text-navy">Tickets por dia</h3>
            <MiniBars
              items={fillDaily(prod?.daily_tickets || [], applied.start, applied.end, "count")}
              valueKey="count"
              barClass="bg-brand"
            />
          </div>
          <div className="rounded-2xl border border-line p-5">
            <h3 className="mb-4 font-semibold text-navy">Horas por dia</h3>
            <MiniBars
              items={fillDaily(prod?.daily_hours || [], applied.start, applied.end, "hours")}
              valueKey="hours"
              barClass="bg-done"
              formatValue={(n) => formatHours(n)}
            />
          </div>
        </div>
        </>
      ) : null}

      {tab === "service-performance" ? (
        <>
          <ExportBar onExcel={exportExcel} exporting={exporting} />
          <DataTable
            id="relatorios-servicos"
            loading={isLoading}
            refreshing={isFetching}
            key="service-performance"
            searchPlaceholder="Buscar por serviço…"
            searchValue={tableQ}
            onSearch={setTableQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Serviço: { field: "name" },
              "Taxa/hora": { field: "hourly_rate" },
              Tickets: { field: "tickets_count" },
              Horas: { field: "total_hours" },
              "Média por ticket": { field: "avg_hours_per_ticket" },
              Receita: { field: "total_revenue" },
            }}
            columns={["Serviço", "Taxa/hora", "Tickets", "Horas", "Média por ticket", "Receita"]}
            rows={servicePerf
              .slice((tablePage - 1) * perPage, tablePage * perPage)
              .map((r) => [
                r.name,
                formatBRL(r.hourly_rate),
                String(r.tickets_count),
                formatHours(r.total_hours),
                formatHours(r.avg_hours_per_ticket),
                formatBRL(r.total_revenue),
              ])}
            empty="Nenhum serviço no período"
          />
          <Pagination
            page={tablePage}
            perPage={perPage}
            total={servicePerf.length}
            onPage={setTablePage}
          />
        </>
      ) : null}

      <Modal open={pdfOpen} onClose={() => setPdfOpen(false)} title="Exportar PDF de horas por cliente">
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Cliente</span>
            <select
              value={pdfClient}
              onChange={(e) => setPdfClient(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            >
              <option value="">Selecione…</option>
              {(data?.hours_by_client || []).map((c, i) => (
                <option key={clientKey(c, i)} value={clientKey(c, i)}>
                  {c.client_name} ({c.client_type})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[11px] uppercase tracking-wide text-muted">Tipo</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="pdf-kind"
                checked={pdfKind === "detailed"}
                onChange={() => setPdfKind("detailed")}
              />
              Completo (apontamentos)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="pdf-kind"
                checked={pdfKind === "synthetic"}
                onChange={() => setPdfKind("synthetic")}
              />
              Sintético
            </label>
          </fieldset>
          <PrimaryButton type="button" disabled={!pdfClient || exporting} onClick={() => void exportPdf()}>
            {exporting ? "Gerando…" : "Gerar PDF"}
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
}
