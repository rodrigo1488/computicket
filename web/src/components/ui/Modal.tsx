"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className={cn(
          "relative w-full rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto",
          wide ? "max-w-2xl" : "max-w-[440px]",
        )}
        onClick={(e) => e.stopPropagation()}
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
