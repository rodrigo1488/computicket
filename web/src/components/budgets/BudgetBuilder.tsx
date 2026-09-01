"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, GripVertical, Link2, Plus, Sparkles, Trash2, Unlink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BudgetAiDialog, type BudgetAiDraft } from "@/components/budgets/BudgetAiDialog";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import {
  exportBudgetPdf,
  generateBudgetPublicLink,
  publicBudgetUrl,
  revokeBudgetPublicLink,
} from "@/lib/budget-share";
import { cn } from "@/lib/cn";
import { formatBRL, stripHtml } from "@/lib/format";

export type BudgetItemForm = {
  key: string;
  item_type: "manual" | "product" | "service";
  product_id?: number | null;
  service_id?: number | null;
  codigo: string;
  description: string;
  quantity: string;
  unit_price: string;
  unit_of_measure: string;
  observations: string;
  is_recurring: boolean;
  recurrence_period: "monthly" | "quarterly" | "yearly";
};

export type BudgetDetail = {
  id: number;
  title: string;
  status: string;
  description?: string;
  client_id?: number | null;
  external_client_id?: number | null;
  client_name?: string;
  valid_until?: string;
  theme_id?: number | null;
  show_logo?: boolean;
  discount?: number;
  payment_terms?: string;
  internal_notes?: string;
  public_token?: string;
  updated_at_iso?: string | null;
  subtotal?: number;
  total?: number;
  items?: Array<{
    item_type?: string;
    product_id?: number | null;
    service_id?: number | null;
    codigo?: string;
    description?: string;
    quantity?: number;
    unit_price?: number;
    unit_of_measure?: string;
    observations?: string;
    is_recurring?: boolean;
    recurrence_period?: string | null;
  }>;
};

type Theme = {
  id: number;
  name: string;
  primary_color?: string;
  is_default?: boolean;
};

type ClientOpt = { id: number; name: string; type: "internal" | "external" };
type ServiceOpt = { id: number; name: string; description?: string; hourly_rate?: number };

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyItem(type: BudgetItemForm["item_type"] = "manual"): BudgetItemForm {
  return {
    key: newKey(),
    item_type: type,
    codigo: "",
    description: "",
    quantity: "1",
    unit_price: "0",
    unit_of_measure: "",
    observations: "",
    is_recurring: false,
    recurrence_period: "monthly",
  };
}

function fromDetail(b?: BudgetDetail | null): BudgetItemForm[] {
  const items = b?.items || [];
  if (!items.length) return [emptyItem()];
  return items.map((it) => ({
    key: newKey(),
    item_type: (it.item_type as BudgetItemForm["item_type"]) || "manual",
    product_id: it.product_id,
    service_id: it.service_id,
    codigo: it.codigo || "",
    description: stripHtml(it.description) || it.description || "",
    quantity: String(it.quantity ?? 1),
    unit_price: String(it.unit_price ?? 0),
    unit_of_measure: it.unit_of_measure || "",
    observations: stripHtml(it.observations) || it.observations || "",
    is_recurring: Boolean(it.is_recurring),
    recurrence_period: (it.recurrence_period as BudgetItemForm["recurrence_period"]) || "monthly",
  }));
}

const TYPE_LABEL: Record<string, string> = { manual: "Item", product: "Produto", service: "Serviço" };

