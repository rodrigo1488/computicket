"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, PrimaryRowAction, RowActions } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useColFilters } from "@/lib/use-col-filters";

type U = { id: number; name: string; email: string; role: string; team?: string; status: string };

const emptyForm = { name: "", email: "", role: "tecnico", team: "Equipe 1", password: "" };

export default function UsuariosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<U | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data } = useQuery({
    queryKey: ["users", q, page, colQuery],
    queryFn: () => flask.get<PageRes<U>>(`/api/web/users?q=${encodeURIComponent(q)}&status=all&page=${page}&per_page=25${colQuery}`),
  });

  const save = useMutation({
    mutationFn: () => {
      if (creating) {
        if (!form.name.trim() || !form.email.trim() || !form.password) {
          throw new Error("Nome, e-mail e senha são obrigatórios.");
        }
        return flask.post("/api/web/users", form);
      }
      if (!edit) throw new Error("Nenhum usuário selecionado");
      return flask.patch(`/api/web/users/${edit.id}`, {
        name: form.name,
        email: form.email,
        role: form.role,
        team: form.team,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEdit(null);
      setCreating(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const toggle = useMutation({
    mutationFn: (id: number) => flask.post(`/api/web/users/${id}/toggle-status`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const openCreate = () => {
    setForm(emptyForm);
    setFormError("");
    setCreating(true);
    setEdit(null);
  };

  const openEdit = (u: U) => {
    setForm({ name: u.name, email: u.email, role: u.role, team: u.team || "Equipe 1", password: "" });
    setFormError("");
    setCreating(false);
    setEdit(u);
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <PageTitle className="mb-0">Usuários</PageTitle>
        {isAdmin ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            Novo usuário
          </button>
        ) : null}
      </div>
      <DataTable
        id="usuarios"
        searchPlaceholder="Buscar por nome, e-mail…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Nome", "E-mail", "Perfil", "Equipe", "Status", "Ações"]}
        rows={(data?.items || []).map((u) => [
          u.name,
          u.email,
          u.role,
          u.team || "—",
          u.status === "1" ? "Ativo" : "Inativo",
          <RowActions key={u.id}>
            <EditAction onClick={() => openEdit(u)} />
            {isAdmin && u.id !== user?.id ? (
              <PrimaryRowAction onClick={() => toggle.mutate(u.id)}>
                <Ban className="h-3.5 w-3.5" />
                {u.status === "1" ? "Inativar" : "Ativar"}
              </PrimaryRowAction>
            ) : null}
            {isAdmin && u.id !== user?.id ? (
              <DeleteAction
                onClick={() => {
                  if (window.confirm(`Excluir o usuário ${u.name}?`)) remove.mutate(u.id);
                }}
              />
            ) : null}
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
        title={creating ? "Novo usuário" : "Editar usuário"}
        wide
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <UnderlineField label="E-mail" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          {creating ? (
            <UnderlineField
              label="Senha"
              type="password"
              value={form.password}
              onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            />
          ) : (
            <p className="text-xs text-muted">A senha não é alterada nesta tela.</p>
          )}
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Função</span>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="admin">Administrador</option>
              <option value="tecnico">Técnico</option>
              <option value="viewer">Visualizador</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Equipe</span>
            <select
              value={form.team}
              onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))}
              className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="Equipe 1">Equipe 1</option>
              <option value="Equipe 2">Equipe 2</option>
              <option value="Fora Rotação">Fora Rotação</option>
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
