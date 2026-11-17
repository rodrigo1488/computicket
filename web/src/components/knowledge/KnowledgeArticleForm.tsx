"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Loader2, Save, Trash2 } from "lucide-react";
import { useRouter } from "@/components/tabs/navigation";
import { useMemo, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/knowledge/MarkdownEditor";
import { PrimaryButton } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";

export type KnowledgeAttachment = {
  id: number;
  filename: string;
  file_type?: string;
  file_size_label?: string;
  available?: boolean;
  download_count?: number;
};

export type KnowledgeArticleData = {
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
  updated_at?: string | null;
  created_by?: string;
  attachments?: KnowledgeAttachment[];
};

type TranscribePdfRes = {
  markdown: string;
  suggested_title?: string;
  suggested_summary?: string;
  pages_count?: number;
  images_count?: number;
};

const SUMMARY_MAX_LENGTH = 100;

export function KnowledgeArticleForm({
  mode,
  categoryId,
  initialArticle,
}: {
  mode: "create" | "edit";
  categoryId: number;
  initialArticle?: KnowledgeArticleData | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState(initialArticle?.title || "");
  const [summary, setSummary] = useState((initialArticle?.summary || "").slice(0, SUMMARY_MAX_LENGTH));
  const [content, setContent] = useState(initialArticle?.content || "");
  const [tags, setTags] = useState(initialArticle?.tags || "");
  const [status, setStatus] = useState(initialArticle?.status || "published");
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>(initialArticle?.attachments || []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeNotice, setTranscribeNotice] = useState("");
  const [error, setError] = useState("");

  const parsedTags = useMemo(
    () =>
      tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [tags],
  );

  const targetCategoryId = initialArticle?.category_id || categoryId;

  const invalidate = (savedId?: number) => {
    qc.invalidateQueries({ queryKey: ["knowledge-arts"] });
    qc.invalidateQueries({ queryKey: ["knowledge-cats"] });
    if (savedId) {
      qc.invalidateQueries({ queryKey: ["knowledge-article", savedId] });
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("O título é obrigatório.");
      if (!content.trim()) throw new Error("O conteúdo em Markdown é obrigatório.");
      if (summary.trim().length > SUMMARY_MAX_LENGTH) {
        throw new Error(`O resumo deve ter no máximo ${SUMMARY_MAX_LENGTH} caracteres.`);
      }

      const payload = {
        title: title.trim(),
        summary: summary.trim().slice(0, SUMMARY_MAX_LENGTH),
        content: content.trim(),
        tags: tags.trim(),
        status,
        category_id: targetCategoryId,
      };

      const saved =
        mode === "create"
          ? await flask.post<KnowledgeArticleData>("/api/web/knowledge/articles", payload)
          : await flask.patch<KnowledgeArticleData>(`/api/web/knowledge/articles/${initialArticle?.id}`, payload);

      if (!saved?.id) throw new Error("Não foi possível salvar o artigo.");

      if (pendingFiles.length > 0) {
        const fd = new FormData();
        pendingFiles.forEach((f) => fd.append("attachments", f));
        await flask.post(`/api/web/knowledge/articles/${saved.id}/attachments`, fd);
      }

      return saved;
    },
    onSuccess: (saved) => {
      invalidate(saved.id);
      router.push(`/conhecimento/${saved.category_id || targetCategoryId}/${saved.id}`);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Erro ao salvar artigo.");
    },
  });

  const removeAttachment = useMutation({
    mutationFn: (id: number) => flask.delete<KnowledgeArticleData>(`/api/web/knowledge/attachments/${id}`),
    onSuccess: (updated) => {
      setAttachments(updated.attachments || []);
      invalidate(updated.id);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Erro ao remover anexo.");
    },
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

  const handleTranscribePdf = async (file: File) => {
    setError("");
    setTranscribeNotice("");
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await flask.post<TranscribePdfRes>("/api/web/knowledge/transcribe-pdf", fd);
      if (!res?.markdown?.trim()) {
        throw new Error("Não foi possível extrair conteúdo deste PDF.");
      }

      setContent((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n---\n\n${res.markdown}` : res.markdown));
      if (!title.trim() && res.suggested_title) {
        setTitle(res.suggested_title);
      }
      if (!summary.trim() && res.suggested_summary) {
        setSummary(res.suggested_summary.slice(0, SUMMARY_MAX_LENGTH));
      }
      setTranscribeNotice(
        `PDF transcrito com sucesso (${res.pages_count ?? 1} página(s) e ${res.images_count ?? 0} imagem(ns) incorporada(s)).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao transcrever o PDF.");
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        save.mutate();
      }}
    >
      <div className="grid gap-5 rounded-2xl border border-line bg-surface p-6">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Título *</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Configuração de impressora térmica no caixa"
            className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none"
          />
        </label>

        <label className="block">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Resumo (máximo {SUMMARY_MAX_LENGTH} caracteres)
            </span>
            <span className={`text-xs ${summary.length >= SUMMARY_MAX_LENGTH ? "font-medium text-open" : "text-muted"}`}>
              {summary.length}/{SUMMARY_MAX_LENGTH}
            </span>
          </div>
          <input
            type="text"
            maxLength={SUMMARY_MAX_LENGTH}
            value={summary}
            onChange={(e) => setSummary(e.target.value.slice(0, SUMMARY_MAX_LENGTH))}
            placeholder="Breve descrição do artigo em até 100 caracteres..."
            className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line bg-wash/50 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-navy">Transcrever PDF para o conteúdo</p>
            <p className="text-xs text-muted">
              Extrai texto, tabelas e imagens mantendo o conteúdo idêntico ao PDF diretamente no editor Markdown.
            </p>
          </div>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleTranscribePdf(file);
            }}
          />
          <button
            type="button"
            disabled={transcribing}
            onClick={() => pdfInputRef.current?.click()}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-wash disabled:opacity-60"
          >
            {transcribing ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <FileUp className="h-4 w-4 text-brand" />}
            {transcribing ? "Transcrevendo PDF…" : "Importar e transcrever PDF"}
          </button>
        </div>

        {transcribeNotice ? (
          <p className="rounded-xl border border-done/30 bg-done-bg px-3.5 py-2 text-xs font-medium text-done">
            {transcribeNotice}
          </p>
        ) : null}

        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Conteúdo (Markdown) *
          </span>
          <MarkdownEditor value={content} onChange={setContent} disabled={save.isPending} />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                Tags (separadas por vírgula)
              </span>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Ex: impressora, fiscal, tef, rede"
                className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none"
              />
            </label>
            {parsedTags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parsedTags.map((tag, idx) => (
                  <span
                    key={`${tag}-${idx}`}
                    className="rounded-full bg-wash px-2.5 py-0.5 text-xs font-medium text-navy"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="published">Publicado</option>
              <option value="draft">Rascunho</option>
              <option value="archived">Arquivado</option>
            </select>
          </label>
        </div>

        {attachments.length > 0 ? (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Ficheiros anexados</p>
            <ul className="space-y-2">
              {attachments.map((att) => (
                <li
                  key={att.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{att.filename}</p>
                    <p className="text-xs text-muted">
                      {att.file_size_label || ""}
                      {att.available === false ? " · arquivo indisponível" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={downloadingId === att.id}
                      onClick={() => downloadAttachment(att)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-wash px-2.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {downloadingId === att.id ? "Baixando…" : "Baixar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Excluir o anexo ${att.filename}?`)) {
                          removeAttachment.mutate(att.id);
                        }
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
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            {attachments.length > 0 ? "Adicionar novos ficheiros anexos" : "Ficheiro anexado"}
          </span>
          <input
            type="file"
            multiple
            onChange={(e) => setPendingFiles(Array.from(e.target.files || []))}
            className="mt-2 block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-wash file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
          />
          {pendingFiles.length > 0 ? (
            <p className="mt-1.5 text-xs text-muted">
              {pendingFiles.length} ficheiro{pendingFiles.length === 1 ? "" : "s"} selecionado
              {pendingFiles.length === 1 ? "" : "s"} para envio ao salvar.
            </p>
          ) : null}
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-open/30 bg-open-bg px-4 py-2.5 text-sm text-open">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push(`/conhecimento/${targetCategoryId}`)}
          className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:bg-wash"
        >
          Cancelar
        </button>
        <PrimaryButton type="submit" disabled={save.isPending || transcribing} className="w-auto px-5">
          <span className="inline-flex items-center gap-2">
            <Save className="h-4 w-4" />
            {save.isPending ? "Salvando…" : mode === "create" ? "Criar artigo" : "Salvar alterações"}
          </span>
        </PrimaryButton>
      </div>
    </form>
  );
}
