"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EditAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useColFilters } from "@/lib/use-col-filters";

type Service = { id?: number; name?: string; hourly_rate?: number };
type Contract = {
  name?: string;
  contract_name?: string;
  tipo?: string;
  services?: Service[];
  services_count?: number;
  clients_count?: number;
  status?: string;
};
type ContractClient = { id: number; name: string; document?: string; phone?: string };

export default function ContratosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [clientsOf, setClientsOf] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["contracts", q, page, colQuery],
    queryFn: () =>
      flask.get<PageRes<Contract> & { error?: string }>(
        `/api/web/contracts?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`,
      ),
    placeholderData: (previousData) => previousData,
  });
  const items = data?.items || [];

  const clientsQuery = useQuery({
    queryKey: ["contract-clients", clientsOf],
    queryFn: () =>
      flask.get<{ clients?: ContractClient[]; error?: string }>(
        `/contratos/${encodeURIComponent(clientsOf || "")}/clients`,
      ),
    enabled: !!clientsOf,
  });

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Nenhum contrato selecionado");
      if (!newName.trim()) throw new Error("Nome é obrigatório");
      return flask.patch(`/api/web/contracts/${encodeURIComponent(edit)}`, { name: newName.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  return (
    <div>
      <PageTitle>Contratos</PageTitle>
      {error ? (
        <p className="mb-4 text-sm text-open">
          Não foi possível listar os contratos. {(error as Error).message}
        </p>
      ) : (
        <>
          <DataTable
            id="contratos"
            loading={isLoading}
            refreshing={isFetching}
            searchPlaceholder="Buscar por contrato…"
            searchValue={q}
            onSearch={setQ}
            onFiltersChange={onFiltersChange}
            columnMeta={{
              Contrato: { field: "name" },
              Clientes: { field: "clients_count" },
              Serviços: { field: "services_count" },
              Status: { filter: "select" },
              Ações: { sortable: false, filter: false },
            }}
            columns={["Contrato", "Clientes", "Serviços", "Status", "Ações"]}
            rows={items.map((c) => {
              const name = String(c.name || c.contract_name || c.tipo || "—");
              const services = c.services || [];
              const servicesLabel =
                c.services_count != null
                  ? `${c.services_count} serviço(s)`
                  : services.length
                    ? services.map((s) => s.name).filter(Boolean).join(", ")
                    : "Nenhum";
              return [
                name,
                String(c.clients_count ?? "—"),
                servicesLabel,
                c.status || "Ativo",
                <RowActions key={name}>
                  <ViewAction onClick={() => setClientsOf(name)} />
                  {isAdmin ? (
                    <EditAction
                      onClick={() => {
                        setNewName(name);
                        setFormError("");
                        setEdit(name);
                      }}
                    />
                  ) : null}
                </RowActions>,
              ];
            })}
            empty="Nenhum contrato cadastrado no PostgreSQL"
          />
          <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />
        </>
      )}

      <Modal open={!!clientsOf} onClose={() => setClientsOf(null)} title={`Clientes · ${clientsOf || ""}`} wide>
        {clientsQuery.isLoading ? <p className="text-sm text-muted">Carregando…</p> : null}
        <ul className="space-y-2">
          {(clientsQuery.data?.clients || []).map((cl) => (
            <li key={cl.id} className="rounded-xl border border-line px-4 py-3 text-sm">
              <p className="font-medium text-ink">{cl.name}</p>
              <p className="text-xs text-muted">{[cl.document, cl.phone].filter(Boolean).join(" · ") || "—"}</p>
            </li>
          ))}
        </ul>
        {!clientsQuery.isLoading && !(clientsQuery.data?.clients || []).length ? (
          <p className="text-sm text-muted">Nenhum cliente neste contrato</p>
        ) : null}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Editar contrato">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Nome do contrato" value={newName} onChange={setNewName} />
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
