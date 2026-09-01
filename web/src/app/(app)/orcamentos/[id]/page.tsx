"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Link2, Pencil, Trash2, Unlink } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import type { BudgetDetail } from "@/components/budgets/BudgetBuilder";
import { TableLoadingRows } from "@/components/ui/table-loading";
import { flask } from "@/lib/api";
import {
  exportBudgetPdf,
  generateBudgetPublicLink,
  publicBudgetUrl,
  revokeBudgetPublicLink,
} from "@/lib/budget-share";
import { formatBRL, stripHtml } from "@/lib/format";

function budgetStatus(s?: string) {
  if (s === "draft") return "Rascunho";
  if (s === "sent") return "Enviado";
  if (s === "approved") return "Aprovado";
  if (s === "rejected") return "Rejeitado";
  return s || "—";
}

const periodLabel: Record<string, string> = { monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" };

function BudgetDetailLoading() {
  return (
    <div>
      <PageTitle>Orçamento</PageTitle>
      <section className="rounded-2xl border border-line p-5">
        <h2 className="mb-4 text-lg font-semibold text-navy">Itens</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-busy="true">
            <thead>
              <tr className="border-b border-line text-muted">
                {["Descrição", "Qtd", "Valor", "Total"].map((column) => (
                  <th key={column} className="py-2 pr-3 font-medium">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <TableLoadingRows columns={4} rows={5} />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function VerOrcamentoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const id = Number(params.id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["budget", id],
    queryFn: () => flask.get<BudgetDetail>(`/api/web/budgets/${id}`),
    enabled: Number.isFinite(id),
  });
  const [token, setToken] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [busyFile, setBusyFile] = useState("");
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    setToken(data?.public_token || "");
  }, [data?.public_token]);

  const remove = useMutation({
    mutationFn: () => flask.delete(`/api/web/budgets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      router.push("/orcamentos");
    },
  });

  async function exportPdf() {
    setBusyFile("pdf");
    setFileError("");
    try {
      await exportBudgetPdf(id);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Não foi possível exportar o PDF");
    } finally {
      setBusyFile("");
    }
  }

  async function shareLink() {
    setBusyFile("share");
    setShareMsg("");
    setFileError("");
    try {
      const next = await generateBudgetPublicLink(id, token);
      if (next) {
        setToken(next);
        setShareMsg("Link público copiado");
        qc.invalidateQueries({ queryKey: ["budget", id] });
        qc.invalidateQueries({ queryKey: ["budgets"] });
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Não foi possível gerar o link");
    } finally {
      setBusyFile("");
    }
  }

  async function revokeLink() {
    setBusyFile("revoke");
    setFileError("");
    try {
      await revokeBudgetPublicLink(id);
      setToken("");
      setShareMsg("Link público revogado");
      qc.invalidateQueries({ queryKey: ["budget", id] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Não foi possível revogar o link");
    } finally {
      setBusyFile("");
    }
  }

  if (isLoading) return <BudgetDetailLoading />;
  if (error) return <p className="text-open">{(error as Error).message}</p>;
  if (!data) return <p className="text-muted">Orçamento não encontrado</p>;

  const items = data.items || [];
  const discount = Number(data.discount || 0);

  return (
    <div>
      <button type="button" onClick={() => router.push("/orcamentos")} className="mb-3 text-sm text-muted hover:text-ink">
        ← Voltar aos orçamentos
      </button>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">{data.title}</PageTitle>
          <p className="text-sm text-muted">
            {data.client_name || "Sem cliente"} · {budgetStatus(data.status)}
            {data.valid_until ? ` · Válido até ${data.valid_until}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={!!busyFile}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
          >
            <FileDown className="h-4 w-4" />
            {busyFile === "pdf" ? "Gerando PDF…" : "Exportar PDF"}
          </button>
          <button
            type="button"
            onClick={() => void shareLink()}
            disabled={!!busyFile}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" />
            {busyFile === "share" ? "Gerando…" : token ? "Copiar link público" : "Gerar link público"}
          </button>
          {token ? (
            <button
              type="button"
              onClick={() => void revokeLink()}
              disabled={!!busyFile}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm text-open disabled:opacity-50"
            >
              <Unlink className="h-4 w-4" />
              Revogar link
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => router.push(`/orcamentos/${id}/editar`)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Excluir o orçamento ${data.title}?`)) remove.mutate();
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm text-open"
          >
            <Trash2 className="h-4 w-4" />
            Excluir
          </button>
        </div>
      </div>

      {fileError ? <p className="mb-3 text-sm text-open">{fileError}</p> : null}
      {shareMsg ? <p className="mb-3 text-sm text-done">{shareMsg}</p> : null}
      {token ? (
        <p className="mb-4 break-all text-xs text-muted">
          Link público:{" "}
          <a href={publicBudgetUrl(token)} className="text-ink underline" target="_blank" rel="noreferrer">
            {publicBudgetUrl(token)}
          </a>
        </p>
      ) : null}

      {data.description ? (
        <section className="mb-6 rounded-2xl border border-line p-5">
          <h2 className="mb-2 text-sm font-medium text-muted">Descrição</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{stripHtml(data.description) || data.description}</p>
        </section>
      ) : null}

      <section className="mb-6 rounded-2xl border border-line p-5">
        <h2 className="mb-4 text-lg font-semibold text-navy">Itens</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Nenhum item neste orçamento</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 font-medium">Descrição</th>
                  <th className="py-2 pr-3 font-medium">Qtd</th>
                  <th className="py-2 pr-3 font-medium">Valor</th>
                  <th className="py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const qty = Number(it.quantity || 0);
                  const price = Number(it.unit_price || 0);
                  return (
                    <tr key={i} className="border-t border-line">
                      <td className="py-3 pr-3">
                        <p>{stripHtml(it.description) || it.description || "—"}</p>
                        {it.is_recurring ? (
                          <p className="text-xs text-muted">Recorrente · {periodLabel[it.recurrence_period || "monthly"]}</p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">{qty}</td>
                      <td className="py-3 pr-3">{formatBRL(price)}</td>
                      <td className="py-3">{formatBRL(qty * price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <span>{formatBRL(data.subtotal)}</span>
          </div>
          {discount > 0 ? (
            <div className="flex justify-between text-muted">
              <span>Desconto</span>
              <span>- {formatBRL(discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-navy">
            <span>Total</span>
            <span>{formatBRL(data.total)}</span>
          </div>
        </div>
      </section>

      {data.payment_terms ? (
        <section className="mb-6 rounded-2xl border border-line p-5">
          <h2 className="mb-2 text-sm font-medium text-muted">Condições</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{stripHtml(data.payment_terms) || data.payment_terms}</p>
        </section>
      ) : null}

      {data.internal_notes ? (
        <section className="rounded-2xl border border-line bg-wash p-5">
          <h2 className="mb-2 text-sm font-medium text-muted">Observações internas</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{stripHtml(data.internal_notes) || data.internal_notes}</p>
        </section>
      ) : null}
    </div>
  );
}
