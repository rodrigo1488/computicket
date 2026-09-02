"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, PrimaryRowAction, RowActions } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { flask, type PageRes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useColFilters } from "@/lib/use-col-filters";

type U = {
  id: number;
  name: string;
  email: string;
  role: string;
  team?: string;
  status: string;
  phone?: string;
  avatar_url?: string | null;
};

const emptyForm = { name: "", email: "", role: "tecnico", team: "Equipe 1", password: "", phone: "" };

export default function UsuariosPage() {
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<U | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["users", q, page, colQuery],
    queryFn: () => flask.get<PageRes<U>>(`/api/web/users?q=${encodeURIComponent(q)}&status=all&page=${page}&per_page=25${colQuery}`),
    placeholderData: (previousData) => previousData,
  });

  const uploadAvatar = async (userId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const updated = await flask.post<U>(`/api/web/users/${userId}/avatar`, fd);
    if (userId === user?.id) await refresh();
    return updated;
  };

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        if (!form.name.trim() || !form.email.trim() || !form.password) {
          throw new Error("Nome, e-mail e senha são obrigatórios.");
        }
        const created = await flask.post<U>("/api/web/users", form);
        if (pendingAvatar) {
          await uploadAvatar(created.id, pendingAvatar);
        }
        return created;
      }
      if (!edit) throw new Error("Nenhum usuário selecionado");
      return flask.patch<U>(`/api/web/users/${edit.id}`, {
        name: form.name,
        email: form.email,
        role: form.role,
        team: form.team,
        phone: form.phone,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEdit(null);
      setCreating(false);
      setPendingAvatar(null);
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
    setPendingAvatar(null);
    setCreating(true);
    setEdit(null);
  };

  const openEdit = (u: U) => {
    setForm({ name: u.name, email: u.email, role: u.role, team: u.team || "Equipe 1", password: "", phone: u.phone || "" });
    setFormError("");
    setPendingAvatar(null);
    setCreating(false);
    setEdit(u);
  };

  const onPickAvatar = async (file: File) => {
    if (creating) {
      setPendingAvatar(file);
      return;
    }
    if (!edit) return;
    setAvatarBusy(true);
    try {
      const updated = await uploadAvatar(edit.id, file);
      setEdit(updated);
      qc.invalidateQueries({ queryKey: ["users"] });
    } finally {
      setAvatarBusy(false);
    }
  };

  const onRemoveAvatar = async () => {
    if (creating) {
      setPendingAvatar(null);
      return;
    }
    if (!edit) return;
    setAvatarBusy(true);
    try {
      const updated = await flask.delete<U>(`/api/web/users/${edit.id}/avatar`);
      setEdit(updated);
      if (edit.id === user?.id) await refresh();
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao remover a foto");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <PageTitle className="mb-0">Usuários</PageTitle>
        {isAdmin ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
          >
            <Plus className="h-4 w-4" />
            Novo usuário
          </button>
        ) : null}
      </div>
      <DataTable
        id="usuarios"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por nome, e-mail…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Nome", "E-mail", "Telefone", "Perfil", "Equipe", "Status", "Ações"]}
        rows={(data?.items || []).map((u) => [
          <span key={`name-${u.id}`} className="inline-flex items-center gap-2">
            <UserAvatar name={u.name} src={u.avatar_url} size="sm" />
            {u.name}
          </span>,
          u.email,
          u.phone || "—",
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
          setPendingAvatar(null);
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
          <AvatarPicker
            name={form.name || "Usuário"}
            src={creating ? null : edit?.avatar_url}
            busy={avatarBusy}
            onFile={onPickAvatar}
            onRemove={creating || edit?.avatar_url || pendingAvatar ? onRemoveAvatar : undefined}
          />
          <UnderlineField label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <UnderlineField label="E-mail" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <UnderlineField
            label="Telefone (WhatsApp)"
            value={form.phone}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            placeholder="(00) 00000-0000"
          />
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
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
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
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
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
