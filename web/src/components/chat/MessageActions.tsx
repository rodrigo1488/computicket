"use client";

import { Pencil, Reply, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function MessageActions({
  align = "end",
  tone = "default",
  canReply,
  canEdit,
  canDelete,
  onReply,
  onEdit,
  onDelete,
}: {
  align?: "start" | "end";
  tone?: "default" | "onBrand";
  canReply?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  if (!canReply && !canEdit && !canDelete) return null;
  const btn =
    tone === "onBrand"
      ? "text-white/80 hover:bg-white/15 hover:text-white"
      : "text-muted hover:bg-wash hover:text-ink";
  return (
    <div
      className={cn(
        "absolute top-0 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-surface px-0.5 py-0.5 shadow-sm opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
        align === "end" ? "right-2" : "left-2",
        tone === "onBrand" && "border-white/20 bg-brand",
      )}
    >
      {canReply ? (
        <button type="button" className={cn("rounded p-1", btn)} title="Responder" onClick={onReply}>
          <Reply className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {canEdit ? (
        <button type="button" className={cn("rounded p-1", btn)} title="Editar" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {canDelete ? (
        <button type="button" className={cn("rounded p-1", btn, tone !== "onBrand" && "hover:text-open")} title="Excluir" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function ComposerContextBanner({
  title,
  preview,
  onClear,
}: {
  title: string;
  preview?: string;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand bg-wash px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-brand">{title}</p>
        {preview ? <p className="truncate text-xs text-muted">{preview}</p> : null}
      </div>
      <button type="button" onClick={onClear} className="text-muted hover:text-ink" aria-label="Cancelar">
        <span className="text-sm leading-none">×</span>
      </button>
    </div>
  );
}
