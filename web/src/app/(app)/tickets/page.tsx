"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hand, Play, Plus, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { TicketCreateDialog } from "@/components/tickets/TicketCreateDialog";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { IconAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { flask, type PageRes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";
import { formatBRL, type TicketCard as TicketRow, type TicketStatus } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type UserOpt = { id: number; name: string };

const STATUS_PILLS: { value: string; label: string }[] = [
  { value: "aberto", label: "Aberto" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "fechado", label: "Fechado" },
  { value: "cancelado", label: "Cancelado" },
  { value: "all", label: "Todos" },
];

function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") u.set(k, String(v));
  });
  return u.toString();
}

export default function TicketsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  const [status, setStatus] = useState("aberto");
  const [assigned, setAssigned] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [status, assigned, q, dateFrom, dateTo, colFilters]);

  const users = useQuery({
    queryKey: ["users-ticket-filter"],
    queryFn: () => flask.get<PageRes<UserOpt>>("/api/web/users?status=1&per_page=100"),
  });

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["tickets", status, assigned, q, dateFrom, dateTo, page, colQuery],
    queryFn: () =>
      flask.get<PageRes<TicketRow>>(
        `/tickets/api/list?${qs({
          status,
          assigned_to_id: assigned || undefined,
          q: q || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          page,
          per_page: 20,
        })}${colQuery}`,
      ),
    placeholderData: (previousData) => previousData,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["tickets-stale-count"] });
  };
  const onErr = (e: Error) => setErr(e.message);

  const start = useMutation({
    mutationFn: (id: number) => flask.post(`/tickets/api/${id}/start`),
    onSuccess: invalidate,
    onError: onErr,
  });
  const stop = useMutation({
    mutationFn: (id: number) => flask.post(`/tickets/api/${id}/stop`),
    onSuccess: invalidate,
    onError: onErr,
  });
  const assume = useMutation({
    mutationFn: (id: number) => flask.post(`/tickets/api/${id}/assume`),
    onSuccess: invalidate,
    onError: onErr,
  });
  const busy = start.isPending || stop.isPending || assume.isPending;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-0">Tickets</PageTitle>
          <p className="mt-1 text-sm text-muted">Gerencie os chamados de suporte técnico</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          Abrir ticket
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_PILLS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setStatus(p.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              status === p.value ? "bg-ink text-white" : "bg-[#f3f4f6] text-ink hover:bg-[#e5e7eb]",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Técnico</span>
          <select
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
            className="w-full rounded-xl border border-[#eee] bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {(users.data?.items || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Data inicial</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded-xl border border-[#eee] px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Data final</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-xl border border-[#eee] px-3 py-2 text-sm"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded-xl border border-[#eee] px-3 py-2 text-sm text-muted hover:bg-[#f5f5f5]"
          >
            Limpar datas
          </button>
        </div>
      </div>

      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      {err ? <p className="mb-4 text-sm text-open">{err}</p> : null}

      <DataTable
        id="tickets"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por título ou cliente…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{
          Status: { filter: "select" },
          Técnico: { field: "technician_name" },
          Solicitante: { field: "solicitante" },
          Criado: { field: "created_at" },
          Ações: { sortable: false, filter: false },
        }}
        columns={[
          "#",
          "Título",
          "Cliente",
          "Solicitante",
          "Serviço",
          "Técnico",
          "Status",
          "Horas",
          "Valor",
          "Criado",
          "Ações",
        ]}
        empty="Nenhum ticket neste filtro"
        rows={(data?.items || []).map((t) => {
          const mine = t.assigned_to_id === uid;
          const closed = t.status === "fechado" || t.status === "cancelado";
          return [
            `#${t.id}`,
            <div key={`t-${t.id}`}>
              <Link href={`/tickets/${t.id}`} className="font-medium text-navy hover:underline">
                {t.title}
              </Link>
              {t.description ? (
                <p className="truncate text-xs text-muted">{t.description.slice(0, 60)}</p>
              ) : null}
            </div>,
            t.client_name || "—",
            t.solicitante || "—",
            t.category,
            t.assigned_to_name || "—",
            <StatusBadge key={`s-${t.id}`} status={t.status as TicketStatus} />,
            t.hours_label || "0min",
            t.status === "fechado" ? formatBRL(t.total_cost) : "—",
            t.created_at || "—",
            <RowActions key={`a-${t.id}`}>
              <ViewAction href={`/tickets/${t.id}`} />
              {!closed && mine && t.status === "aberto" ? (
                <IconAction
                  label="Iniciar"
                  icon={Play}
                  disabled={busy}
                  onClick={() => start.mutate(t.id)}
                />
              ) : null}
              {!closed && mine && t.status === "em_andamento" ? (
                <IconAction
                  label="Encerrar sessão"
                  icon={Square}
                  disabled={busy}
                  onClick={() => stop.mutate(t.id)}
                />
              ) : null}
              {!closed && !mine ? (
                <IconAction
                  label="Assumir"
                  icon={Hand}
                  disabled={busy}
                  onClick={() => assume.mutate(t.id)}
                />
              ) : null}
            </RowActions>,
          ];
        })}
      />
      <Pagination
        page={data?.page || page}
        perPage={data?.per_page || 20}
        total={data?.total || 0}
        onPage={setPage}
      />
      <TicketCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["tickets"] });
        }}
      />
    </div>
  );
}
