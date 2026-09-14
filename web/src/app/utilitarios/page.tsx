"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatUtilityDate,
  groupUtilityFiles,
  utilityDownloadHref,
  type UtilityCategory,
  type UtilityFile,
  type UtilityGroup,
} from "@/lib/utilitarios";

type Res = { items: UtilityFile[]; total: number; categories?: UtilityCategory[] };
type Filter = "all" | "none" | number;

function FileCard({ file }: { file: UtilityFile }) {
  return (
    <li className="rounded-2xl border border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-wash text-brand">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-navy">{file.title}</h2>
          <p className="mt-0.5 truncate text-sm text-muted">{file.original_filename}</p>
          {file.description ? <p className="mt-2 text-sm text-ink">{file.description}</p> : null}
          <p className="mt-2 text-xs text-muted">
            {file.file_size_label} · {formatUtilityDate(file.created_at)}
          </p>
        </div>
        <a
          href={utilityDownloadHref(file)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
        >
          <Download className="h-4 w-4" />
          Baixar
        </a>
      </div>
    </li>
  );
}

export default function PublicUtilitariosPage() {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["utilitarios-public", q],
    queryFn: () =>
      flask.get<Res>(`/utilitarios/api/publico${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  const items = data?.items || [];
  const categories = data?.categories || [];
  const uncategorizedCount = items.filter((file) => !file.category_id).length;
  const groups = useMemo(() => groupUtilityFiles(items, categories), [items, categories]);
  const visibleGroups: UtilityGroup[] = useMemo(() => {
    if (filter === "all") return groups;
    if (filter === "none") return groups.filter((group) => group.id === "none");
    return groups.filter((group) => group.id === filter);
  }, [filter, groups]);
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.files.length, 0);
  const emptyLabel = q ? "Nenhum arquivo encontrado para essa busca." : "Nenhum arquivo disponível no momento.";

  return (
    <main className="flex h-full min-h-0 items-start justify-center overflow-y-auto bg-canvas px-4 py-10">
      <section className="w-full max-w-3xl rounded-3xl bg-surface p-7 shadow-[0_20px_70px_rgba(15,23,42,0.12)] sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">
            C
          </div>
          <div>
            <p className="font-semibold text-navy">Computicket</p>
            <p className="text-xs text-muted">Arquivos para download, sem login</p>
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-navy">Utilitários</h1>
        <p className="mt-2 text-sm text-muted">
          Baixe instaladores, manuais e outros arquivos disponibilizados pela equipe.
        </p>

        <form
          className="mt-6 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draft.trim());
          }}
        >
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Buscar arquivos…"
              className="h-10 w-full rounded-lg border border-line bg-transparent pl-9 pr-3 text-sm text-ink"
            />
          </label>
          <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white">
            Buscar
          </button>
        </form>

        {categories.length || uncategorizedCount ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "h-9 rounded-full border px-3 text-sm",
                filter === "all" ? "border-ink bg-inverse text-on-inverse" : "border-line text-ink",
              )}
            >
              Todos
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setFilter(category.id)}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm",
                  filter === category.id ? "border-ink bg-inverse text-on-inverse" : "border-line text-ink",
                )}
              >
                {category.name}
                {typeof category.files_count === "number" ? ` (${category.files_count})` : ""}
              </button>
            ))}
            {uncategorizedCount ? (
              <button
                type="button"
                onClick={() => setFilter("none")}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm",
                  filter === "none" ? "border-ink bg-inverse text-on-inverse" : "border-line text-ink",
                )}
              >
                Sem categoria ({uncategorizedCount})
              </button>
            ) : null}
          </div>
        ) : null}

        {isLoading ? <p className="mt-6 text-sm text-muted">Carregando arquivos…</p> : null}
        {error ? <p className="mt-6 text-sm text-open">{(error as Error).message}</p> : null}

        {!isLoading && !error && visibleCount === 0 ? (
          <div className="mt-8 rounded-2xl border border-line px-6 py-12 text-center text-sm text-muted">
            {emptyLabel}
          </div>
        ) : null}

        <div className="mt-6 space-y-8">
          {visibleGroups.map((group) => (
            <section key={String(group.id)}>
              {filter === "all" && (categories.length > 0 || uncategorizedCount) ? (
                <h2 className="mb-3 text-sm font-semibold tracking-[0.04em] text-navy uppercase">
                  {group.name}
                </h2>
              ) : null}
              <ul className="space-y-3">
                {group.files.map((file) => (
                  <FileCard key={file.id} file={file} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
