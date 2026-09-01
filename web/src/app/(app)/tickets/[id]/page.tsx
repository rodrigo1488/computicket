"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Clock, Hand, MessageCircle, Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AdditionalServiceDialog } from "@/components/tickets/AdditionalServiceDialog";
import { CancelTicketDialog } from "@/components/tickets/CancelTicketDialog";
import { CloseTicketDialog } from "@/components/tickets/CloseTicketDialog";
import { TimeEntryDialog } from "@/components/tickets/TimeEntryDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatBRL, formatHours, type TicketDetail } from "@/lib/format";

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [addonOpen, setAddonOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"stop" | "add" | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [err, setErr] = useState("");
  const [printing, setPrinting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => flask.get<TicketDetail>(`/tickets/api/${id}`),
    enabled: Number.isFinite(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ticket", id] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };

  const start = useMutation({
    mutationFn: () => flask.post(`/tickets/api/${id}/start`),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });
  const assume = useMutation({
    mutationFn: () => flask.post(`/tickets/api/${id}/assume`),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });
  const cancelTicket = useMutation({
    mutationFn: (reason: string) => flask.post<{ message?: string }>(`/tickets/api/${id}/cancel`, { reason }),
    onSuccess: (result) => {
      setCancelOpen(false);
      setCancelReason("");
      invalidate();
      if (result.message) window.alert(result.message);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const removeAddon = async (addonId: number) => {
    await flask.delete(`/tickets/api/${id}/addons/${addonId}`);
    invalidate();
  };

  const printPs = async () => {
    if (!data) return;
    setErr("");
    setPrinting(true);
    try {
      const res = await flask.post<{ pdf_file?: string }>(`/printers`, {
        reprint: false,
        body: {
          ticket_title: "Ticket",
          ticket_number: data.id,
          client_name: data.client_name,
          client_social_revenue: "",
          description_service: data.title || "Serviços prestados",
          total_amount: String(data.total_cost || 0),
        },
      });
      invalidate();
      if (res.pdf_file) await flask.open(`/tickets/pdf/${encodeURIComponent(res.pdf_file)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao imprimir PS");
    } finally {
      setPrinting(false);
    }
  };

  if (isLoading || !data) {
    return <p className="text-muted">Carregando chamado…</p>;
  }

  const uid = user?.id;
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const mine = data.assigned_to_id === uid;
  const openedByMe = data.opened_by_id === uid;
  const openTicket = data.status !== "fechado" && data.status !== "cancelado";
  const canCancelOpen = openTicket && (isAdmin || mine || openedByMe);
  const canCancelClosed = isAdmin && data.status === "fechado";
  const entries = data.time_entries || [];
  const canClose = openTicket && entries.length > 0;
  const canPrint =
    data.status === "fechado" && Number(data.total_cost || 0) > 0 && !data.ps_printed && !data.no_charge;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => router.push("/tickets")}
            className="mb-3 text-sm text-muted hover:text-ink"
          >
            ← Voltar
          </button>
          <h1 className="text-[28px] font-semibold text-navy">Ticket #{data.id}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.status === "aberto" && mine ? (
            <button
              type="button"
              onClick={() => start.mutate()}
              className="inline-flex items-center gap-2 rounded-xl bg-inverse px-4 py-2.5 text-sm font-medium text-on-inverse"
            >
              <Clock className="h-4 w-4" />
              Iniciar
            </button>
          ) : null}
          {openTicket && !mine ? (
            <button
              type="button"
              onClick={() => assume.mutate()}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink"
            >
              <Hand className="h-4 w-4" />
              Assumir
            </button>
          ) : null}
          {data.status === "em_andamento" && mine ? (
            <button
              type="button"
              onClick={() => setEntryMode("stop")}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink"
            >
              Encerrar sessão
            </button>
          ) : null}
          {openTicket ? (
            <button
              type="button"
              onClick={() => setEntryMode("add")}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink"
            >
              Incluir apontamento
            </button>
          ) : null}
          {openTicket ? (
            <button
              type="button"
              disabled={!canClose}
              title={!canClose ? "Adicione ao menos um apontamento antes de fechar" : undefined}
              onClick={() => canClose && setCloseOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
              Fechar
            </button>
          ) : null}
          {canCancelOpen || canCancelClosed ? (
            <button
              type="button"
              onClick={() => {
                setErr("");
                setCancelReason("");
                setCancelOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-open/30 bg-open-bg px-4 py-2.5 text-sm font-medium text-open"
            >
              <Ban className="h-4 w-4" />
              Cancelar
            </button>
          ) : null}
          {canPrint ? (
            <button
              type="button"
              disabled={printing}
              onClick={() => void printPs()}
              className="inline-flex items-center gap-2 rounded-xl bg-inverse px-4 py-2.5 text-sm font-medium text-on-inverse"
            >
              <Printer className="h-4 w-4" />
              {printing ? "Gerando PS…" : "Imprimir PS"}
            </button>
          ) : null}
        </div>
      </div>
      {err ? <p className="mb-4 text-sm text-open">{err}</p> : null}
      {data.helpdesk_conversation?.engine_ticket_id ? (
        <Link
          href={data.helpdesk_conversation.href || `/helpdesk?c=${data.helpdesk_conversation.engine_ticket_id}`}
          className="mb-4 flex items-center gap-3 rounded-2xl border border-progress/30 bg-progress-bg px-4 py-3 text-sm text-ink hover:bg-progress-bg"
        >
          <MessageCircle className="h-4 w-4 shrink-0 text-brand" />
          <span className="min-w-0">
            <span className="block font-medium text-navy">Conversa WhatsApp #{data.helpdesk_conversation.engine_ticket_id}</span>
            <span className="block truncate text-muted">
              {data.helpdesk_conversation.contact_name || data.helpdesk_conversation.contact_number || "Abrir no Help Desk"}
              {data.helpdesk_conversation.contact_name && data.helpdesk_conversation.contact_number
                ? ` · ${data.helpdesk_conversation.contact_number}`
                : ""}
            </span>
          </span>
        </Link>
      ) : null}
      {!canClose && openTicket ? (
        <p className="mb-4 text-sm text-muted">Inclua ao menos um apontamento para fechar este ticket.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-line p-6">
            <div className="flex items-center justify-between">
              <span className="text-muted">{data.code}</span>
              <StatusBadge status={data.status} />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-ink">{data.title}</h2>
            <p className="mt-4 text-[13px] uppercase tracking-wide text-muted">Descrição</p>
            <p className="mt-1 whitespace-pre-wrap text-[15px] text-ink">{data.description || "—"}</p>
            <p className="mt-5 text-[13px] uppercase tracking-wide text-muted">Categoria</p>
            <p className="mt-1 text-[15px]">{data.category}</p>
            <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="uppercase tracking-wide text-muted">Criado em</p>
                <p className="mt-1">{data.created_at}</p>
              </div>
              <div>
                <p className="uppercase tracking-wide text-muted">Atualizado em</p>
                <p className="mt-1">{data.updated_at}</p>
              </div>
            </div>
            <p className="mt-5 text-[13px] uppercase tracking-wide text-muted">Cliente</p>
            <div className="mt-2 flex items-center gap-2">
              <UserAvatar name={data.client_name} size="sm" />
              <span>{data.client_name}</span>
            </div>
            {data.no_charge ? (
              <p className="mt-4 rounded-xl bg-warn-bg px-3 py-2 text-sm">
                {data.charge_reason || "Cliente com isenção de contrato — sem cobrança no fechamento."}
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-line p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Apontamentos</h3>
              {openTicket ? (
                <button
                  type="button"
                  onClick={() => setEntryMode("add")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-inverse text-on-inverse"
                  aria-label="Incluir apontamento"
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-line">
              {entries.map((e) => (
                <li key={e.id} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">{e.user_name || "Usuário"}</p>
                      <p className="text-muted">
                        {e.start_time || "—"} → {e.end_time || "—"}
                      </p>
                      {e.comment ? <p className="mt-1 text-ink">{e.comment}</p> : null}
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{e.hours_label || formatHours(e.hours)}</p>
                      {e.no_charge ? <p className="text-xs text-muted">sem cobrança</p> : null}
                    </div>
                  </div>
                </li>
              ))}
              {!entries.length ? <li className="py-3 text-sm text-muted">Nenhum apontamento</li> : null}
            </ul>
          </section>

          <section className="rounded-2xl border border-line p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Serviços adicionais</h3>
              {openTicket ? (
                <button
                  type="button"
                  onClick={() => setAddonOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-inverse text-on-inverse"
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-line">
              {(data.addons || []).map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <span>{a.description}</span>
                  <span className="flex items-center gap-4">
                    <span>{formatBRL(a.value)}</span>
                    {openTicket ? (
                      <button
                        type="button"
                        onClick={() => removeAddon(a.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-open-bg text-open"
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
              {!data.addons?.length ? <li className="py-3 text-sm text-muted">Nenhum serviço adicional</li> : null}
            </ul>
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-line p-6">
          <p className="text-[13px] uppercase tracking-wide text-muted">Técnico responsável</p>
          {data.technician ? (
            <div className="mt-3 flex items-center gap-3">
              <UserAvatar name={data.technician.name} />
              <div>
                <p className="font-medium">{data.technician.name}</p>
                <p className="text-sm text-muted">{data.technician.email}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Não atribuído</p>
          )}
          <p className="mt-8 text-[13px] uppercase tracking-wide text-muted">Valores</p>
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Horas</span>
              <span>{data.hours_label || formatHours(data.hours)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Valor/hora</span>
              <span>{formatBRL(data.hourly_rate)}</span>
            </div>
            {data.should_show_costs !== false ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">Adicionais</span>
                  <span>{formatBRL(data.addons_total)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
                  <span>{data.status === "fechado" ? "Total fechado" : "Estimativa"}</span>
                  <span>{formatBRL(data.status === "fechado" ? data.total_cost : data.hours && data.hourly_rate ? data.hours * data.hourly_rate : data.total)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
                <span>Total</span>
                <span>{formatBRL(0)}</span>
              </div>
            )}
            {data.ps_number ? (
              <p className="text-xs text-muted">PS {data.ps_number}</p>
            ) : null}
          </div>
          <Link href={`/tickets/${id}/editar`} className="mt-6 inline-block text-sm text-brand">
            Editar chamado
          </Link>
        </aside>
      </div>

      <AdditionalServiceDialog
        open={addonOpen}
        onClose={() => setAddonOpen(false)}
        ticketId={id}
        onSaved={invalidate}
      />
      <TimeEntryDialog
        open={!!entryMode}
        onClose={() => setEntryMode(null)}
        ticketId={id}
        mode={entryMode || "add"}
        onSaved={invalidate}
      />
      <CloseTicketDialog open={closeOpen} onClose={() => setCloseOpen(false)} ticket={data} onClosed={invalidate} />
      <CancelTicketDialog
        ticket={cancelOpen ? data : null}
        reason={cancelReason}
        pending={cancelTicket.isPending}
        onReason={setCancelReason}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancelTicket.mutate(cancelReason.trim())}
      />
    </div>
  );
}
