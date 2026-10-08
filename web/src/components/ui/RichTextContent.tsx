"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { sanitizeRichHtml } from "@/lib/rich-text";

/**
 * Exibe texto rico (HTML ou texto puro legado) de forma segura.
 * O HTML é SEMPRE sanitizado (DOMPurify + whitelist) antes de ir para o DOM; no SSR
 * nada é renderizado e o conteúdo aparece após a montagem no cliente.
 */
export function RichTextContent({
  html,
  className,
  fallback = null,
}: {
  html?: string | null;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const clean = mounted ? sanitizeRichHtml(html) : "";
  if (mounted && !clean) return <>{fallback}</>;
  return (
    <div
      className={cn("rich-text text-sm text-ink", className)}
      // conteúdo sanitizado por DOMPurify (whitelist de tags/atributos/estilos) logo acima
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
