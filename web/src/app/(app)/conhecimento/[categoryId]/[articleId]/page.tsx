"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Eye, Share2, Tag } from "lucide-react";
import { useParams, useRouter } from "@/components/tabs/navigation";
import { useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { ShareToChatDialog, type ShareToChatTarget } from "@/components/chat/ShareToChatDialog";
import { type KnowledgeArticleData, type KnowledgeAttachment } from "@/components/knowledge/KnowledgeArticleForm";
import { MarkdownContent } from "@/components/knowledge/MarkdownContent";
import { flask } from "@/lib/api";

function articleStatus(s?: string) {
  if (s === "draft") return "Rascunho";
  if (s === "archived") return "Arquivado";
  if (s === "published") return "Publicado";
  return s || "—";
}

function attachmentIsImage(att: KnowledgeAttachment) {
  return (att.file_type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(att.filename);
}

export default function VisualizarArtigoPage() {
  const params = useParams<{ categoryId: string; articleId: string }>();
  const router = useRouter();
  const categoryId = Number(params.categoryId);
  const articleId = Number(params.articleId);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareToChatTarget | null>(null);

  const { data: article, isLoading, error } = useQuery({
    queryKey: ["knowledge-article", articleId, "view"],
    queryFn: () => flask.get<KnowledgeArticleData>(`/api/web/knowledge/articles/${articleId}?view=1`),
    enabled: Number.isFinite(articleId) && articleId > 0,
  });

  const downloadAttachment = async (att: KnowledgeAttachment) => {
    setDownloadingId(att.id);
    try {
      await flask.download(`/api/web/knowledge/attachments/${att.id}/download`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Não foi possível baixar o anexo.");
    } finally {
      setDownloadingId(null);
    }
  };

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

  const backCategoryId = article.category_id || categoryId;
  const tagsList = (article.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push(`/conhecimento/${backCategoryId}`)}
          className="text-sm text-muted hover:text-ink"
        >
          ← Voltar para {article.category || "categoria"}
        </button>
        <button
          type="button"
          onClick={() =>
            setShareTarget({
              payload: {
                kind: "knowledge",
                id: article.id,
                title: article.title,
                subtitle: article.category,
                url: `/conhecimento/${backCategoryId}/${article.id}`,
              },
            })
          }
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:bg-wash"
        >
          <Share2 className="h-4 w-4" />
          Encaminhar no chat
        </button>
      </div>

      <article className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <header className="border-b border-line pb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-wash px-2.5 py-0.5 font-medium text-navy">
              {article.category || "Base de conhecimento"}
            </span>
            <span>·</span>
            <span>{articleStatus(article.status)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {article.views_count ?? 0} visualizações
            </span>
            {article.created_by ? (
              <>
                <span>·</span>
                <span>Por {article.created_by}</span>
              </>
            ) : null}
            {article.updated_at || article.created_at ? (
              <>
                <span>·</span>
                <span>{article.updated_at || article.created_at}</span>
              </>
            ) : null}
          </div>

          <PageTitle className="mb-2">{article.title}</PageTitle>

          {article.summary ? (
            <p className="text-sm italic text-muted">{article.summary}</p>
          ) : null}

          {tagsList.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-muted" />
              {tagsList.map((tag, idx) => (
                <span
                  key={`${tag}-${idx}`}
                  className="rounded-full bg-wash px-2.5 py-0.5 text-xs font-medium text-navy"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="pt-6">
          <MarkdownContent
            content={article.content}
            fallback={<p className="text-sm text-muted">Este artigo não possui conteúdo.</p>}
          />
        </div>

        {(article.attachments || []).filter(attachmentIsImage).length > 0 ? (
          <div className="mt-6 space-y-3 border-t border-line pt-6">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Imagens anexadas</p>
            {(article.attachments || []).filter(attachmentIsImage).map((att) => (
              <img
                key={att.id}
                src={`/flask/api/web/knowledge/attachments/${att.id}/download?inline=1`}
                alt={att.filename}
                className="max-h-96 rounded-xl border border-line"
              />
            ))}
          </div>
        ) : null}

        {(article.attachments || []).length > 0 ? (
          <div className="mt-6 border-t border-line pt-6">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">Ficheiros anexados</p>
            <ul className="space-y-2">
              {(article.attachments || []).map((att) => (
                <li
                  key={att.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5"
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
      </article>

      <ShareToChatDialog open={!!shareTarget} target={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
