"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Share2, Trash2 } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, IconAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { ShareToChatDialog, type ShareToChatTarget } from "@/components/chat/ShareToChatDialog";
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

type Attachment = {
  id: number;
  filename: string;
  file_size_label?: string;
  available?: boolean;
  download_count?: number;
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
  attachments?: Attachment[];
  attachments_count?: number;
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
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const categoryId = Number(params.categoryId);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Art | null>(null);
  const [view, setView] = useState<Art | null>(null);
  const [form, setForm] = useState(emptyArt);
  const [formError, setFormError] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editAttachments, setEditAttachments] = useState<Attachment[]>([]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareToChatTarget | null>(null);
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
    mutationFn: async () => {
      if (!form.title.trim() || !form.content.trim()) throw new Error("Título e conteúdo são obrigatórios");
      const payload = { ...form, category_id: categoryId };
      const saved = creating
        ? await flask.post<Art>("/api/web/knowledge/articles", payload)
        : await flask.patch<Art>(`/api/web/knowledge/articles/${edit?.id}`, payload);
      if (!saved?.id) throw new Error("Não foi possível salvar o artigo");
      if (pendingFiles.length) {
        const data = new FormData();
        pendingFiles.forEach((file) => data.append("attachments", file));
        await flask.post(`/api/web/knowledge/articles/${saved.id}/attachments`, data);
      }
    },
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setEdit(null);
      setPendingFiles([]);
      setEditAttachments([]);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/knowledge/articles/${id}`),
    onSuccess: invalidate,
  });

  const downloadAttachment = async (att: Attachment) => {
    setDownloadingId(att.id);
    try {
      await flask.download(`/api/web/knowledge/attachments/${att.id}/download`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Não foi possível baixar o anexo.");
    } finally {
      setDownloadingId(null);
    }
  };

  const removeAttachment = useMutation({
    mutationFn: (id: number) => flask.delete<Art>(`/api/web/knowledge/attachments/${id}`),
    onSuccess: (article) => {
      setEditAttachments(article.attachments || []);
      if (view && view.id === article.id) setView(article);
      invalidate();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao excluir anexo"),
  });

  const openView = async (a: Art) => {
    const full = await flask.get<Art>(`/api/web/knowledge/articles/${a.id}?view=1`);
    setView(full);
    qc.invalidateQueries({ queryKey: ["knowledge-arts", categoryId] });
  };

  useEffect(() => {
    const raw = searchParams.get("artigo");
    const articleId = raw ? Number(raw) : NaN;
    if (!Number.isFinite(articleId) || articleId <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const full = await flask.get<Art>(`/api/web/knowledge/articles/${articleId}?view=1`);
        if (!cancelled) setView(full);
      } catch {
        /* artigo inválido ou sem permissão */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

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
            setPendingFiles([]);
            setEditAttachments([]);
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
            <IconAction
              label="Encaminhar no chat"
              icon={Share2}
              onClick={() =>
                setShareTarget({
                  payload: {
                    kind: "knowledge",
                    id: a.id,
                    title: a.title,
                    subtitle: a.category || cat?.name,
                    url: `/conhecimento/${a.category_id || categoryId}?artigo=${a.id}`,
                  },
                })
              }
            />
            <EditAction
              onClick={async () => {
                const full = await flask.get<Art>(`/api/web/knowledge/articles/${a.id}`);
                setForm({
                  title: full.title,
                  summary: full.summary || "",
                  content: full.content || "",
                  tags: full.tags || "",
                  status: full.status || "published",
                });
                setFormError("");
                setPendingFiles([]);
                setEditAttachments(full.attachments || []);
                setCreating(false);
                setEdit(full);
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
        <button
          type="button"
          onClick={() =>
            view &&
            setShareTarget({
              payload: {
                kind: "knowledge",
                id: view.id,
                title: view.title,
                subtitle: view.category || cat?.name,
                url: `/conhecimento/${view.category_id || categoryId}?artigo=${view.id}`,
              },
            })
          }
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line bg-wash px-3 py-2 text-sm font-medium text-ink"
        >
          <Share2 className="h-4 w-4" />
          Encaminhar no chat
        </button>
        {(view?.attachments || []).length > 0 ? (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Anexos</p>
            <ul className="space-y-2">
              {(view?.attachments || []).map((att) => (
                <li
                  key={att.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{att.filename}</p>
                    <p className="text-xs text-muted">
                      {att.file_size_label || ""}
                      {att.available === false ? " · arquivo indisponível" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={downloadingId === att.id}
                    onClick={() => downloadAttachment(att)}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-inverse px-3 text-[13px] font-medium text-on-inverse disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingId === att.id ? "Baixando…" : "Baixar"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={creating || !!edit}
        onClose={() => {
          setCreating(false);
          setEdit(null);
          setPendingFiles([]);
          setEditAttachments([]);
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
          {editAttachments.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Anexos atuais</p>
              <ul className="space-y-2">
                {editAttachments.map((att) => (
                  <li key={att.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{att.filename}</p>
                      <p className="text-xs text-muted">
                        {att.file_size_label || ""}
                        {att.available === false ? " · indisponível" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={downloadingId === att.id}
                        onClick={() => downloadAttachment(att)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-wash px-2 text-xs text-ink disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Baixar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Excluir o anexo ${att.filename}?`)) removeAttachment.mutate(att.id);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-open hover:bg-open-bg"
                        aria-label="Excluir anexo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Novos anexos</span>
            <input
              type="file"
              multiple
              onChange={(e) => setPendingFiles(Array.from(e.target.files || []))}
              className="mt-2 block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-wash file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
            />
            {pendingFiles.length > 0 ? (
              <p className="mt-1 text-xs text-muted">
                {pendingFiles.length} arquivo{pendingFiles.length === 1 ? "" : "s"} para enviar
              </p>
            ) : null}
          </label>
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
      <ShareToChatDialog open={!!shareTarget} target={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
