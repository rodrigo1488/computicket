"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import { useColFilters } from "@/lib/use-col-filters";

type Item = {
  id: number;
  title: string;
  description?: string;
  serial_number?: string;
  status: string;
  status_label: string;
  public_uuid: string;
};

const STATUSES = [
  { value: "disponivel", label: "Disponível" },
  { value: "emprestado", label: "Emprestado" },
  { value: "vendido", label: "Vendido" },
  { value: "descartado", label: "Descartado" },
];

const EMPTY_FORM = { title: "", description: "", serial_number: "", status: "disponivel" };

export default function InventarioPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Item | "new" | null>(null);
  const [view, setView] = useState<Item | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["inventory", q, page, colQuery],
    queryFn: () =>
      flask.get<PageRes<Item>>(`/api/web/inventory?q=${encodeURIComponent(q)}&page=${page}&per_page=20${colQuery}`),
    placeholderData: (previousData) => previousData,
  });

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Nenhum item");
      if (!form.description.trim()) throw new Error("A descrição é obrigatória");
      if (edit === "new") return flask.post("/api/web/inventory", form);
      return flask.patch(`/api/web/inventory/${edit.id}`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/inventory/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError("");
    setEdit("new");
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <PageTitle className="mb-0">Inventário</PageTitle>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
        >
          <Plus className="h-4 w-4" />
          Novo item
        </button>
      </div>
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      {remove.error ? <p className="mb-4 text-sm text-open">{(remove.error as Error).message}</p> : null}
      <DataTable
        id="inventario"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por título, serial ou UUID…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Item", "Serial", "Status", "UUID", "Ações"]}
        rows={(data?.items || []).map((i) => [
          i.title || i.description || "—",
          i.serial_number || "—",
          i.status_label,
          i.public_uuid,
          <RowActions key={i.id}>
            <ViewAction onClick={() => setView(i)} />
            <EditAction
              onClick={() => {
                setForm({
                  title: i.title || "",
                  description: i.description || "",
                  serial_number: i.serial_number || "",
                  status: i.status || "disponivel",
                });
                setFormError("");
                setEdit(i);
              }}
            />
            <DeleteAction
              onClick={() => {
                if (window.confirm(`Excluir ${i.title}?`)) remove.mutate(i.id);
              }}
            />
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 20} total={data?.total || 0} onPage={setPage} />

      <Modal open={!!view} onClose={() => setView(null)} title={view?.title || "Item"} wide>
        {view ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted">Serial</span>
              <br />
              {view.serial_number || "—"}
            </p>
            <p>
              <span className="text-muted">Status</span>
              <br />
              {view.status_label}
            </p>
            <p>
              <span className="text-muted">UUID</span>
              <br />
              <code className="text-xs">{view.public_uuid}</code>
            </p>
            <p>
              <span className="text-muted">Descrição</span>
              <br />
              {view.description || "—"}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Novo item" : "Editar item"} wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Título" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Descrição</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={4}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            />
          </label>
          <UnderlineField
            label="Número de série"
            value={form.serial_number}
            onChange={(v) => setForm((f) => ({ ...f, serial_number: v }))}
          />
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
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
