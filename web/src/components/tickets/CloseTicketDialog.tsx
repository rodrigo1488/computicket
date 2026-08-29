"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductPicker, type PickedProduct } from "@/components/tickets/ProductPicker";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { formatBRL, formatHours, parseMoney, type TicketDetail } from "@/lib/format";

type Preview = {
  client_name: string;
  category: string;
  hours: number;
  hours_label?: string;
  hourly_rate: number;
  no_charge: boolean;
  charge_reason?: string;
  computed_total: number;
  forced_total: number;
  has_external_client: boolean;
  time_entries_count: number;
};

type CloseRes = {
  message?: string;
  total_cost?: number;
  no_charge?: boolean;
  contract_reason?: string;
  dav_codigo?: string | null;
};

type PrintRes = { message?: string; pdf_file?: string | null; ps_number?: string | null };

export function CloseTicketDialog({
  open,
  onClose,
  ticket,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  ticket: TicketDetail;
  onClosed: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [forceCharge, setForceCharge] = useState(false);
  const [manual, setManual] = useState("");
  const [picked, setPicked] = useState<PickedProduct[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [closed, setClosed] = useState<CloseRes | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState<PrintRes | null>(null);

  useEffect(() => {
    if (!open) return;
    setForceCharge(false);
    setManual("");
    setPicked([]);
    setError("");
    setClosed(null);
    setPrinted(null);
    flask
      .get<Preview>(`/tickets/api/${ticket.id}/close-preview`)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar fechamento"));
  }, [open, ticket.id]);

  const noCharge = Boolean(preview?.no_charge) && !forceCharge;
  const computed = useMemo(() => {
    if (!preview) return 0;
    if (noCharge) return 0;
    if (manual.trim()) return parseMoney(manual);
    return forceCharge ? preview.forced_total : preview.computed_total;
  }, [preview, noCharge, manual, forceCharge]);

  const confirm = async () => {
    if (!preview) return;
    if (!preview.time_entries_count) {
      setError("Adicione ao menos um apontamento antes de fechar o ticket.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await flask.post<CloseRes>(`/tickets/${ticket.id}/processar-fechamento`, {
        force_charge: forceCharge,
        manual_total_cost: manual.trim() ? parseMoney(manual) : null,
        produtos: picked.map((p) => ({ id: p.id, quantidade: p.quantidade })),
      });
      setClosed(res);
      onClosed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao fechar ticket");
    } finally {
      setSaving(false);
    }
  };

  const printPs = async () => {
    setError("");
    setPrinting(true);
    try {
      const amount = Number(closed?.total_cost || computed || 0);
      const res = await flask.post<PrintRes>("/printers", {
        reprint: false,
        body: {
          ticket_title: "Ticket",
          ticket_number: ticket.id,
          client_name: preview?.client_name || ticket.client_name,
          client_social_revenue: "",
          description_service: ticket.title || "Serviços prestados",
          total_amount: String(amount),
        },
      });
      setPrinted(res);
      if (res.pdf_file) {
        await flask.open(`/tickets/pdf/${encodeURIComponent(res.pdf_file)}`);
      }
      onClosed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao imprimir PS");
    } finally {
      setPrinting(false);
    }
  };

  const canPrint = Boolean(closed) && Number(closed?.total_cost || 0) > 0 && !closed?.no_charge;

  return (
    <Modal open={open} onClose={onClose} title={closed ? "Ticket fechado" : "Fechar ticket"} wide>
      {!preview && !error ? <p className="text-sm text-muted">Carregando resumo…</p> : null}
      {preview && !closed ? (
        <div className="space-y-5">
          <div className="grid gap-3 rounded-2xl border border-[#eee] p-4 text-sm md:grid-cols-2">
            <p>
              <span className="text-muted">Cliente</span>
              <br />
              <strong>{preview.client_name}</strong>
            </p>
            <p>
              <span className="text-muted">Serviço</span>
              <br />
              {preview.category}
            </p>
            <p>
              <span className="text-muted">Horas</span>
              <br />
              {preview.hours_label || formatHours(preview.hours)}
            </p>
            <p>
              <span className="text-muted">Valor/hora</span>
              <br />
              {formatBRL(preview.hourly_rate)}
            </p>
          </div>

          {preview.no_charge ? (
            <div className="rounded-xl bg-[#fff6e5] p-3 text-sm">
              <p className="font-medium text-ink">Sem cobrança</p>
              <p className="mt-1 text-muted">
                {preview.charge_reason || "Cliente com isenção de contrato."} O total será {formatBRL(0)}.
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-medium text-navy underline"
                onClick={() => setForceCharge((v) => !v)}
              >
                {forceCharge ? "Restaurar isenção automática" : "Cobrar mesmo assim"}
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-[#f6f8fb] p-3 text-sm">
              <p>
                {formatHours(preview.hours)} × {formatBRL(preview.hourly_rate)} ={" "}
                <strong>{formatBRL(preview.computed_total)}</strong>
              </p>
            </div>
          )}

          {(!preview.no_charge || forceCharge) && (
            <UnderlineField
              label="Valor manual (opcional)"
              value={manual}
              onChange={setManual}
              placeholder={formatBRL(forceCharge ? preview.forced_total : preview.computed_total)}
            />
          )}

          <p className="text-base font-semibold">
            Total a fechar: {formatBRL(computed)}
          </p>

          {preview.has_external_client ? (
            <ProductPicker searchPath="/tickets/produtos" picked={picked} onChange={setPicked} />
          ) : (
            <p className="text-xs text-muted">
              Sem cliente externo no ticket: produtos/DAV não serão gerados.
            </p>
          )}

          {error ? <p className="text-sm text-open">{error}</p> : null}
          <PrimaryButton onClick={() => void confirm()} disabled={saving || !preview.time_entries_count}>
            {saving ? "Fechando…" : "Confirmar fechamento"}
          </PrimaryButton>
          {!preview.time_entries_count ? (
            <p className="text-xs text-open">Inclua ao menos um apontamento antes de fechar.</p>
          ) : null}
        </div>
      ) : null}

      {closed ? (
        <div className="space-y-4 text-sm">
          <p className="text-done">{closed.message || "Ticket fechado com sucesso."}</p>
          {closed.contract_reason ? <p className="text-muted">{closed.contract_reason}</p> : null}
          <p>
            Total: <strong>{formatBRL(closed.total_cost)}</strong>
            {closed.dav_codigo ? ` · Pedido #${closed.dav_codigo}` : ""}
          </p>
          {printed ? (
            <p className="text-done">
              PS {printed.ps_number || ""} gerada.
              {printed.pdf_file ? " O PDF foi aberto em outra aba." : ""}
            </p>
          ) : null}
          {error ? <p className="text-sm text-open">{error}</p> : null}
          {canPrint && !printed ? (
            <PrimaryButton onClick={() => void printPs()} disabled={printing}>
              {printing ? "Gerando PS…" : "Imprimir PS"}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onClose}>Concluir</PrimaryButton>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
