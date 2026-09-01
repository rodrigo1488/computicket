"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { formatBRL, stripHtml } from "@/lib/format";

const MIN_PROMPT_LEN = 15;

const TYPE_LABEL: Record<string, string> = {
  product: "Produto",
  service: "Serviço",
  manual: "Item",
};

export type BudgetAiDraftItem = {
  item_type?: "product" | "service" | "manual" | string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  observations?: string;
  product_id?: number | null;
  service_id?: number | null;
  codigo?: string | null;
  unit_of_measure?: string | null;
};

export type BudgetAiDraft = {
  title: string;
  description?: string;
  payment_terms?: string;
  internal_notes?: string;
  items: BudgetAiDraftItem[];
};

type GenerateRes = {
  success?: boolean;
  data?: BudgetAiDraft;
  error?: string;
};

export function BudgetAiDialog({
  open,
  onClose,
  clientName,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  clientName?: string | null;
  onApply: (draft: BudgetAiDraft) => boolean | void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<BudgetAiDraft | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setStatus("");
    const t = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  const previewTotal = (draft?.items || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    return sum + qty * price;
  }, 0);

  async function generate() {
    if (busy) return;
    const text = prompt.trim();
    if (text.length < MIN_PROMPT_LEN) {
      setError(`Descreva o orçamento com pelo menos ${MIN_PROMPT_LEN} caracteres.`);
      return;
    }
    setError("");
    setStatus("Gerando orçamento com IA… isso pode levar alguns segundos.");
    setDraft(null);
    setBusy(true);
    try {
      const res = await flask.post<GenerateRes>("/api/web/budgets/ai", {
        prompt: text,
        client_name: clientName || null,
      });
      if (!res.data?.items?.length) {
        throw new Error("A IA não gerou itens utilizáveis. Tente detalhar produtos, quantidades e serviços.");
      }
      setDraft(res.data);
      setStatus("");
    } catch (e) {
      setStatus("");
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível gerar o orçamento. Confira a chave Gemini em Configurações → IA.",
      );
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!draft || busy) return;
    const applied = onApply(draft);
    if (applied === false) return;
    onClose();
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title="Assistente de orçamento" wide>
      <p className="mb-4 text-sm text-muted">
        Descreva o que precisa. A IA preenche itens (com match no catálogo quando possível), condições e observações.
        Revise antes de salvar.
      </p>
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Descreva o orçamento</span>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void generate();
            }
          }}
          rows={5}
          disabled={busy}
          placeholder='Ex: 2 switches 24 portas PoE, 1 rack 19" 24U, 50m de cabo Cat6 e instalação de rede. Pagamento em 3x, garantia de 90 dias.'
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-60"
        />
      </label>
      {clientName ? (
        <p className="mt-2 text-xs text-muted">
          Cliente selecionado: <span className="font-medium text-ink">{clientName}</span>
        </p>
      ) : null}

      {status ? <p className="mt-3 text-sm text-muted">{status}</p> : null}
      {error ? <p className="mt-3 text-sm text-open">{error}</p> : null}

      {draft ? (
        <div className="mt-4 space-y-3 rounded-xl border border-line p-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Pré-visualização</p>
            <p className="mt-1 text-base font-semibold text-navy">{draft.title || "Orçamento"}</p>
          </div>
          <div className="max-h-44 space-y-1.5 overflow-y-auto">
            {(draft.items || []).map((item, idx) => {
              const qty = Number(item.quantity) || 0;
              const price = Number(item.unit_price) || 0;
              const line = qty * price;
              const desc = stripHtml(item.description) || "(sem descrição)";
              return (
                <div key={`${idx}-${desc.slice(0, 24)}`} className="flex justify-between gap-3 rounded-lg bg-wash px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted">
                      {TYPE_LABEL[item.item_type || ""] || "Item"}
                      {item.codigo ? ` · ${item.codigo}` : ""}
                    </p>
                    <p className="truncate text-ink">{desc}</p>
                  </div>
                  <div className="shrink-0 text-right text-muted">
                    <p>
                      {qty} × {formatBRL(price)}
                    </p>
                    <p className="font-medium text-ink">{formatBRL(line)}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-right text-sm font-semibold text-navy">Total estimado: {formatBRL(previewTotal)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3">
              <p className="mb-1 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Condições</p>
              <p className="line-clamp-4 text-xs text-ink">{stripHtml(draft.payment_terms) || "—"}</p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="mb-1 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Obs. internas</p>
              <p className="line-clamp-4 text-xs text-ink">{stripHtml(draft.internal_notes) || "—"}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <a href="/configuracoes?tab=ia" className="text-xs text-muted hover:text-ink">
          Configurar Gemini
        </a>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
          >
            Fechar
          </button>
          {draft ? (
            <button
              type="button"
              disabled={busy}
              onClick={apply}
              className="rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Aplicar no formulário
            </button>
          ) : null}
          <PrimaryButton
            type="button"
            disabled={busy || prompt.trim().length < MIN_PROMPT_LEN}
            onClick={() => void generate()}
            className="w-auto min-w-[140px] px-4 py-2.5"
          >
            <span className="inline-flex items-center justify-center gap-2">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Gerando…" : "Gerar"}
            </span>
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
