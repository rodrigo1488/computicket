"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { IconAction, RowActions } from "@/components/ui/RowActions";
import { flask, type PageRes } from "@/lib/api";
import { useColFilters } from "@/lib/use-col-filters";

type Item = { name: string; type: string; path?: string };

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
        searchPlaceholder="Buscar por nome de arquivo…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columns={["Nome", "Tipo", "Ações"]}
        rows={(data?.items || []).map((i) => [
          i.name,
          i.type,
          <RowActions key={i.path || i.name}>
            {i.path && i.type !== "folder" ? (
              <>
                <IconAction
                  label="Visualizar"
                  icon={Eye}
                  onClick={() => window.open(`/flask/ps/api/view/${encodeURIComponent(i.path || "")}`, "_blank")}
                />
                <IconAction
                  label="Baixar"
                  icon={Download}
                  onClick={() => window.open(`/flask/ps/api/download/${encodeURIComponent(i.path || "")}`, "_blank")}
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
        empty="Nenhum arquivo de PS"
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />
    </div>
  );
}
