"use client";

import { BookOpen, KeyRound, MessageCircle, Ticket } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { chatShareKindLabel, type ChatSharePayload } from "@/lib/chat-share";

const ICONS = {
  ticket: Ticket,
  knowledge: BookOpen,
  vault: KeyRound,
  helpdesk: MessageCircle,
};

export function SharedEntityCard({
  payload,
  note,
  compact,
}: {
  payload: ChatSharePayload;
  note?: string;
  compact?: boolean;
}) {
  const Icon = ICONS[payload.kind] || Ticket;
  return (
    <div
      className={cn(
        "min-w-[200px] overflow-hidden rounded-xl border border-line/80 bg-surface text-ink shadow-sm",
        compact && "max-w-[240px]",
      )}
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wash text-brand">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{chatShareKindLabel(payload.kind)}</p>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-navy">{payload.title}</p>
          {payload.subtitle ? <p className="mt-0.5 truncate text-xs text-muted">{payload.subtitle}</p> : null}
          {payload.status ? <p className="mt-0.5 text-[11px] text-muted">{payload.status}</p> : null}
        </div>
      </div>
      {note ? <p className="border-t border-line/80 px-3 py-2 text-xs whitespace-pre-wrap text-ink">{note}</p> : null}
      <Link
        href={payload.url}
        className="block border-t border-line/80 px-3 py-2 text-center text-xs font-semibold text-brand hover:bg-wash"
      >
        Abrir
      </Link>
    </div>
  );
}
