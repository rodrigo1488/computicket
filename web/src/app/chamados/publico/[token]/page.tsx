"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { flask } from "@/lib/api";
import type { TicketStatus } from "@/lib/format";

type PublicTicket = {
  id: number;
  code: string;
  title: string;
  description: string;
  status: TicketStatus;
  client_name: string;
  solicitante: string;
  service_name: string;
  assigned_to_name: string;
  created_at: string | null;
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function PublicTicketPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<PublicTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then(({ token: value }) => setToken(value));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    flask
      .get<PublicTicket>(`/tickets/api/publico/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Chamado não encontrado."))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <main className="flex h-full min-h-0 items-start justify-center overflow-y-auto bg-canvas px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl bg-surface p-7 shadow-[0_20px_70px_rgba(15,23,42,0.12)] sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">
            C
          </div>
          <div>
            <p className="font-semibold text-navy">Computicket</p>
            <p className="text-xs text-muted">Chamado atribuído a você</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-muted">Carregando chamado…</p> : null}

        {!loading && (error || !data) ? (
          <div className="rounded-2xl bg-open-bg p-4 text-sm text-open">
            {error || "Chamado não encontrado."}
          </div>
        ) : null}

        {!loading && data ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-brand">#{data.code}</p>
              <StatusBadge status={data.status} />
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-navy">{data.title}</h1>
            <p className="mt-2 text-sm text-muted">{formatWhen(data.created_at)}</p>

            <dl className="mt-6 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Cliente</dt>
                <dd className="mt-1 font-medium text-ink">{data.client_name || "—"}</dd>
              </div>
              {data.solicitante ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Solicitante</dt>
                  <dd className="mt-1 text-ink">{data.solicitante}</dd>
                </div>
              ) : null}
              {data.service_name ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Serviço</dt>
                  <dd className="mt-1 text-ink">{data.service_name}</dd>
                </div>
              ) : null}
              {data.assigned_to_name ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Técnico</dt>
                  <dd className="mt-1 text-ink">{data.assigned_to_name}</dd>
                </div>
              ) : null}
            </dl>

            {data.description ? (
              <div className="mt-6 rounded-2xl bg-wash px-4 py-3 text-sm leading-6 text-ink whitespace-pre-wrap">
                {data.description}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
