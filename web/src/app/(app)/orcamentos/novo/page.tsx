"use client";

import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { BudgetBuilder } from "@/components/budgets/BudgetBuilder";

export default function NovoOrcamentoPage() {
  const router = useRouter();
  return (
    <div>
      <button type="button" onClick={() => router.push("/orcamentos")} className="mb-3 text-sm text-muted hover:text-ink">
        ← Voltar aos orçamentos
      </button>
      <PageTitle>Novo orçamento</PageTitle>
      <BudgetBuilder />
    </div>
  );
}
