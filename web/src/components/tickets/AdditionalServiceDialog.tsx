"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { parseMoney } from "@/lib/format";

export function AdditionalServiceDialog({
  open,
  onClose,
  ticketId,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  ticketId: number;
  initial?: { id?: number; description: string; value: number };
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(initial?.description || "");
  const [value, setValue] = useState(
    initial?.value != null ? initial.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const payload = { description, value: parseMoney(value.startsWith("R$") ? value : `R$ ${value}`) };
      if (initial?.id) {
        await flask.patch(`/tickets/api/${ticketId}/addons/${initial.id}`, payload);
      } else {
        await flask.post(`/tickets/api/${ticketId}/addons`, payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Serviço adicional">
      <div className="space-y-6">
        <UnderlineField label="Descrição" value={description} onChange={setDescription} />
        <UnderlineField
          label="Valor"
          value={value}
          onChange={setValue}
          placeholder="R$ 0,00"
        />
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton onClick={save} disabled={saving || !description.trim()}>
          Salvar
        </PrimaryButton>
      </div>
    </Modal>
  );
}
