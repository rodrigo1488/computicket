"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes, asItems } from "@/lib/api";
import type { TicketDetail } from "@/lib/format";

type Client = { id: number; name: string };
type Service = { id: number; name: string; hourly_rate: number };
type UserRow = { id: number; name: string };

export type TicketFormDefaults = {
  title?: string;
  description?: string;
  solicitante?: string;
  clientQuery?: string;
};

export function TicketForm({
  ticket,
  defaults,
  embedded,
  onCreated,
  onCancel,
}: {
  ticket?: TicketDetail;
  defaults?: TicketFormDefaults;
  embedded?: boolean;
  onCreated?: (created: TicketDetail) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(ticket?.title || defaults?.title || "");
  const [description, setDescription] = useState(ticket?.description || defaults?.description || "");
  const [solicitante, setSolicitante] = useState(ticket?.solicitante || defaults?.solicitante || "");
  const [clientId, setClientId] = useState<string>(ticket?.external_client_id ? String(ticket.external_client_id) : "");
  const [serviceId, setServiceId] = useState<string>(ticket?.service_id ? String(ticket.service_id) : "");
  const [assigned, setAssigned] = useState<string>(ticket?.technician?.id ? String(ticket.technician.id) : "");
  const [q, setQ] = useState(defaults?.clientQuery || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [contractMsg, setContractMsg] = useState("");

  const clients = useQuery({
    queryKey: ["clients", q],
    queryFn: () => flask.get<{ items: Client[] }>(`/api/web/clients?q=${encodeURIComponent(q)}&per_page=30`),
  });
  const services = useQuery({
    queryKey: ["services"],
    queryFn: () => flask.get<PageRes<Service> | Service[]>("/api/web/services?per_page=200"),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => flask.get<PageRes<UserRow> | UserRow[]>("/api/web/users?status=1&per_page=200"),
  });

  useEffect(() => {
    if (ticket) {
      setTitle(ticket.title);
      setDescription(ticket.description || "");
      setSolicitante(ticket.solicitante || "");
      return;
    }
    if (defaults) return;
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const fromChat = sp.get("title");
    if (!fromChat) return;
    setTitle(fromChat);
    setDescription(sp.get("description") || "");
    setSolicitante(sp.get("client_name") || sp.get("pg_client_name") || "");
    const qClient = sp.get("pg_client_name") || sp.get("client_name") || "";
    if (qClient) setQ(qClient);
  }, [ticket, defaults]);

  useEffect(() => {
    if (!clientId || !serviceId) {
      setContractMsg("");
      return;
    }
    let cancelled = false;
    flask
      .get<{ has_contract?: boolean }>(
        `/tickets/api/check-service-contract?client_id=${clientId}&service_id=${serviceId}`,
      )
      .then((res) => {
        if (cancelled) return;
        setContractMsg(
          res.has_contract
            ? "Este serviço está contemplado pelo contrato do cliente. O fechamento não gerará cobrança, salvo se você escolher cobrar mesmo assim."
            : "",
        );
      })
      .catch(() => {
        if (!cancelled) setContractMsg("");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, serviceId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      title,
      description,
      solicitante,
      external_client_id: clientId ? Number(clientId) : null,
      service_id: serviceId ? Number(serviceId) : null,
      assigned_to_id: assigned ? Number(assigned) : null,
    };
    try {
      if (ticket) {
        await flask.patch(`/tickets/api/${ticket.id}`, payload);
        router.push(`/tickets/${ticket.id}`);
      } else {
        const created = await flask.post<TicketDetail>("/tickets/api", payload);
        if (onCreated) onCreated(created);
        else router.push(`/tickets/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className={embedded ? "space-y-5" : "mx-auto max-w-xl space-y-6"}>
      <UnderlineField label="Título" value={title} onChange={setTitle} placeholder="Resumo do chamado" />
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Descrição</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={embedded ? 3 : 4}
          className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px]"
        />
      </label>
      <UnderlineField label="Solicitante" value={solicitante} onChange={setSolicitante} />
      <UnderlineField label="Buscar cliente" value={q} onChange={setQ} placeholder="Nome do cliente" />
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Cliente</span>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2"
        >
          <option value="">Selecione</option>
          {(clients.data?.items || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Categoria</span>
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2"
        >
          <option value="">Selecione</option>
          {asItems(services.data).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {contractMsg ? (
        <div className="rounded-xl bg-[#fff6e5] px-3 py-2 text-sm text-ink">{contractMsg}</div>
      ) : null}
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Técnico</span>
        <select
          value={assigned}
          onChange={(e) => setAssigned(e.target.value)}
          className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2"
        >
          <option value="">Não atribuído</option>
          {asItems(users.data).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-open">{error}</p> : null}
      <div className={onCancel ? "flex gap-2" : undefined}>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[#e5e7eb] py-3.5 text-[15px] font-medium text-ink"
          >
            Cancelar
          </button>
        ) : null}
        <PrimaryButton type="submit" disabled={saving} className={onCancel ? "flex-1" : undefined}>
          {saving ? "Salvando…" : ticket ? "Salvar" : "Criar ticket"}
        </PrimaryButton>
      </div>
    </form>
  );
}
