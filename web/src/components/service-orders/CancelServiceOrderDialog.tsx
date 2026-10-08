"use client";

import { Modal } from "@/components/ui/Modal";

export type CancelServiceOrderTarget = {
  id: number;
  codigo: string;
  client_name: string;
  ps_number?: string | null;
};

export function CancelServiceOrderDialog({
  order,
  reason,
  pending,
  error,
  onReason,
  onClose,
  onConfirm,
}: {
  order: CancelServiceOrderTarget | null;
  reason: string;
  pending: boolean;
  /** Mensagem do backend (inclui falha do Unico); a OS permanece intacta nesses casos. */
  error?: string;
  onReason: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={!!order}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Cancelar ordem de serviço"
    >
      {order ? (
        <div>
          <div className="rounded-xl bg-open-bg p-4 text-sm text-open">
            <p className="font-semibold">
              OS {order.codigo} · {order.client_name}
            </p>
            <p className="mt-1">
              A OS será marcada como cancelada e a movimentação financeira
              {order.ps_number ? ` (PS ${order.ps_number})` : ""} será <strong>excluída no Unico e no Computicket</strong>.
              Esta ação não pode ser desfeita.
            </p>
            {!order.ps_number ? (
              <p className="mt-1">Esta OS não possui PS registrada; apenas o cancelamento será gravado.</p>
            ) : null}
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Motivo (obrigatório)</span>
            <textarea
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              rows={3}
              disabled={pending}
              required
              placeholder="Informe o motivo do cancelamento…"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </label>
          {error ? <p className="mt-3 text-sm text-open">{error}</p> : null}
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
              disabled={pending || !reason.trim()}
              onClick={onConfirm}
              className="rounded-xl bg-open px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Cancelando…" : "Cancelar OS e excluir movimentação"}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
