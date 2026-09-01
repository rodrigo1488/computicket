"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Link2, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, IconAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { flask, type PageRes } from "@/lib/api";
import { exportBudgetPdf, generateBudgetPublicLink } from "@/lib/budget-share";
import { formatBRL } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type B = {
  id: number;
  title: string;
  status: string;
  client_name: string;
  updated_at: string | null;
  total?: number;
  public_token?: string;
  has_file?: boolean;
  items_count?: number;
};

function budgetStatus(s?: string) {
  if (s === "draft") return "Rascunho";
  if (s === "sent") return "Enviado";
  if (s === "approved") return "Aprovado";
  if (s === "rejected") return "Rejeitado";
  return s || "—";
}

export default function OrcamentosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["budgets", q, page, colQuery],
    queryFn: () => flask.get<PageRes<B>>(`/api/web/budgets?q=${encodeURIComponent(q)}&page=${page}&per_page=12${colQuery}`),
    placeholderData: (previousData) => previousData,
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/budgets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }),
  });

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Orçamentos</PageTitle>
          <p className="text-sm text-muted">Gerencie orçamentos e propostas comerciais</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push("/orcamentos/novo?ia=1")}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-wash"
          >
            <Sparkles className="h-4 w-4" />
            Gerar com IA
          </button>
          <button
            type="button"
            onClick={() => router.push("/orcamentos/novo")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
          >
            <Plus className="h-4 w-4" />
            Novo orçamento
          </button>
        </div>
      </div>
      <DataTable
        id="orcamentos"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por título, cliente, status…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Título", "Cliente", "Status", "Total", "Atualizado", "Ações"]}
        rows={(data?.items || []).map((b) => [
          b.title,
          b.client_name || "—",
          budgetStatus(b.status),
          formatBRL(b.total),
          b.updated_at || "—",
          <RowActions key={b.id}>
            <ViewAction href={`/orcamentos/${b.id}`} />
            <EditAction href={`/orcamentos/${b.id}/editar`} />
            <IconAction
              label="Exportar PDF"
              icon={FileDown}
              onClick={() => {
                void exportBudgetPdf(b.id).catch((e) =>
                  window.alert(e instanceof Error ? e.message : "Erro ao exportar PDF"),
                );
              }}
            />
            <IconAction
              label={b.public_token ? "Copiar link público" : "Gerar link público"}
              icon={Link2}
              onClick={() => {
                void generateBudgetPublicLink(b.id, b.public_token || "")
                  .then(() => qc.invalidateQueries({ queryKey: ["budgets"] }))
                  .catch((e) => window.alert(e instanceof Error ? e.message : "Erro ao gerar link"));
              }}
            />
            <DeleteAction
              onClick={() => {
                if (window.confirm(`Excluir o orçamento ${b.title}?`)) remove.mutate(b.id);
              }}
            />
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 12} total={data?.total || 0} onPage={setPage} />
    </div>
  );
}
