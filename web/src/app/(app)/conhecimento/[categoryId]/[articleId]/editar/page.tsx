"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "@/components/tabs/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { KnowledgeArticleForm, type KnowledgeArticleData } from "@/components/knowledge/KnowledgeArticleForm";
import { flask } from "@/lib/api";

export default function EditarArtigoComCategoriaPage() {
  const params = useParams<{ categoryId: string; articleId: string }>();
  const router = useRouter();
  const categoryId = Number(params.categoryId);
  const articleId = Number(params.articleId);

  const { data: article, isLoading, error } = useQuery({
    queryKey: ["knowledge-article", articleId],
    queryFn: () => flask.get<KnowledgeArticleData>(`/api/web/knowledge/articles/${articleId}`),
    enabled: Number.isFinite(articleId) && articleId > 0,
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Carregando artigo…</p>;
  }

  if (error || !article) {
    return (
      <div>
        <button
          type="button"
          onClick={() => router.push(`/conhecimento/${categoryId}`)}
          className="mb-3 text-sm text-muted hover:text-ink"
        >
          ← Voltar para a categoria
        </button>
        <p className="text-sm text-open">{error ? (error as Error).message : "Artigo não encontrado."}</p>
      </div>
    );
  }

  const targetCategoryId = article.category_id || categoryId;

  return (
    <div className="mx-auto max-w-5xl">
      <button
        type="button"
        onClick={() => router.push(`/conhecimento/${targetCategoryId}`)}
        className="mb-3 text-sm text-muted hover:text-ink"
      >
        ← Voltar para {article.category || "categoria"}
      </button>
      <div className="mb-6">
        <PageTitle className="mb-1">Editar artigo</PageTitle>
        <p className="text-sm text-muted">
          Categoria: <span className="font-medium text-ink">{article.category || `#${targetCategoryId}`}</span>
        </p>
      </div>
      <KnowledgeArticleForm mode="edit" categoryId={targetCategoryId} initialArticle={article} />
    </div>
  );
}
