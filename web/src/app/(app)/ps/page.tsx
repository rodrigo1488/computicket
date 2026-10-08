"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { IconAction, RowActions } from "@/components/ui/RowActions";
import { flask, type PageRes } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type Item = {
  id: string;
  ps_number?: string | null;
  name: string;
  source: string;
  client_name: string;
  technician_name?: string | null;
  issued_at?: string | null;
  value: number;
  path?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

type PsFilters = {
  client: string;
  dateFrom: string;
  dateTo: string;
  valueMin: string;
  valueMax: string;
  sort: string;
};

const EMPTY_FILTERS: PsFilters = {
  client: "",
  dateFrom: "",
  dateTo: "",
  valueMin: "",
  valueMax: "",
  sort: "issued_desc",
};

function psFilterQuery(filters: PsFilters) {
  const params = new URLSearchParams();
  if (filters.client.trim()) params.set("client", filters.client.trim());
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.valueMin.trim()) params.set("value_min", filters.valueMin.trim());
  if (filters.valueMax.trim()) params.set("value_max", filters.valueMax.trim());
  if (filters.sort && filters.sort !== "issued_desc") params.set("sort", filters.sort);
  const query = params.toString();
  return query ? `&${query}` : "";
}

export default function PSPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<PsFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<PsFilters>(EMPTY_FILTERS);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();
  const filterQuery = psFilterQuery(filters);
  useEffect(() => setPage(1), [q, colFilters, filterQuery]);
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["ps", q, page, colQuery, filterQuery],
    queryFn: () =>
      flask.get<PageRes<Item>>(
        `/ps/api/list?q=${encodeURIComponent(q)}&page=${page}&per_page=25${filterQuery}${colQuery}`,
      ),
    placeholderData: (previousData) => previousData,
  });

  const remove = useMutation({
    mutationFn: (path: string) => flask.delete(`/ps/api/delete/${encodeURIComponent(path)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ps"] }),
  });

  return (
    <div>
      <PageTitle>PS</PageTitle>
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      <form
        className="mb-4 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draftFilters);
        }}
      >
        <label className="block text-xs text-muted">
          Cliente
          <input
            value={draftFilters.client}
            onChange={(e) => setDraftFilters((f) => ({ ...f, client: e.target.value }))}
            placeholder="Nome do cliente"
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Emissão de
          <input
            type="date"
            value={draftFilters.dateFrom}
            onChange={(e) => setDraftFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Emissão até
          <input
            type="date"
            value={draftFilters.dateTo}
            onChange={(e) => setDraftFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Valor mínimo
          <input
            inputMode="decimal"
            value={draftFilters.valueMin}
            onChange={(e) => setDraftFilters((f) => ({ ...f, valueMin: e.target.value }))}
            placeholder="0,00"
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Valor máximo
          <input
            inputMode="decimal"
            value={draftFilters.valueMax}
            onChange={(e) => setDraftFilters((f) => ({ ...f, valueMax: e.target.value }))}
            placeholder="0,00"
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Ordenar
          <select
            value={draftFilters.sort}
            onChange={(e) => setDraftFilters((f) => ({ ...f, sort: e.target.value }))}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="issued_desc">Emissão mais recente</option>
            <option value="issued_asc">Emissão mais antiga</option>
            <option value="value_desc">Maior valor</option>
            <option value="value_asc">Menor valor</option>
            <option value="client_asc">Cliente (A–Z)</option>
          </select>
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white">
            Filtrar
          </button>
          <button
            type="button"
            className="h-10 rounded-lg px-4 text-sm text-muted hover:bg-wash"
            onClick={() => {
              setDraftFilters(EMPTY_FILTERS);
              setFilters(EMPTY_FILTERS);
            }}
          >
            Limpar
          </button>
        </div>
      </form>
      <DataTable
        id="ps-v2"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por PS, cliente, técnico ou origem…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{
          Cliente: { field: "client_name" },
          Valor: { field: "value", filter: "number" },
          Técnico: { field: "technician_name" },
          Origem: { field: "source", filter: "select" },
          Emissão: { field: "issued_at", filter: "date" },
          Ações: { sortable: false, filter: false },
        }}
        columns={["PS", "Cliente", "Valor", "Técnico", "Origem", "Emissão", "Ações"]}
        rows={(data?.items || []).map((i) => [
          i.ps_number || i.name,
          i.client_name || "—",
          formatBRL(i.value),
          i.technician_name || "—",
          i.source,
          formatDate(i.issued_at),
          <RowActions key={i.id}>
            {i.path ? (
              <>
                <IconAction
                  label="Visualizar"
                  icon={Eye}
                  onClick={() => void flask.open(`/ps/api/view/${encodeURIComponent(i.path!)}`)}
                />
                <IconAction
                  label="Baixar"
                  icon={Download}
                  onClick={() => void flask.download(`/ps/api/download/${encodeURIComponent(i.path!)}`)}
                />
                <IconAction
                  label="Excluir"
                  icon={Trash2}
                  danger
                  onClick={() => {
                    if (window.confirm(`Excluir ${i.name}?`)) remove.mutate(i.path || "");
                  }}
                />
              </>
            ) : (
              <span className="text-xs text-muted" title="PDF não encontrado em /app/ps">
                Sem PDF
              </span>
            )}
          </RowActions>,
        ])}
        empty="Nenhuma PS encontrada"
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />
    </div>
  );
}
