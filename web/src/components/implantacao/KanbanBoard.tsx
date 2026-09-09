"use client";

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
  return (
    <div className="flex min-h-[62vh] gap-3 overflow-x-auto pb-4">
      {columns.map((column) => {
        const overdueInColumn = column.cards.filter((c) => c.overdue && c.status === "in_progress").length;
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
                <h2 className="text-sm font-semibold text-navy">{column.name}</h2>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                  {column.cards.length}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {column.duration_label || (column.key === COMPLETED_COLUMN_KEY ? "Finalizadas" : " ")}
                {overdueInColumn ? ` · ${overdueInColumn} em atraso` : ""}
              </p>
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
