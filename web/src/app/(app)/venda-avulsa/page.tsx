"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, PrimaryRowAction, RowActions } from "@/components/ui/RowActions";
import { NovaVendaAvulsaDialog } from "@/components/vendas/NovaVendaAvulsaDialog";
import { flask } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type Sale = {
  id: number;
  client_name?: string;
  documento?: string;
  valor?: number;
  value?: number;
  total_price?: number;
  status?: string;
  product_name?: string;
};

type Res = { sales?: Sale[]; items?: Sale[]; total?: number; page?: number; per_page?: number };

function statusLabel(s?: string) {
  if (s === "C") return "Cancelada";
  if (s === "A") return "Aberta";
  return s || "—";
}

export default function VendaAvulsaPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();
  useEffect(() => setPage(1), [q, colFilters]);
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["vendas-avulsas", q, page, colQuery],
    queryFn: () =>
      flask.get<Res>(`/tickets/api/vendas-avulsas-list?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`),
    placeholderData: (previousData) => previousData,
  });
  const rows = data?.sales || data?.items || [];

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      flask.post(`/tickets/api/vendas-avulsas/${id}/cancel`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendas-avulsas"] }),
  });

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <PageTitle className="mb-0">Venda avulsa</PageTitle>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
        >
          <Plus className="h-4 w-4" />
          Nova venda
        </button>
      </div>
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      <DataTable
        id="venda-avulsa"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por cliente, documento…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Cliente", "Documento", "Valor", "Status", "Ações"]}
        rows={rows.map((s) => [
          s.client_name || "—",
          s.documento || "—",
          formatBRL(s.valor ?? s.value ?? s.total_price),
          statusLabel(s.status),
          <RowActions key={s.id}>
            <PrimaryRowAction onClick={() => window.open(`/flask/tickets/api/venda-avulsa/imprimir?ids=${s.id}`, "_blank")}>
              <Printer className="h-3.5 w-3.5" />
              Imprimir
            </PrimaryRowAction>
            {s.status !== "C" ? (
              <DeleteAction
                onClick={() => {
                  const reason = window.prompt(`Motivo do cancelamento da venda #${s.id}:`);
                  if (reason && reason.trim()) cancel.mutate({ id: s.id, reason: reason.trim() });
                }}
              />
            ) : null}
          </RowActions>,
        ])}
        empty="Nenhuma venda avulsa encontrada"
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />
      <NovaVendaAvulsaDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ["vendas-avulsas"] })}
      />
    </div>
  );
}
