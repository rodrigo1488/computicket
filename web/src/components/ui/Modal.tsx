"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Modal({
  open,
  onClose,
  title,
  onBack,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onBack?: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        className={cn(
          "relative w-full rounded-2xl bg-surface p-6 shadow-2xl max-h-[90vh] overflow-y-auto",
          wide ? "max-w-2xl" : "max-w-[440px]",
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          {onBack ? (
            <button type="button" onClick={onBack} className="text-xl text-ink" aria-label="Voltar">
              ←
            </button>
          ) : (
            <span />
          )}
          <h2 className={`flex-1 text-lg font-semibold text-ink ${onBack ? "text-center" : ""}`}>{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
