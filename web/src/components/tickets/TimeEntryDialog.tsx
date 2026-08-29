"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Valor interno: YYYY-MM-DDTHH:mm (Brasília / local) */
function localDatetime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Exibe 24h: DD/MM/YYYY HH:mm */
function toDisplay24(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!m) return value || "";
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

/** Aceita DD/MM/YYYY HH:mm (ou com /yy) e YYYY-MM-DDTHH:mm */
function fromDisplay24(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  let m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (m) {
    const [, dd, mm, yyyy, hh, min] = m;
    const h = Number(hh);
    if (h > 23) return null;
    return `${yyyy}-${mm}-${dd}T${pad(h)}:${min}`;
  }
  m = /^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (m) {
    const [, dd, mm, yy, hh, min] = m;
    const yyyy = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const h = Number(hh);
    if (h > 23) return null;
    return `${yyyy}-${mm}-${dd}T${pad(h)}:${min}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  return null;
}

function DateTime24Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(() => toDisplay24(value));

  useEffect(() => {
    setText(toDisplay24(value));
  }, [value]);

  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa hh:mm"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const parsed = fromDisplay24(next);
          if (parsed) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = fromDisplay24(text);
          if (parsed) {
            onChange(parsed);
            setText(toDisplay24(parsed));
          } else {
            setText(toDisplay24(value));
          }
        }}
        className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink placeholder:text-[#c5c5c5]"
      />
      <p className="mt-1 text-xs italic text-muted">Formato 24h — ex.: 29/08/2026 16:48</p>
    </label>
  );
}

type TicketTimes = {
  in_progress_started_at?: string | null;
  created_at_input?: string | null;
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const now = localDatetime(new Date());
    setEnd(now);
    setStart(now);
    setComment(mode === "stop" ? "Encerrado pelo botão" : "");
    setError("");
    setLoadingTimes(true);

    void flask
      .get<TicketTimes>(`/tickets/api/${ticketId}`)
      .then((ticket) => {
        if (cancelled) return;
        if (mode === "stop" && ticket.in_progress_started_at) {
          setStart(ticket.in_progress_started_at);
        } else {
          setStart(now);
        }
        setEnd(now);
      })
      .catch(() => {
        if (!cancelled) {
          setStart(now);
          setEnd(now);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTimes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, ticketId]);

  const save = async () => {
    setError("");
    if (!start || !end) {
      setError("Informe horário inicial e final no formato 24h (dd/mm/aaaa hh:mm).");
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
        <DateTime24Field label="Início" value={start} onChange={setStart} />
        <DateTime24Field label="Fim" value={end} onChange={setEnd} />
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
        {loadingTimes ? <p className="text-xs text-muted">Carregando horários…</p> : null}
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton onClick={() => void save()} disabled={saving || loadingTimes}>
          {saving ? "Salvando…" : mode === "stop" ? "Encerrar e apontar" : "Registrar apontamento"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
