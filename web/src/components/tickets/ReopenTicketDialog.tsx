"use client";

import { Modal } from "@/components/ui/Modal";

type ReopenTarget = {
  id: number;
  title: string;
};

export function ReopenTicketDialog({
  ticket,
  reason,
  pending,
  onReason,
  onClose,
  onConfirm,
}: {
  ticket: ReopenTarget | null;
  reason: string;
  pending: boolean;
  onReason: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={!!ticket}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Reabrir ticket"
    >
      {ticket ? (
        <div>
          <div className="rounded-xl bg-progress-bg p-4 text-sm text-progress">
            <p className="font-semibold">
              Ticket #{ticket.id} · {ticket.title}
            </p>
            <p className="mt-1 text-ink">
              O ticket voltará para o status aberto. Só é possível reabrir tickets fechados há menos de 7 dias.
            </p>
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Motivo (opcional)</span>
            <textarea
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              rows={3}
              disabled={pending}
              placeholder="Por que este ticket precisa ser reaberto?"
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
              className="rounded-xl bg-inverse px-4 py-2 text-sm font-medium text-on-inverse disabled:opacity-60"
            >
              {pending ? "Reabrindo…" : "Reabrir ticket"}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
