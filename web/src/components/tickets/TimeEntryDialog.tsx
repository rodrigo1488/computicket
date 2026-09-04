"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Valor para input datetime-local: YYYY-MM-DDTHH:mm (fuso local) */
function localDatetime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Normaliza ISO / datetime-local para YYYY-MM-DDTHH:mm */
function toDatetimeLocal(value: string) {
  const text = (value || "").trim();
  if (!text) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return "";
  return localDatetime(new Date(parsed));
}

type TicketTimes = {
  id?: number;
  in_progress_started_at?: string | null;
  created_at_input?: string | null;
  helpdesk_linked_at?: string | null;
};

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
  const [loadingTimes, setLoadingTimes] = useState(false);
  const loadGeneration = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const generation = ++loadGeneration.current;
    const requestedTicketId = ticketId;
    const now = localDatetime(new Date());
    setEnd(now);
    setStart(now);
    setComment(mode === "stop" ? "Encerrado pelo botão" : "");
    setError("");
    setLoadingTimes(true);

    const isCurrent = () =>
      !cancelled && generation === loadGeneration.current && requestedTicketId === ticketId;

    void flask
      .get<TicketTimes>(`/tickets/api/${requestedTicketId}?_=${generation}`)
      .then((ticket) => {
        if (!isCurrent()) return;
        if (ticket.id != null && ticket.id !== requestedTicketId) return;
        if (mode === "stop" && ticket.in_progress_started_at) {
          setStart(toDatetimeLocal(ticket.in_progress_started_at) || now);
        } else if (mode === "add" && ticket.helpdesk_linked_at) {
          setStart(toDatetimeLocal(ticket.helpdesk_linked_at) || now);
        } else {
          setStart(now);
        }
        setEnd(now);
      })
      .catch(() => {
        if (isCurrent()) {
          setStart(now);
          setEnd(now);
        }
      })
      .finally(() => {
        if (isCurrent()) setLoadingTimes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, ticketId]);

  const save = async () => {
    setError("");
    if (!start || !end) {
      setError("Informe horário inicial e final.");
      return;
    }
    if (start > end) {
      setError("Horário final deve ser após o início.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "stop") {
        await flask.post(`/tickets/api/${ticketId}/stop`, {
          comment: comment.trim() || "Encerrado pelo botão",
          start_time: start,
          end_time: end,
        });
      } else {
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
        <UnderlineField label="Início" type="datetime-local" value={start} onChange={setStart} />
        <UnderlineField label="Fim" type="datetime-local" value={end} onChange={setEnd} />
        <label className="block">
          <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Comentário</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="O que foi feito nesta sessão"
            className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
          />
        </label>
        {loadingTimes ? <p className="text-xs text-muted">Carregando horários…</p> : null}
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton onClick={() => void save()} disabled={saving || loadingTimes}>
          {saving ? "Salvando…" : mode === "stop" ? "Encerrar e apontar" : "Registrar apontamento"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
