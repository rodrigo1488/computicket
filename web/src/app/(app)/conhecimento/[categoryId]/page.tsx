"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { knowledgeIcon } from "@/lib/knowledge-icons";
import { useColFilters } from "@/lib/use-col-filters";

type Cat = {
  id: number;
  name: string;
  description: string;
  color?: string;
  icon?: string;
  articles_count?: number;
};

type Art = {
  id: number;
  title: string;
  summary: string;
  content?: string;
  tags?: string;
  status?: string;
  is_featured?: boolean;
  category: string;
  category_id?: number;
  views_count: number;
  created_at?: string | null;
  created_by?: string;
};

type Res = {
  category?: Cat | null;
  articles: Art[];
  total?: number;
  page?: number;
  per_page?: number;
};

function articleStatus(s?: string) {
  if (s === "draft") return "Rascunho";
  if (s === "archived") return "Arquivado";
  if (s === "published") return "Publicado";
  return s || "—";
}

const emptyArt = { title: "", summary: "", content: "", tags: "", status: "published" };

export default function ConhecimentoCategoriaPage() {
  const params = useParams<{ categoryId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const categoryId = Number(params.categoryId);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Art | null>(null);
  const [view, setView] = useState<Art | null>(null);
  const [form, setForm] = useState(emptyArt);
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["knowledge-arts", categoryId, q, page, colQuery],
    queryFn: () =>
      flask.get<Res>(
        `/api/web/knowledge?kind=articles&category_id=${categoryId}&q=${encodeURIComponent(q)}&page=${page}&per_page=25${colQuery}`,
      ),
    enabled: Number.isFinite(categoryId),
    placeholderData: (previousData) => previousData,
  });

  const cat = data?.category;
  const Icon = knowledgeIcon(cat?.icon);
  const color = cat?.color || "#3B82F6";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["knowledge-arts", categoryId] });
    qc.invalidateQueries({ queryKey: ["knowledge-cats"] });
  };

  const save = useMutation({
    mutationFn: () => {
      if (!form.title.trim() || !form.content.trim()) throw new Error("Título e conteúdo são obrigatórios");
      const payload = { ...form, category_id: categoryId };
      if (creating) return flask.post("/api/web/knowledge/articles", payload);
      if (!edit) throw new Error("Nenhum artigo");
      return flask.patch(`/api/web/knowledge/articles/${edit.id}`, payload);
    },
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/knowledge/articles/${id}`),
    onSuccess: invalidate,
  });

  const openView = async (a: Art) => {
    const full = await flask.get<Art>(`/api/web/knowledge/articles/${a.id}?view=1`);
    setView(full);
    qc.invalidateQueries({ queryKey: ["knowledge-arts", categoryId] });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => router.push("/conhecimento")}
        className="mb-3 text-sm text-muted hover:text-ink"
      >
        ← Voltar às categorias
      </button>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${color}22`, color }}
          >
            <Icon className="h-7 w-7" />
          </div>
          <div>
            <PageTitle className="mb-1">{cat?.name || "Categoria"}</PageTitle>
            <p className="text-sm text-muted">{cat?.description || "Artigos desta categoria"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyArt);
            setFormError("");
            setEdit(null);
            setCreating(true);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
        >
          <Plus className="h-4 w-4" />
          Novo artigo
        </button>
      </div>

      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      <DataTable
        id="conhecimento-artigos"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por título, tags…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Título", "Status", "Visualizações", "Ações"]}
        empty="Nenhum artigo nesta categoria"
        rows={(data?.articles || []).map((a) => [
          a.title,
          articleStatus(a.status),
          String(a.views_count ?? 0),
          <RowActions key={a.id}>
            <ViewAction onClick={() => openView(a)} />
            <EditAction
              onClick={() => {
                setForm({
                  title: a.title,
                  summary: a.summary || "",
                  content: a.content || "",
                  tags: a.tags || "",
                  status: a.status || "published",
                });
                setFormError("");
                setCreating(false);
                setEdit(a);
              }}
            />
            <DeleteAction
              onClick={() => {
                if (window.confirm(`Excluir o artigo ${a.title}?`)) remove.mutate(a.id);
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

      <Modal open={!!view} onClose={() => setView(null)} title={view?.title || "Artigo"} wide>
        <p className="text-sm text-muted">
          {view?.category} · {articleStatus(view?.status)} · {view?.views_count ?? 0} visualizações
        </p>
        {view?.summary ? <p className="mt-2 text-sm italic text-muted">{view.summary}</p> : null}
        <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{view?.content || "—"}</p>
      </Modal>

      <Modal
        open={creating || !!edit}
        onClose={() => {
          setCreating(false);
          setEdit(null);
        }}
        title={creating ? "Novo artigo" : "Editar artigo"}
        wide
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Título" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
          <UnderlineField
            label="Resumo"
            value={form.summary}
            onChange={(v) => setForm((f) => ({ ...f, summary: v }))}
          />
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Conteúdo</span>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={8}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            />
          </label>
          <UnderlineField label="Tags" value={form.tags} onChange={(v) => setForm((f) => ({ ...f, tags: v }))} />
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="published">Publicado</option>
              <option value="draft">Rascunho</option>
              <option value="archived">Arquivado</option>
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