export function BudgetBuilder({ budget }: { budget?: BudgetDetail | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState(budget?.title || "");
  const [status, setStatus] = useState(budget?.status || "draft");
  const [description, setDescription] = useState(stripHtml(budget?.description) || budget?.description || "");
  const [validUntil, setValidUntil] = useState(budget?.valid_until || "");
  const [discount, setDiscount] = useState(String(budget?.discount ?? 0));
  const [paymentTerms, setPaymentTerms] = useState(stripHtml(budget?.payment_terms) || budget?.payment_terms || "");
  const [internalNotes, setInternalNotes] = useState(stripHtml(budget?.internal_notes) || budget?.internal_notes || "");
  const [themeId, setThemeId] = useState(budget?.theme_id ? String(budget.theme_id) : "");
  const [showLogo, setShowLogo] = useState(budget?.show_logo !== false);
  const [items, setItems] = useState<BudgetItemForm[]>(() => fromDetail(budget));
  const [clientSearch, setClientSearch] = useState("");
  const [client, setClient] = useState<ClientOpt | null>(
    budget?.client_name
      ? {
          id: budget.external_client_id || budget.client_id || 0,
          name: budget.client_name,
          type: budget.external_client_id ? "external" : "internal",
        }
      : null,
  );
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceQ, setServiceQ] = useState("");
  const [customService, setCustomService] = useState({ description: "", unit_price: "0" });
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [token, setToken] = useState(budget?.public_token || "");
  const [shareMsg, setShareMsg] = useState("");
  const [busyFile, setBusyFile] = useState("");
  const [error, setError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  const meta = useQuery({
    queryKey: ["budget-meta"],
    queryFn: () => flask.get<{ themes: Theme[] }>("/api/web/budgets/meta"),
  });
  const clients = useQuery({
    queryKey: ["budget-clients"],
    queryFn: () => flask.get<{ clients: ClientOpt[] }>("/api/web/budgets/clients"),
  });
  const services = useQuery({
    queryKey: ["services-all"],
    queryFn: () => flask.get<{ items: ServiceOpt[] }>("/api/web/services?per_page=200"),
    enabled: serviceOpen,
  });
  const filteredServices = useMemo(() => {
    const all = services.data?.items || [];
    const q = serviceQ.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q));
  }, [services.data, serviceQ]);

  useEffect(() => {
    setToken(budget?.public_token || "");
  }, [budget?.public_token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("ia") === "1") setAiOpen(true);
  }, []);

  useEffect(() => {
    if (!themeId && meta.data?.themes?.length) {
      const def = meta.data.themes.find((t) => t.is_default);
      if (def && !budget) setThemeId(String(def.id));
    }
  }, [meta.data, themeId, budget]);

  const clientOpts = useMemo(() => {
    const all = clients.data?.clients || [];
    const s = clientSearch.trim().toLowerCase();
    if (!s) return all.slice(0, 8);
    return all.filter((c) => c.name.toLowerCase().includes(s)).slice(0, 8);
  }, [clients.data, clientSearch]);

  const totals = useMemo(() => {
    let subtotal = 0;
    const recurring: Record<string, number> = {};
    for (const it of items) {
      const qty = Number(it.quantity.replace(",", ".")) || 0;
      const price = Number(it.unit_price.replace(",", ".")) || 0;
      const line = qty * price;
      if (it.is_recurring) {
        const p = it.recurrence_period || "monthly";
        recurring[p] = (recurring[p] || 0) + line;
      } else {
        subtotal += line;
      }
    }
    const disc = Math.max(Number(discount.replace(",", ".")) || 0, 0);
    return { subtotal, discount: disc, total: Math.max(subtotal - disc, 0), recurring };
  }, [items, discount]);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório");
      const payload = {
        title: title.trim(),
        status,
        description,
        valid_until: validUntil || null,
        theme_id: themeId ? Number(themeId) : null,
        show_logo: showLogo,
        discount: totals.discount,
        payment_terms: paymentTerms,
        internal_notes: internalNotes,
        expected_updated_at: budget?.updated_at_iso || null,
        client_id: client?.type === "internal" ? client.id : null,
        external_client_id: client?.type === "external" ? client.id : null,
        external_client_name: client?.type === "external" ? client.name : null,
        items: items
          .filter((it) => it.description.trim())
          .map((it) => ({
            item_type: it.item_type,
            product_id: it.product_id || null,
            service_id: it.service_id || null,
            codigo: it.codigo,
            description: it.description,
            quantity: Number(it.quantity.replace(",", ".")) || 1,
            unit_price: Number(it.unit_price.replace(",", ".")) || 0,
            unit_of_measure: it.unit_of_measure,
            observations: it.observations,
            is_recurring: it.is_recurring,
            recurrence_period: it.is_recurring ? it.recurrence_period : null,
          })),
      };
      if (budget?.id) return flask.post<{ success: boolean; budget_id: number }>(`/api/web/budgets/${budget.id}`, payload);
      return flask.post<{ success: boolean; budget_id: number }>("/api/web/budgets", payload);
    },
    onSuccess: (res) => {
      const id = res.budget_id || budget?.id;
      if (id) qc.invalidateQueries({ queryKey: ["budget", id] });
      router.push(id ? `/orcamentos/${id}` : "/orcamentos");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const periodLabel: Record<string, string> = { monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" };

  function moveItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function addCustomService() {
    const desc = customService.description.trim();
    if (!desc) return;
    setItems((prev) => [
      ...prev,
      {
        ...emptyItem("service"),
        description: desc,
        unit_price: customService.unit_price || "0",
      },
    ]);
    setCustomService({ description: "", unit_price: "0" });
    setServiceOpen(false);
  }

  async function exportPdf() {
    if (!budget?.id) return;
    setBusyFile("pdf");
    setError("");
    try {
      await exportBudgetPdf(budget.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível exportar o PDF");
    } finally {
      setBusyFile("");
    }
  }

  async function shareLink() {
    if (!budget?.id) return;
    setBusyFile("share");
    setShareMsg("");
    setError("");
    try {
      const next = await generateBudgetPublicLink(budget.id, token);
      if (next) {
        setToken(next);
        setShareMsg("Link público copiado");
        qc.invalidateQueries({ queryKey: ["budget", budget.id] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o link");
    } finally {
      setBusyFile("");
    }
  }

  function applyAiDraft(draft: BudgetAiDraft) {
    const existingMeaningful = items.some(
      (it) => it.description.trim() || Number(it.unit_price.replace(",", ".")) > 0,
    );
    if (existingMeaningful && !window.confirm("Substituir os itens atuais pelos gerados pela IA?")) {
      return false;
    }
    if (draft.title) {
      if (!title.trim()) {
        setTitle(draft.title);
      } else if (title.trim() !== draft.title && window.confirm("Substituir o título atual pelo sugerido pela IA?")) {
        setTitle(draft.title);
      }
    }
    setDescription(stripHtml(draft.description) || "");
    setPaymentTerms(stripHtml(draft.payment_terms) || "");
    setInternalNotes(stripHtml(draft.internal_notes) || "");
    const nextItems = (draft.items || []).map((it) => ({
      ...emptyItem((it.item_type as BudgetItemForm["item_type"]) || "manual"),
      product_id: it.product_id,
      service_id: it.service_id,
      codigo: it.codigo || "",
      description: stripHtml(it.description) || it.description || "",
      quantity: String(it.quantity ?? 1),
      unit_price: String(it.unit_price ?? 0),
      unit_of_measure: it.unit_of_measure || "",
      observations: stripHtml(it.observations) || it.observations || "",
    }));
    setItems(nextItems.length ? nextItems : [emptyItem()]);
    return true;
  }

  async function revokeLink() {
    if (!budget?.id) return;
    setBusyFile("revoke");
    try {
      await revokeBudgetPublicLink(budget.id);
      setToken("");
      setShareMsg("Link público revogado");
      qc.invalidateQueries({ queryKey: ["budget", budget.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível revogar o link");
    } finally {
      setBusyFile("");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="rounded-2xl border border-line p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-navy">Dados do orçamento</h2>
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-inverse px-3 py-1.5 text-sm text-on-inverse"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Gerar com IA
            </button>
          </div>
          <div className="space-y-4">
            <UnderlineField label="Título" value={title} onChange={setTitle} placeholder="Ex: Infraestrutura de rede" />
            <div>
              <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Cliente</span>
              {client ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-full bg-progress-bg px-3 py-1 text-sm text-progress">{client.name}</span>
                  <button type="button" onClick={() => setClient(null)} className="text-muted hover:text-ink" aria-label="Remover cliente">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative mt-1">
                  <input
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Digite para buscar o cliente…"
                    className="w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
                  />
                  {clients.isError ? (
                    <p className="mt-2 text-sm text-open">{(clients.error as Error).message}</p>
                  ) : null}
                  {clientSearch.trim() ? (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-line bg-surface shadow-lg">
                      {clients.isLoading ? (
                        <p className="px-3 py-2 text-sm text-muted">Carregando clientes…</p>
                      ) : clientOpts.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted">Nenhum cliente</p>
                      ) : (
                        clientOpts.map((c) => (
                          <button
                            key={`${c.type}-${c.id}`}
                            type="button"
                            onClick={() => {
                              setClient(c);
                              setClientSearch("");
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-wash"
                          >
                            {c.name}
                            <span className="ml-2 text-xs text-muted">{c.type === "external" ? "Externo" : "Interno"}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Válido até</span>
                <input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
                >
                  <option value="draft">Rascunho</option>
                  <option value="sent">Enviado</option>
                  <option value="approved">Aprovado</option>
                  <option value="rejected">Rejeitado</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Descrição / introdução</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-line p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-navy">Itens</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                IA
              </button>
              <button
                type="button"
                onClick={() => setServiceOpen(true)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              >
                Serviço
              </button>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, emptyItem("product")])}
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              >
                Produto
              </button>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, emptyItem("manual")])}
                className="inline-flex items-center gap-1 rounded-lg bg-inverse px-3 py-1.5 text-sm text-on-inverse"
              >
                <Plus className="h-3.5 w-3.5" />
                Item manual
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted">
            Segure o ícone e arraste para reordenar. Ative Recorrente para cobrança mensal, trimestral ou anual. A descrição de cada serviço pode ser editada livremente.
          </p>
          <div className="space-y-4">
            {items.map((it, idx) => (
              <div
                key={it.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIdx(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData("text/plain"));
                  moveItem(from, idx);
                  setDragFrom(null);
                  setOverIdx(null);
                }}
                className={cn(
                  "rounded-xl border p-4",
                  overIdx === idx && dragFrom !== null && dragFrom !== idx ? "border-brand bg-brand/5" : "border-line",
                )}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      draggable
                      title="Arrastar para reordenar"
                      onDragStart={(e) => {
                        setDragFrom(idx);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setOverIdx(null);
                      }}
                      className="inline-flex cursor-grab touch-none text-muted active:cursor-grabbing"
                    >
                      <GripVertical className="h-5 w-5" />
                    </span>
                    <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-medium text-ink">
                      {TYPE_LABEL[it.item_type] || "Item"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, is_recurring: !row.is_recurring } : row)),
                        )
                      }
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        it.is_recurring ? "bg-brand text-white" : "bg-wash text-muted hover:text-ink",
                      )}
                    >
                      Recorrente
                    </button>
                    {it.is_recurring ? (
                      <select
                        value={it.recurrence_period}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? { ...row, recurrence_period: e.target.value as BudgetItemForm["recurrence_period"] }
                                : row,
                            ),
                          )
                        }
                        className="rounded-lg border border-line px-2 py-1 text-xs"
                      >
                        <option value="monthly">Mensal</option>
                        <option value="quarterly">Trimestral</option>
                        <option value="yearly">Anual</option>
                      </select>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-open"
                    aria-label="Remover item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={it.description}
                  onChange={(e) =>
                    setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row)))
                  }
                  placeholder={
                    it.item_type === "service"
                      ? "Descreva o serviço (ex: Instalação de rede, manutenção…)"
                      : "Descrição do item"
                  }
                  rows={2}
                  className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-muted">
                    Qtd
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.quantity}
                      onChange={(e) =>
                        setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row)))
                      }
                      className="mt-1 w-full border-b border-line py-1 text-sm text-ink"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Valor unit. (R$)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.unit_price}
                      onChange={(e) =>
                        setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, unit_price: e.target.value } : row)))
                      }
                      className="mt-1 w-full border-b border-line py-1 text-sm text-ink"
                    />
                  </label>
                  <div className="flex items-end justify-between text-sm font-medium text-navy">
                    {formatBRL((Number(it.quantity.replace(",", ".")) || 0) * (Number(it.unit_price.replace(",", ".")) || 0))}
                  </div>
                </div>
                <input
                  value={it.observations}
                  onChange={(e) =>
                    setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, observations: e.target.value } : row)))
                  }
                  placeholder="Observações (visível ao cliente)"
                  className="mt-3 w-full border-0 border-b border-line py-1 text-sm"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal (único)</span>
              <span>{formatBRL(totals.subtotal)}</span>
            </div>
            {Object.entries(totals.recurring).map(([period, value]) => (
              <div key={period} className="flex justify-between text-muted">
                <span>Recorrente ({periodLabel[period] || period})</span>
                <span>{formatBRL(value)}</span>
              </div>
            ))}
            <label className="flex items-center justify-between gap-3">
              <span className="text-muted">Desconto (R$)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-28 border-b border-line py-1 text-right"
              />
            </label>
            <div className="flex justify-between border-t border-line pt-2 font-semibold text-navy">
              <span>TOTAL (único)</span>
              <span>{formatBRL(totals.total)}</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line p-6">
          <h2 className="mb-3 text-lg font-semibold text-navy">Condições e observações</h2>
          <p className="mb-2 text-xs text-muted">Visível ao cliente no PDF e no link público.</p>
          <textarea
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </section>

        <section className="rounded-2xl border border-line p-6">
          <h2 className="mb-1 text-lg font-semibold text-navy">Observações internas</h2>
          <p className="mb-3 text-xs text-muted">Uso exclusivo da empresa — não aparece para o cliente.</p>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-line p-6">
          <h2 className="mb-4 text-lg font-semibold text-navy">Aparência</h2>
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Tema de cores</span>
            <select
              value={themeId}
              onChange={(e) => setThemeId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">Padrão</option>
              {(meta.data?.themes || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} className="accent-brand" />
            Exibir logo no PDF
          </label>
        </section>
        <section className="rounded-2xl border border-line p-6">
          <h2 className="mb-3 text-lg font-semibold text-navy">Resumo</h2>
          <p className="text-sm text-muted">Cliente: {client?.name || "Sem cliente"}</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{formatBRL(totals.total)}</p>
          {error ? <p className="mt-3 text-sm text-open">{error}</p> : null}
          {shareMsg ? <p className="mt-3 text-sm text-done">{shareMsg}</p> : null}
          <PrimaryButton className="mt-4" type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : budget ? "Salvar alterações" : "Criar orçamento"}
          </PrimaryButton>
          {budget?.id ? (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => void exportPdf()}
                disabled={!!busyFile}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm font-medium hover:bg-wash disabled:opacity-50"
              >
                <FileDown className="h-4 w-4" />
                {busyFile === "pdf" ? "Gerando PDF…" : "Exportar PDF"}
              </button>
              <button
                type="button"
                onClick={() => void shareLink()}
                disabled={!!busyFile}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm font-medium hover:bg-wash disabled:opacity-50"
              >
                <Link2 className="h-4 w-4" />
                {busyFile === "share" ? "Gerando…" : token ? "Copiar link público" : "Gerar link público"}
              </button>
              {token ? (
                <>
                  <p className="break-all text-xs text-muted">{publicBudgetUrl(token)}</p>
                  <button
                    type="button"
                    onClick={() => void revokeLink()}
                    disabled={!!busyFile}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm text-open hover:bg-open-bg disabled:opacity-50"
                  >
                    <Unlink className="h-4 w-4" />
                    Revogar link público
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-center text-xs text-muted">Salve o orçamento para exportar PDF ou gerar o link público.</p>
          )}
          <button
            type="button"
            onClick={() => router.push(budget ? `/orcamentos/${budget.id}` : "/orcamentos")}
            className="mt-2 w-full rounded-xl py-3 text-sm text-muted hover:text-ink"
          >
            Cancelar
          </button>
        </section>
      </div>

      {serviceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setServiceOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Adicionar serviço</h3>
            <div className="mb-4 rounded-xl border border-line p-3">
              <p className="mb-2 text-sm font-medium text-navy">Serviço personalizado</p>
              <p className="mb-3 text-xs text-muted">Descreva um serviço que não está cadastrado.</p>
              <textarea
                value={customService.description}
                onChange={(e) => setCustomService((s) => ({ ...s, description: e.target.value }))}
                placeholder="Ex: Instalação de câmeras, configuração de firewall…"
                rows={2}
                className="mb-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
              <div className="flex items-end gap-3">
                <label className="flex-1 text-xs text-muted">
                  Valor (R$)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customService.unit_price}
                    onChange={(e) => setCustomService((s) => ({ ...s, unit_price: e.target.value }))}
                    className="mt-1 w-full border-b border-line py-1 text-sm text-ink"
                  />
                </label>
                <button
                  type="button"
                  onClick={addCustomService}
                  disabled={!customService.description.trim()}
                  className="rounded-lg bg-inverse px-3 py-2 text-sm text-on-inverse disabled:opacity-40"
                >
                  Incluir
                </button>
              </div>
            </div>
            <input
              value={serviceQ}
              onChange={(e) => setServiceQ(e.target.value)}
              placeholder="Buscar serviço cadastrado…"
              className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
            {filteredServices.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setItems((prev) => [
                    ...prev,
                    {
                      ...emptyItem("service"),
                      service_id: s.id,
                      description: s.name,
                      unit_price: String(s.hourly_rate ?? 0),
                    },
                  ]);
                  setServiceOpen(false);
                }}
                className="mb-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-wash"
              >
                <span>{s.name}</span>
                <span className="text-muted">{formatBRL(s.hourly_rate)}</span>
              </button>
            ))}
            {!filteredServices.length ? <p className="text-sm text-muted">Nenhum serviço cadastrado nesta busca</p> : null}
          </div>
        </div>
      ) : null}

      <BudgetAiDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        clientName={client?.name}
        onApply={applyAiDraft}
      />
    </div>
  );
}
