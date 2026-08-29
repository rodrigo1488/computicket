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
import { useColFilters } from "@/lib/use-col-filters";

type Client = {
  id: number;
  name: string;
  phone?: string;
  document?: string;
  email?: string;
  contract_type?: string;
  address?: string;
  address_number?: string;
  notes?: string;
};

export default function ClientesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<Client | null>(null);
  const [edit, setEdit] = useState<Client | null>(null);
  const [form, setForm] = useState({ name: "", document: "", phone: "", email: "", address: "", address_number: "", notes: "" });
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["clients-page", q, page, colQuery],
    queryFn: () =>
      flask.get<PageRes<Client>>(`/api/web/clients?q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Nenhum cliente selecionado");
      if (!form.name.trim()) throw new Error("Nome é obrigatório");
      return flask.patch<Client>(`/api/web/clients/${edit.id}`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients-page"] });
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const openEdit = (c: Client) => {
    setForm({
      name: c.name || "",
      document: c.document || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      address_number: c.address_number || "",
      notes: c.notes || "",
    });
    setFormError("");
    setEdit(c);
  };

  return (
    <div>
      <PageTitle>Clientes</PageTitle>
      {isLoading ? <p className="mb-4 text-sm text-muted">Carregando clientes…</p> : null}
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      <DataTable
        id="clientes"
        searchPlaceholder="Buscar por nome, documento…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columns={["Nome", "Documento", "Telefone", "Contrato", "Ações"]}
        rows={(data?.items || []).map((c) => [
          c.name,
          c.document || "—",
          c.phone || "—",
          c.contract_type || "—",
          <RowActions key={c.id}>
            <ViewAction onClick={() => setView(c)} />
            <EditAction onClick={() => openEdit(c)} />
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 25} total={data?.total || 0} onPage={setPage} />

      <Modal open={!!view} onClose={() => setView(null)} title="Detalhes do cliente" wide>
        {view ? (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <p>
              <span className="text-muted">Nome</span>
              <br />
              <strong>{view.name}</strong>
            </p>
            <p>
              <span className="text-muted">Documento</span>
              <br />
              {view.document || "—"}
            </p>
            <p>
              <span className="text-muted">Telefone</span>
              <br />
              {view.phone || "—"}
            </p>
            <p>
              <span className="text-muted">E-mail</span>
              <br />
              {view.email || "—"}
            </p>
            <p className="md:col-span-2">
              <span className="text-muted">Contrato</span>
              <br />
              {view.contract_type || "—"}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Editar cliente" wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <UnderlineField label="Documento" value={form.document} onChange={(v) => setForm((f) => ({ ...f, document: v }))} />
          <UnderlineField label="Telefone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
          <UnderlineField label="E-mail" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <UnderlineField label="Endereço" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          <UnderlineField label="Número" value={form.address_number} onChange={(v) => setForm((f) => ({ ...f, address_number: v }))} />
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
