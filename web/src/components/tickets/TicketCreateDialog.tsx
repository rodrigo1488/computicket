"use client";

import { Modal } from "@/components/ui/Modal";
import { TicketForm, type TicketFormDefaults } from "@/components/tickets/TicketForm";
import type { TicketDetail } from "@/lib/format";

export function TicketCreateDialog({
  open,
  onClose,
  defaults,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaults?: TicketFormDefaults;
  onCreated?: (created: TicketDetail) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Abrir ticket" wide>
      {open ? (
        <TicketForm
          defaults={defaults}
          embedded
          onCancel={onClose}
          onCreated={(created) => {
            onCreated?.(created);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}
