"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { KanbanCard } from "@/components/implantacao/KanbanCard";
import type { ImplantationCard, KanbanColumn } from "@/components/implantacao/types";
import { COMPLETED_COLUMN_KEY } from "@/components/implantacao/types";

export function KanbanBoard({
  columns,
  onOpen,
  onMove,
}: {
  columns: KanbanColumn[];
  onOpen: (card: ImplantationCard) => void;
  onMove: (cardId: number, columnKey: string) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="flex min-h-[62vh] gap-3 overflow-x-auto pb-4">
      {columns.map((column) => {
        const overdueInColumn = column.cards.filter((c) => c.overdue && c.status === "in_progress").length;
        const pausedInColumn = column.cards.filter((c) => c.status === "paused").length;
        const descriptionOpen = openKey === column.key;
        const canDescribe = column.key !== COMPLETED_COLUMN_KEY;
        return (
          <section
            key={column.key}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = Number(e.dataTransfer.getData("text/plain"));
              if (Number.isFinite(id) && id > 0) onMove(id, column.key);
            }}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-wash/60",
              column.key === COMPLETED_COLUMN_KEY && "bg-done-bg/40",
            )}
          >
            <header className="border-b border-line px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                {canDescribe ? (
                  <button
                    type="button"
                    onClick={() => setOpenKey(descriptionOpen ? null : column.key)}
                    className="min-w-0 text-left text-sm font-semibold text-navy hover:underline"
                    aria-expanded={descriptionOpen}
                  >
                    {column.name}
                  </button>
                ) : (
                  <h2 className="text-sm font-semibold text-navy">{column.name}</h2>
                )}
                <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                  {column.cards.length}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {column.duration_label || (column.key === COMPLETED_COLUMN_KEY ? "Finalizadas" : " ")}
                {overdueInColumn ? ` · ${overdueInColumn} em atraso` : ""}
                {pausedInColumn ? ` · ${pausedInColumn} pausada${pausedInColumn === 1 ? "" : "s"}` : ""}
                {canDescribe ? " · clique para ver a descrição" : ""}
              </p>
              {descriptionOpen ? (
                <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-5 text-ink">
                  {(column.description || "").trim() ? (
                    <p className="whitespace-pre-wrap">{column.description}</p>
                  ) : (
                    <p className="text-muted">Esta etapa ainda não tem descrição.</p>
                  )}
                </div>
              ) : null}
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {column.cards.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                  Solte um card aqui
                </p>
              ) : (
                column.cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    columns={columns}
                    onOpen={onOpen}
                    onMove={onMove}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
