"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable, Kpi } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EditAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { useColFilters } from "@/lib/use-col-filters";

type Sys = {
  id: number;
  name: string;
  description: string;
  version?: string;
  company?: string;
  is_active: boolean;
  plans_count: number;
};
type Plans = {
  total_plans: number;
  active_client_plans: number;
  items?: Sys[];
  systems?: Sys[];
  total?: number;
  page?: number;
  per_page?: number;
};

export default function PlanosPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Sys | null>(null);
  const [view, setView] = useState<Sys | null>(null);
  const [form, setForm] = useState({ name: "", description: "", version: "", company: "", is_active: true });
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["plans", q, page, colQuery],
    queryFn: () => flask.get<Plans>(`/api/web/plans?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`),
    placeholderData: (previousData) => previousData,
  });
  const systems = data?.items || data?.systems || [];

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Nenhum sistema");
      return flask.patch(`/api/web/plans/systems/${edit.id}`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  return (
    <div>
      <PageTitle>Planos</PageTitle>
      <div className="mb-8 grid grid-cols-2 gap-4">
        <Kpi label="Planos ativos" value={data?.total_plans ?? 0} />
        <Kpi label="Clientes com plano" value={data?.active_client_plans ?? 0} />
      </div>
      <DataTable
        id="planos"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por sistema, descrição…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columns={["Sistema", "Descrição", "Planos", "Ações"]}
        rows={systems.map((s) => [
          s.name,
          s.description || "—",
          String(s.plans_count),
          <RowActions key={s.id}>
            <ViewAction onClick={() => setView(s)} />
            <EditAction
              onClick={() => {
                setForm({
                  name: s.name,
                  description: s.description || "",
                  version: s.version || "",
                  company: s.company || "",
                  is_active: s.is_active,
                });
                setFormError("");
                setEdit(s);
              }}
            />
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || systems.length} onPage={setPage} />

      <Modal open={!!view} onClose={() => setView(null)} title={view?.name || "Sistema"}>
        {view ? (
          <div className="space-y-2 text-sm">
            <p>{view.description || "—"}</p>
            <p className="text-muted">
              {view.plans_count} plano(s) · {view.is_active ? "Ativo" : "Inativo"}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Editar sistema" wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <UnderlineField
            label="Descrição"
            value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
          />
          <UnderlineField label="Versão" value={form.version} onChange={(v) => setForm((f) => ({ ...f, version: v }))} />
          <UnderlineField label="Empresa" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Sistema ativo
          </label>
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
