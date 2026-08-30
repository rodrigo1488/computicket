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
  issued_at?: string | null;
  value: number;
  path?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

export default function PSPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();
  useEffect(() => setPage(1), [q, colFilters]);
  const { data, error } = useQuery({
    queryKey: ["ps", q, page, colQuery],
    queryFn: () => flask.get<PageRes<Item>>(`/ps/api/list?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`),
  });

  const remove = useMutation({
    mutationFn: (path: string) => flask.delete(`/ps/api/delete/${encodeURIComponent(path)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ps"] }),
  });

  return (
    <div>
      <PageTitle>PS</PageTitle>
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      <DataTable
        id="ps"
        searchPlaceholder="Buscar por PS, cliente ou origem…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columns={["PS", "Origem", "Cliente", "Emissão", "Valor", "Arquivo"]}
        rows={(data?.items || []).map((i) => [
          i.ps_number || i.name,
          i.source,
          i.client_name || "—",
          formatDate(i.issued_at),
          formatBRL(i.value),
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
              "—"
            )}
          </RowActions>,
        ])}
        empty="Nenhuma PS encontrada"
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />
    </div>
  );
}
