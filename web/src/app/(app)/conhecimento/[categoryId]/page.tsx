"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Share2 } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "@/components/tabs/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { ShareToChatDialog, type ShareToChatTarget } from "@/components/chat/ShareToChatDialog";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, IconAction, RowActions, ViewAction } from "@/components/ui/RowActions";
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

export default function ConhecimentoCategoriaPage() {
  const params = useParams<{ categoryId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const categoryId = Number(params.categoryId);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [shareTarget, setShareTarget] = useState<ShareToChatTarget | null>(null);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  useEffect(() => {
    const raw = searchParams.get("artigo");
    const articleId = raw ? Number(raw) : NaN;
    if (Number.isFinite(articleId) && articleId > 0 && Number.isFinite(categoryId)) {
      router.replace(`/conhecimento/${categoryId}/${articleId}`);
    }
  }, [searchParams, categoryId, router]);

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
  const articles = data?.articles || [];
  const Icon = knowledgeIcon(cat?.icon);
  const color = cat?.color || "#3B82F6";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["knowledge-arts", categoryId] });
    qc.invalidateQueries({ queryKey: ["knowledge-cats"] });
  };

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/knowledge/articles/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => router.replace("/conhecimento")}
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
          onClick={() => router.push(`/conhecimento/${categoryId}/novo`)}
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
        onRowClick={(index) => {
          const art = articles[index];
          if (art) router.push(`/conhecimento/${categoryId}/${art.id}`);
        }}
        rows={articles.map((a) => [
          <div key={`title-${a.id}`}>
            <p className="font-medium text-navy">{a.title}</p>
            {a.summary ? <p className="line-clamp-1 text-xs text-muted">{a.summary}</p> : null}
          </div>,
          articleStatus(a.status),
          String(a.views_count ?? 0),
          <RowActions key={a.id}>
            <ViewAction href={`/conhecimento/${categoryId}/${a.id}`} />
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
                    url: `/conhecimento/${a.category_id || categoryId}/${a.id}`,
                  },
                })
              }
            />
            <EditAction href={`/conhecimento/${a.id}/editar`} />
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

      <ShareToChatDialog open={!!shareTarget} target={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
