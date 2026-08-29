"use client";

import { Key } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable, Kpi } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { PrimaryRowAction, RowActions } from "@/components/ui/RowActions";
import { flask, type PageRes } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useColFilters } from "@/lib/use-col-filters";

type VaultClient = {
  id: number;
  name: string;
  phone?: string;
  document?: string;
  is_external: boolean;
  origin: string;
  passwords_count: number;
};

type VaultRes = PageRes<VaultClient> & {
  stats?: { total_clients: number; total_passwords: number; clients_with_passwords: number };
};

function clientHref(c: VaultClient) {
  return c.is_external ? `/cofre/${c.id}?external=1` : `/cofre/${c.id}`;
}

export default function CofrePage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [withPasswords, setWithPasswords] = useState(false);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters, withPasswords]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["vault-clients", q, page, colQuery, withPasswords],
    queryFn: () =>
      flask.get<VaultRes>(
        `/api/web/vault?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}${
          withPasswords ? "&with_passwords=true" : ""
        }`,
      ),
  });

  return (
    <div>
      <PageTitle>Cofre de senhas</PageTitle>
      <p className="mb-6 -mt-5 text-sm text-muted">Gerencie as credenciais de acesso às máquinas dos clientes</p>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Total de clientes" value={data?.stats?.total_clients ?? "—"} tone="brand" />
        <Kpi label="Total de senhas" value={data?.stats?.total_passwords ?? "—"} tone="done" />
        <Kpi label="Clientes com senhas" value={data?.stats?.clients_with_passwords ?? "—"} />
      </div>

      <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={withPasswords}
          onChange={(e) => setWithPasswords(e.target.checked)}
          className="accent-brand"
        />
        Mostrar apenas clientes com senhas salvas
      </label>

      {isLoading ? <p className="mb-4 text-sm text-muted">Carregando clientes…</p> : null}
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      <DataTable
        id="cofre-clientes"
        searchPlaceholder="Buscar por nome, telefone ou documento…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{
          Origem: { filter: "select" },
          Ações: { sortable: false, filter: false },
        }}
        columns={["Nome", "Telefone", "Documento", "Senhas", "Origem", "Ações"]}
        empty="Nenhum cliente encontrado"
        rows={(data?.items || []).map((c) => [
          c.name,
          c.phone || "—",
          c.document || "—",
          String(c.passwords_count ?? 0),
          c.origin || (c.is_external ? "Externo" : "Interno"),
          <RowActions key={`${c.is_external ? "e" : "i"}-${c.id}`}>
            <PrimaryRowAction href={clientHref(c)}>
              <Key className="h-3.5 w-3.5" />
              Ver senhas
            </PrimaryRowAction>
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />
    </div>
  );
}
