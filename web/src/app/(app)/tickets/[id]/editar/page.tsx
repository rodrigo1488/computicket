"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { TicketForm } from "@/components/tickets/TicketForm";
import { PageTitle } from "@/components/layout/AppShell";
import { flask } from "@/lib/api";
import type { TicketDetail } from "@/lib/format";

export default function EditTicketPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => flask.get<TicketDetail>(`/tickets/api/${id}`),
  });
  return (
    <div>
      <PageTitle>Editar chamado</PageTitle>
      {data ? <TicketForm ticket={data} /> : <p className="text-muted">Carregando…</p>}
    </div>
  );
}
