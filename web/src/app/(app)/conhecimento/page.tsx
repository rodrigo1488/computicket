"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { useRouter } from "@/components/tabs/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable, Kpi } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, RowActions } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
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
  const router = useRouter();
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Cat | null>(null);
  const [form, setForm] = useState(emptyCat);
  const [formError, setFormError] = useState("");

  useEffect(() => setPage(1), [q]);

  const { data, isLoading, isFetching, error } = useQuery({
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

  const categories = data?.categories || [];
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
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draft.trim());
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Buscar categorias…"
            className="h-10 min-w-[220px] max-w-md flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
          />
          <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white">
            Buscar
          </button>
        </form>

        <div
          role="group"
          aria-label="Modo de visualização"
          className="inline-flex items-center rounded-xl border border-line bg-wash/70 p-1"
        >
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            aria-pressed={viewMode === "cards"}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              viewMode === "cards" ? "bg-surface text-brand shadow-xs" : "text-muted hover:text-ink",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cards
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            aria-pressed={viewMode === "table"}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              viewMode === "table" ? "bg-surface text-brand shadow-xs" : "text-muted hover:text-ink",
            )}
          >
            <Table2 className="h-3.5 w-3.5" />
            Tabela
          </button>
        </div>
      </div>

      {isLoading && viewMode === "cards" ? <p className="mb-4 text-sm text-muted">Carregando categorias…</p> : null}
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      {viewMode === "table" ? (
        <DataTable
          id="conhecimento-categorias"
          hideSearch
          loading={isLoading}
          refreshing={isFetching}
          columnMeta={{ Ações: { sortable: false, filter: false } }}
          columns={["Categoria", "Descrição", "Artigos", "Ações"]}
          empty="Nenhuma categoria encontrada. Crie a primeira para organizar os artigos."
          onRowClick={(index) => {
            const cat = categories[index];
            if (cat) router.push(`/conhecimento/${cat.id}`);
          }}
          rows={categories.map((c) => {
            const Icon = knowledgeIcon(c.icon);
            const color = c.color || "#3B82F6";
            return [
              <div key={`cat-${c.id}`} className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${color}22`, color }}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span className="font-medium text-navy">{c.name}</span>
              </div>,
              c.description || "—",
              `${c.articles_count ?? 0} artigo${(c.articles_count || 0) === 1 ? "" : "s"}`,
              <RowActions key={`act-${c.id}`}>
                <EditAction onClick={() => openForm(c)} />
                <DeleteAction
                  onClick={() => {
                    if (window.confirm(`Excluir a categoria ${c.name}? Os artigos também serão removidos.`)) {
                      remove.mutate(c.id);
                    }
                  }}
                />
              </RowActions>,
            ];
          })}
        />
      ) : categories.length === 0 && !isLoading ? (
        <div className="rounded-2xl border border-line px-6 py-12 text-center text-sm text-muted">
          Nenhuma categoria encontrada. Crie a primeira para organizar os artigos.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((c) => {
            const Icon = knowledgeIcon(c.icon);
            const color = c.color || "#3B82F6";
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/conhecimento/${c.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/conhecimento/${c.id}`);
                  }
                }}
                className="group cursor-pointer rounded-2xl border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${color}22`, color }}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-semibold text-navy group-hover:text-brand">{c.name}</h3>
                      <p className="text-sm text-muted">
                        {c.articles_count ?? 0} artigo{(c.articles_count || 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openForm(c)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-muted hover:bg-line hover:text-ink"
                      aria-label="Editar categoria"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Excluir a categoria ${c.name}? Os artigos também serão removidos.`)) {
                          remove.mutate(c.id);
                        }
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-open hover:bg-open-bg"
                      aria-label="Excluir categoria"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {c.description ? <p className="line-clamp-2 text-sm text-muted">{c.description}</p> : null}
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
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
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
              className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-line"
            />
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3">
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
