"use client";

import { CalendarClock, Clock, Pause, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ImplantationCard, KanbanColumn } from "@/components/implantacao/types";
import { COMPLETED_COLUMN_KEY } from "@/components/implantacao/types";

export function KanbanCard({
  card,
  onOpen,
  onMove,
  columns,
}: {
  card: ImplantationCard;
  onOpen: (card: ImplantationCard) => void;
  onMove: (cardId: number, columnKey: string) => void;
  columns: KanbanColumn[];
}) {
  const overdue = card.status === "in_progress" && card.overdue;
  const paused = card.status === "paused";
  const canMove = card.status === "in_progress" || card.status === "completed";

  return (
    <article
      draggable={canMove}
      onDragStart={(e) => {
        if (!canMove) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", String(card.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(card)}
      className={cn(
        "cursor-pointer rounded-xl border bg-surface p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:shadow-md",
        overdue ? "border-open" : paused ? "border-warn-fg/40" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold leading-snug text-ink">{card.external_client_name}</h3>
        {overdue ? (
          <span className="shrink-0 rounded-md bg-open-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-open">
            Atraso
          </span>
        ) : paused ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warn-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn-fg">
            <Pause className="h-3 w-3" />
            Pausada
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-muted">{card.system_name || card.model_name}</p>
      <p className="mt-2 inline-flex items-center gap-1 text-xs text-ink">
        <UserRound className="h-3 w-3 text-muted" />
        {card.current_assignee_name || "Sem técnico"}
      </p>
      <p
        className={cn(
          "mt-1 inline-flex items-center gap-1 text-xs",
          overdue ? "text-open" : paused ? "text-warn-fg" : "text-muted",
        )}
      >
        {paused ? <Pause className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        {paused && card.paused_for_label ? card.paused_for_label : card.due_label || "—"}
      </p>
      {card.scheduled_at_label ? (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-progress">
          <CalendarClock className="h-3 w-3" />
          {card.scheduled_step_name || "Próxima etapa"} · {card.scheduled_at_label}
        </p>
      ) : null}
      <label className="mt-3 block" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Mover para</span>
        <select
          disabled={!canMove}
          value={card.status === "completed" ? COMPLETED_COLUMN_KEY : String(card.current_step_id || "")}
          onChange={(e) => onMove(card.id, e.target.value)}
          className="w-full rounded-lg border border-line bg-wash px-2 py-1 text-[12px] text-ink disabled:opacity-60"
        >
          {columns.map((col) => (
            <option key={col.key} value={col.key}>
              {col.name}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
