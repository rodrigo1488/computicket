"use client";

import { TicketForm } from "@/components/tickets/TicketForm";
import { PageTitle } from "@/components/layout/AppShell";

export default function NewTicketPage() {
  return (
    <div>
      <PageTitle>Novo chamado</PageTitle>
      <TicketForm />
    </div>
  );
}
