"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type PageMeta = {
  page: number;
  per_page: number;
  total: number;
};

export function pageCount(total: number, perPage: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, perPage)));
}

export function Pagination({
  page,
  perPage,
  total,
  onPage,
  className,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const pages = pageCount(total, perPage);
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * perPage + 1;
  const to = Math.min(current * perPage, total);

  const numbers: number[] = [];
  const window = 2;
  const start = Math.max(1, current - window);
  const end = Math.min(pages, current + window);
  for (let n = start; n <= end; n += 1) numbers.push(n);

  return (
    <div className={cn("mt-5 flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-sm text-muted">
        Página {current} de {pages}
        <span className="ml-2 text-xs">
          {from}–{to} de {total}
        </span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#eee] px-2.5 text-sm text-ink disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </button>
        {start > 1 ? (
          <>
            <PageNum n={1} current={current} onPage={onPage} />
            {start > 2 ? <span className="px-1 text-muted">…</span> : null}
          </>
        ) : null}
        {numbers.map((n) => (
          <PageNum key={n} n={n} current={current} onPage={onPage} />
        ))}
        {end < pages ? (
          <>
            {end < pages - 1 ? <span className="px-1 text-muted">…</span> : null}
            <PageNum n={pages} current={current} onPage={onPage} />
          </>
        ) : null}
        <button
          type="button"
          disabled={current >= pages}
          onClick={() => onPage(current + 1)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#eee] px-2.5 text-sm text-ink disabled:opacity-40"
          aria-label="Próxima página"
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PageNum({ n, current, onPage }: { n: number; current: number; onPage: (p: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPage(n)}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm",
        n === current ? "bg-ink text-white" : "text-muted hover:bg-[#f5f5f5]",
      )}
    >
      {n}
    </button>
  );
}
