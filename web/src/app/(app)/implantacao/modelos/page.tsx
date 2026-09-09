"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { ModelForm } from "@/components/implantacao/ModelForm";
import type { ImplantationModel, ImplantationSystem } from "@/components/implantacao/types";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { flask, type PageRes } from "@/lib/api";

export default function ImplantacaoModelosPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [systemId, setSystemId] = useState("");
  const [editing, setEditing] = useState<ImplantationModel | null | undefined>(undefined);
  const [view, setView] = useState<ImplantationModel | null>(null);
  const [formError, setFormError] = useState("");

  useEffect(() => setPage(1), [q, systemId]);

  const systems = useQuery({
    queryKey: ["implantacao-systems"],
    queryFn: () => flask.get<{ items: ImplantationSystem[] }>("/api/implantacao/systems?active=0"),
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["implantacao-models", q, page, systemId],
    queryFn: () => {
      const params = new URLSearchParams({ q, page: String(page), per_page: "25" });
      if (systemId) params.set("system_id", systemId);
      return flask.get<PageRes<ImplantationModel>>(`/api/implantacao/models?${params}`);
    },
    placeholderData: (previousData) => previousData,
  });

  const viewQuery = useQuery({
    queryKey: ["implantacao-models", view?.id],
    queryFn: () => flask.get<ImplantationModel>(`/api/implantacao/models/${view?.id}`),
    enabled: view != null,
  });

  const editQuery = useQuery({
    queryKey: ["implantacao-models", "edit", editing?.id],
    queryFn: () => flask.get<ImplantationModel>(`/api/implantacao/models/${editing?.id}`),
    enabled: !!editing?.id,
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/implantacao/models/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["implantacao-models"] }),
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao excluir"),
  });

  const items = data?.items || [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-0">Modelos de implantação</PageTitle>
          <p className="mt-1 text-sm text-muted">Cadastre sistema, modelo e os passos com prazo de cada etapa.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/implantacao"
            className="inline-flex h-10 items-center rounded-xl bg-wash px-4 text-sm font-medium text-ink hover:bg-line"
          >
            Ver Kanban
          </Link>
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setEditing(null);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
          >
            <Plus className="h-4 w-4" />
            Novo modelo
          </button>
        </div>
      </div>

      <div className="mb-5 max-w-xs">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Sistema</span>
          <select
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm text-ink"
          >
            <option value="">Todos</option>
            {(systems.data?.items || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {formError ? <p className="mb-4 text-sm text-open">{formError}</p> : null}

      <DataTable
        id="implantacao-modelos"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar modelo ou sistema…"
        searchValue={q}
        onSearch={setQ}
        columns={["Modelo", "Sistema", "Passos", "Em andamento", "Status", "Ações"]}
        rows={items.map((m) => [
          m.name,
          m.system_name || "—",
          String(m.steps_count),
          String(m.active_count),
          m.is_active ? "Ativo" : "Inativo",
          <RowActions key={m.id}>
            <ViewAction onClick={() => setView(m)} />
            <EditAction
              onClick={() => {
                setFormError("");
                setEditing(m);
              }}
            />
            <DeleteAction
              onClick={() => {
                if (window.confirm(`Excluir o modelo ${m.name}?`)) remove.mutate(m.id);
              }}
            />
          </RowActions>,
        ])}
      />
      <Pagination
        page={data?.page || page}
        perPage={data?.per_page || 25}
        total={data?.total || 0}
        onPage={setPage}
      />

      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing?.id ? "Editar modelo" : "Novo modelo"}
        wide
      >
        {editing?.id && editQuery.isLoading ? (
          <p className="text-sm text-muted">Carregando passos…</p>
        ) : (
          <ModelForm
            initial={editing?.id ? editQuery.data || editing : null}
            onSaved={() => setEditing(undefined)}
          />
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={viewQuery.data?.name || view?.name || "Modelo"} wide>
        {viewQuery.isLoading ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : viewQuery.data ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              {viewQuery.data.system_name} · {viewQuery.data.is_active ? "Ativo" : "Inativo"}
            </p>
            {viewQuery.data.description ? <p className="text-ink">{viewQuery.data.description}</p> : null}
            <ul className="space-y-2">
              {(viewQuery.data.steps || []).map((step, i) => (
                <li key={step.id} className="rounded-xl border border-line px-3 py-2">
                  <p className="font-medium text-ink">
                    {i + 1}. {step.name}
                  </p>
                  <p className="text-xs text-muted">Prazo: {step.duration_label}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
