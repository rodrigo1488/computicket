"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { Kpi } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { KNOWLEDGE_ICON_OPTIONS, knowledgeIcon } from "@/lib/knowledge-icons";

type Cat = {
  id: number;
  name: string;
  description: string;
  color?: string;
  icon?: string;
  articles_count?: number;
};

type Res = {
  categories: Cat[];
  stats?: { total_categories: number; total_articles: number; total_views: number };
  total?: number;
  page?: number;
  per_page?: number;
};

const emptyCat = { name: "", description: "", color: "#3B82F6", icon: "fas fa-folder" };

export default function ConhecimentoPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Cat | null>(null);
  const [form, setForm] = useState(emptyCat);
  const [formError, setFormError] = useState("");

  useEffect(() => setPage(1), [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["knowledge-cats", q, page],
    queryFn: () =>
      flask.get<Res>(
        `/api/web/knowledge?kind=categories&q=${encodeURIComponent(q)}&page=${page}&per_page=12`,
      ),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Nome é obrigatório");
      if (creating) return flask.post("/api/web/knowledge/categories", form);
      if (!edit) throw new Error("Nenhuma categoria");
      return flask.patch(`/api/web/knowledge/categories/${edit.id}`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-cats"] });
      setCreating(false);
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/knowledge/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-cats"] }),
  });

  const openForm = (cat?: Cat) => {
    setForm(
      cat
        ? { name: cat.name, description: cat.description || "", color: cat.color || "#3B82F6", icon: cat.icon || "fas fa-folder" }
        : emptyCat,
    );
    setFormError("");
    if (cat) {
      setCreating(false);
      setEdit(cat);
    } else {
      setEdit(null);
      setCreating(true);
    }
  };

  const PreviewIcon = knowledgeIcon(form.icon);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Banco de conhecimentos</PageTitle>
          <p className="text-sm text-muted">Centralize e organize o conhecimento da equipe</p>
        </div>
        <button
          type="button"
          onClick={() => openForm()}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          Nova categoria
        </button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Categorias" value={data?.stats?.total_categories ?? "—"} tone="brand" />
        <Kpi label="Artigos" value={data?.stats?.total_articles ?? "—"} tone="done" />
        <Kpi label="Visualizações" value={data?.stats?.total_views ?? "—"} />
      </div>

      <form
        className="mb-6 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Buscar categorias…"
          className="h-10 min-w-[220px] max-w-md flex-1 rounded-lg border border-[#e5e7eb] px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white">
          Buscar
        </button>
      </form>

      {isLoading ? <p className="mb-4 text-sm text-muted">Carregando categorias…</p> : null}
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      {(data?.categories || []).length === 0 && !isLoading ? (
        <div className="rounded-2xl border border-[#eee] px-6 py-12 text-center text-sm text-muted">
          Nenhuma categoria encontrada. Crie a primeira para organizar os artigos.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(data?.categories || []).map((c) => {
            const Icon = knowledgeIcon(c.icon);
            const color = c.color || "#3B82F6";
            return (
              <div
                key={c.id}
                className="group rounded-2xl border border-[#eee] p-5 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-4 flex items-start gap-3">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${color}22`, color }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-lg font-semibold text-navy">{c.name}</h3>
                    <p className="text-sm text-muted">{c.articles_count ?? 0} artigo{(c.articles_count || 0) === 1 ? "" : "s"}</p>
                  </div>
                </div>
                {c.description ? <p className="mb-4 line-clamp-2 text-sm text-muted">{c.description}</p> : null}
                <div className="flex items-center gap-2">
                  <Link
                    href={`/conhecimento/${c.id}`}
                    className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-ink px-3 text-sm font-medium text-white"
                  >
                    Ver artigos
                  </Link>
                  <button
                    type="button"
                    onClick={() => openForm(c)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#f3f4f6] text-[#6b7280]"
                    aria-label="Editar categoria"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Excluir a categoria ${c.name}? Os artigos também serão removidos.`)) {
                        remove.mutate(c.id);
                      }
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#f3f4f6] text-open"
                    aria-label="Excluir categoria"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pagination
        page={data?.page || page}
        perPage={data?.per_page || 12}
        total={data?.total || 0}
        onPage={setPage}
      />

      <Modal
        open={creating || !!edit}
        onClose={() => {
          setCreating(false);
          setEdit(null);
        }}
        title={creating ? "Nova categoria" : "Editar categoria"}
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
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Ícone</span>
            <select
              value={form.icon}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink"
            >
              {KNOWLEDGE_ICON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Cor</span>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-[#e5e7eb]"
            />
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#eee] p-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${form.color}22`, color: form.color }}
            >
              <PreviewIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium text-navy">{form.name || "Nome da categoria"}</p>
              <p className="text-xs text-muted">{form.description || "Descrição"}</p>
            </div>
          </div>
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
