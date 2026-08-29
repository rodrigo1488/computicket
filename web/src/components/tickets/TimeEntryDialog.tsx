"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localDatetime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TimeEntryDialog({
  open,
  onClose,
  ticketId,
  mode,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  ticketId: number;
  mode: "stop" | "add";
  onSaved: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    setEnd(localDatetime(now));
    setStart(localDatetime(hourAgo));
    setComment(mode === "stop" ? "Encerrado pelo botão" : "");
    setError("");
  }, [open, mode]);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      if (mode === "stop") {
        await flask.post(`/tickets/api/${ticketId}/stop`, { comment: comment.trim() || "Encerrado pelo botão" });
      } else {
        if (!start || !end) throw new Error("Informe horário inicial e final.");
        await flask.post(`/tickets/${ticketId}/apontar`, {
          start_time: start,
          end_time: end,
          comment: comment.trim(),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar apontamento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "stop" ? "Encerrar sessão" : "Incluir apontamento"}>
      <div className="space-y-5">
        {mode === "add" ? (
          <>
            <UnderlineField label="Início" value={start} onChange={setStart} type="datetime-local" />
            <UnderlineField label="Fim" value={end} onChange={setEnd} type="datetime-local" />
          </>
        ) : null}
        <label className="block">
          <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Comentário</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="O que foi feito nesta sessão"
            className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink"
          />
        </label>
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando…" : mode === "stop" ? "Encerrar e apontar" : "Registrar apontamento"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
