"use client";

import { MessageCircle, UserPlus } from "lucide-react";
import { useState } from "react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/cn";
import type { ParsedVCard } from "@/lib/vcard";

export function ContactShareCard({
  contact,
  multi,
  onChat,
  onAdd,
  compact,
}: {
  contact: ParsedVCard;
  multi?: boolean;
  onChat?: (contact: ParsedVCard) => Promise<void> | void;
  onAdd?: (contact: ParsedVCard) => Promise<void> | void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"chat" | "add" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phone = contact.phones[0];
  const canAct = !!phone?.digits && (!!onChat || !!onAdd);

  async function run(kind: "chat" | "add", fn?: (c: ParsedVCard) => Promise<void> | void) {
    if (!fn || busy) return;
    setBusy(kind);
    setError(null);
    setFeedback(null);
    try {
      await fn(contact);
      setFeedback(kind === "chat" ? "Conversa aberta" : "Contato adicionado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        "min-w-[220px] overflow-hidden rounded-xl border border-line/80 bg-surface/90 text-ink",
        compact ? "max-w-[260px]" : "max-w-[280px]",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-3">
        {contact.photoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contact.photoDataUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <UserAvatar name={contact.name} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-navy">{contact.name}</p>
          {phone ? (
            <p className="mt-0.5 truncate text-xs text-muted">
              {phone.label ? `${phone.label} · ` : ""}
              {phone.number}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted">Contato compartilhado</p>
          )}
          {multi ? <p className="mt-0.5 text-[11px] text-muted">+ outros contatos</p> : null}
        </div>
      </div>

      {canAct ? (
        <div className="grid grid-cols-2 border-t border-line/80">
          <button
            type="button"
            disabled={!onChat || busy !== null || !phone}
            onClick={() => void run("chat", onChat)}
            className="inline-flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-semibold text-brand hover:bg-wash disabled:opacity-50"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {busy === "chat" ? "Abrindo…" : "Conversa"}
          </button>
          <button
            type="button"
            disabled={!onAdd || busy !== null || !phone}
            onClick={() => void run("add", onAdd)}
            className="inline-flex items-center justify-center gap-1.5 border-l border-line/80 px-2 py-2.5 text-xs font-semibold text-brand hover:bg-wash disabled:opacity-50"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {busy === "add" ? "Salvando…" : "Adicionar"}
          </button>
        </div>
      ) : null}

      {feedback ? <p className="border-t border-line/80 px-3 py-1.5 text-[11px] text-progress">{feedback}</p> : null}
      {error ? <p className="border-t border-line/80 px-3 py-1.5 text-[11px] text-open">{error}</p> : null}
    </div>
  );
}
