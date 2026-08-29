"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { BudgetBuilder, type BudgetDetail } from "@/components/budgets/BudgetBuilder";
import { flask } from "@/lib/api";

export default function EditarOrcamentoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["budget", id],
    queryFn: () => flask.get<BudgetDetail>(`/api/web/budgets/${id}`),
    enabled: Number.isFinite(id),
  });

  if (isLoading) return <p className="text-muted">Carregando orçamento…</p>;
  if (error) return <p className="text-open">{(error as Error).message}</p>;
  if (!data) return <p className="text-muted">Orçamento não encontrado</p>;

  return (
    <div>
      <button type="button" onClick={() => router.push(`/orcamentos/${id}`)} className="mb-3 text-sm text-muted hover:text-ink">
        ← Voltar à visualização
      </button>
      <PageTitle>Editar orçamento</PageTitle>
      <BudgetBuilder budget={data} />
    </div>
  );
}
