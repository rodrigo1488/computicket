"use client";

import { Modal } from "@/components/ui/Modal";

type CancelTarget = {
  id: number;
  title: string;
  status: string;
  ps_number?: string | null;
};

export function CancelTicketDialog({
  ticket,
  reason,
  pending,
  onReason,
  onClose,
  onConfirm,
}: {
  ticket: CancelTarget | null;
  reason: string;
  pending: boolean;
  onReason: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const closed = ticket?.status === "fechado";
  return (
    <Modal
      open={!!ticket}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={closed ? "Cancelar ticket fechado" : "Cancelar ticket"}
    >
      {ticket ? (
        <div>
          <div className="rounded-xl bg-open-bg p-4 text-sm text-open">
            <p className="font-semibold">
              Ticket #{ticket.id} · {ticket.title}
            </p>
            <p className="mt-1">
              {closed
                ? "O ticket será marcado como cancelado. Apontamentos e valor serão preservados para auditoria."
                : "O ticket será marcado como cancelado. Apontamentos já lançados ficam no histórico; a sessão em andamento é encerrada sem gerar um novo apontamento."}
              {ticket.ps_number ? ` A PS ${ticket.ps_number} será removida do Unico.` : ""}
            </p>
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Motivo (opcional)</span>
            <textarea
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              rows={3}
              disabled={pending}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2 text-sm"
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="rounded-xl bg-open px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Cancelando…" : "Confirmar cancelamento"}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
