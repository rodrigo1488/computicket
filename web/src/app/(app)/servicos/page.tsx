"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EditAction, RowActions } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type S = { id: number; name: string; description: string; hourly_rate: number };

export default function ServicosPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<S | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", hourly_rate: "" });
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data } = useQuery({
    queryKey: ["services", q, page, colQuery],
    queryFn: () =>
      flask.get<PageRes<S>>(`/api/web/services?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        hourly_rate: Number(form.hourly_rate.replace(",", ".")) || 0,
      };
      if (!payload.name) throw new Error("Nome é obrigatório");
      if (creating) return flask.post("/api/web/services", payload);
      if (!edit) throw new Error("Nenhum serviço selecionado");
      return flask.patch(`/api/web/services/${edit.id}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      setEdit(null);
      setCreating(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <PageTitle className="mb-0">Serviços</PageTitle>
        <button
          type="button"
          onClick={() => {
            setForm({ name: "", description: "", hourly_rate: "" });
            setFormError("");
            setCreating(true);
            setEdit(null);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          Novo serviço
        </button>
      </div>
      <DataTable
        id="servicos"
        searchPlaceholder="Buscar por nome, descrição…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columns={["Nome", "Descrição", "Valor hora", "Ações"]}
        rows={(data?.items || []).map((s) => [
          s.name,
          s.description || "—",
          formatBRL(s.hourly_rate),
          <RowActions key={s.id}>
            <EditAction
              onClick={() => {
                setForm({ name: s.name, description: s.description || "", hourly_rate: String(s.hourly_rate ?? "") });
                setFormError("");
                setCreating(false);
                setEdit(s);
              }}
            />
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />

      <Modal
        open={!!edit || creating}
        onClose={() => {
          setEdit(null);
          setCreating(false);
        }}
        title={creating ? "Novo serviço" : "Editar serviço"}
      >
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
          <UnderlineField
            label="Valor hora (R$)"
            value={form.hourly_rate}
            onChange={(v) => setForm((f) => ({ ...f, hourly_rate: v }))}
            placeholder="0,00"
          />
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
