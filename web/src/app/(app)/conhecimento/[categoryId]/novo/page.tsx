"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "@/components/tabs/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { KnowledgeArticleForm } from "@/components/knowledge/KnowledgeArticleForm";
import { flask } from "@/lib/api";

type Cat = {
  id: number;
  name: string;
  description?: string;
};

export default function NovoArtigoPage() {
  const params = useParams<{ categoryId: string }>();
  const router = useRouter();
  const categoryId = Number(params.categoryId);

  const { data: cat } = useQuery({
    queryKey: ["knowledge-cat", categoryId],
    queryFn: () => flask.get<Cat>(`/api/web/knowledge/categories/${categoryId}`),
    enabled: Number.isFinite(categoryId),
  });

  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    return <p className="text-sm text-open">Categoria inválida.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <button
        type="button"
        onClick={() => router.push(`/conhecimento/${categoryId}`)}
        className="mb-3 text-sm text-muted hover:text-ink"
      >
        ← Voltar para {cat?.name || "categoria"}
      </button>
      <div className="mb-6">
        <PageTitle className="mb-1">Novo artigo</PageTitle>
        <p className="text-sm text-muted">
          Categoria: <span className="font-medium text-ink">{cat?.name || `#${categoryId}`}</span>
        </p>
      </div>
      <KnowledgeArticleForm mode="create" categoryId={categoryId} />
    </div>
  );
}
