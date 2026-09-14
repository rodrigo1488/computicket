"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { flask } from "@/lib/api";
import { formatUtilityDate, utilityDownloadHref, type UtilityFile } from "@/lib/utilitarios";

type Res = { items: UtilityFile[]; total: number };

export default function PublicUtilitariosPage() {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["utilitarios-public", q],
    queryFn: () =>
      flask.get<Res>(`/utilitarios/api/publico${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  const items = data?.items || [];
  const emptyLabel = useMemo(() => {
    if (q) return "Nenhum arquivo encontrado para essa busca.";
    return "Nenhum arquivo disponível no momento.";
  }, [q]);

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

        {isLoading ? <p className="mt-6 text-sm text-muted">Carregando arquivos…</p> : null}
        {error ? <p className="mt-6 text-sm text-open">{(error as Error).message}</p> : null}

        {!isLoading && !error && items.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-line px-6 py-12 text-center text-sm text-muted">
            {emptyLabel}
          </div>
        ) : null}

        <ul className="mt-6 space-y-3">
          {items.map((file) => (
            <li key={file.id} className="rounded-2xl border border-line p-4 sm:p-5">
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
          ))}
        </ul>
      </section>
    </main>
  );
}
