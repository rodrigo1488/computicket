"use client";

import { Check, Clock, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusIcon } from "@/components/ui/StatusBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatBRL, type TicketCard } from "@/lib/format";

export function TicketCard({
  ticket,
  onStart,
  onClose,
  busy,
}: {
  ticket: TicketCard;
  onStart?: (id: number) => void;
  onClose?: (id: number) => void;
  busy?: boolean;
}) {
  const router = useRouter();
  const goDetail = () => router.push(`/tickets/${ticket.id}`);
  const goEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/tickets/${ticket.id}/editar`);
  };

  return (
    <article
      onClick={goDetail}
      className="flex min-h-[168px] cursor-pointer flex-col rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-muted">{ticket.code}</span>
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={goEdit}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-muted hover:bg-line"
            aria-label="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {ticket.status === "aberto" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onStart?.(ticket.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-[13px] font-medium text-on-inverse disabled:opacity-60"
            >
              <Clock className="h-3.5 w-3.5" />
              Iniciar
            </button>
          )}
          {ticket.status === "em_andamento" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onClose?.(ticket.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-[13px] font-medium text-on-inverse disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" />
              Encerrar
            </button>
          )}
        </div>
      </div>

      <h3 className="mt-3 text-[17px] font-semibold leading-snug text-ink">{ticket.title}</h3>
      <p className="mt-0.5 text-sm text-muted">
        {ticket.category}
        {ticket.assigned_to_name ? ` · ${ticket.assigned_to_name}` : " · Sem técnico"}
      </p>

      <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
        <span>{ticket.created_at}</span>
        <span className="font-medium text-ink">{formatBRL(ticket.base_price)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <UserAvatar name={ticket.client_name} size="sm" />
          <span className="text-sm text-navy">{ticket.client_name}</span>
        </div>
        <StatusIcon status={ticket.status} />
      </div>
    </article>
  );
}
