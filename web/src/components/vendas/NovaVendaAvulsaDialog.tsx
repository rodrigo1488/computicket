"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatBRL } from "@/lib/format";

type ClientOpt = { id: number; name: string; document?: string };
type SellerOpt = { id: number; name: string };
type SaleItem = { id: number; product_name: string; quantity: number; unit_price: number };

type ClientsRes = { success?: boolean; clients?: ClientOpt[]; error?: string };
type UsersRes = { success?: boolean; users?: SellerOpt[]; current_user_id?: number; error?: string };
type CreateRes = { success?: boolean; message?: string; finance_ids?: number[]; error?: string };

function emptyDraft() {
  return { product_name: "", quantity: "1", unit_price: "0.00" };
}

export function NovaVendaAvulsaDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const [clientId, setClientId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [items, setItems] = useState<SaleItem[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [formError, setFormError] = useState("");

  const clients = useQuery({
    queryKey: ["tickets-api-clients"],
    queryFn: () => flask.get<ClientsRes>("/tickets/api/clients"),
    enabled: open,
  });
  const sellers = useQuery({
    queryKey: ["tickets-api-users"],
    queryFn: () => flask.get<UsersRes>("/tickets/api/users"),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setSellerId("");
    setItems([]);
    setDraft(emptyDraft());
    setFormError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const preferred = sellers.data?.current_user_id || user?.id;
    if (!preferred) return;
    const found = (sellers.data?.users || []).some((s) => s.id === preferred);
    if (found) setSellerId(String(preferred));
  }, [open, sellers.data, user?.id]);

  const draftQty = Number(draft.quantity) || 0;
  const draftPrice = Number(draft.unit_price) || 0;
  const draftName = draft.product_name.trim();
  const total = useMemo(() => {
    const listed = items.reduce((acc, item) => acc + item.quantity * item.unit_price, 0);
    return listed + (draftName ? draftQty * draftPrice : 0);
  }, [items, draftName, draftQty, draftPrice]);

  function addItem() {
    if (!draftName) {
      setFormError("Informe o nome do produto.");
      return;
    }
    setItems((current) => [
      ...current,
      {
        id: Date.now() + Math.random(),
        product_name: draftName,
        quantity: draftQty || 1,
        unit_price: draftPrice,
      },
    ]);
    setDraft(emptyDraft());
    setFormError("");
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Selecione um cliente.");
      if (!sellerId) throw new Error("Selecione um vendedor.");
      const payloadItems = [...items];
      if (draftName) {
        payloadItems.push({
          id: Date.now(),
          product_name: draftName,
          quantity: draftQty || 1,
          unit_price: draftPrice,
        });
      }
      if (!payloadItems.length) throw new Error("Informe ao menos um produto para lançar a venda.");
      return flask.post<CreateRes>("/tickets/api/produto-fora-estoque-direto", {
        client_id: Number(clientId),
        seller_id: Number(sellerId),
        items: payloadItems.map(({ product_name, quantity, unit_price }) => ({
          product_name,
          quantity,
          unit_price,
        })),
      });
    },
    onSuccess: (data) => {
      if (data.finance_ids?.length) {
        window.open(`/flask/tickets/api/venda-avulsa/imprimir?ids=${data.finance_ids.join(",")}`, "_blank");
      }
      onCreated?.();
      onClose();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao lançar venda."),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nova venda avulsa" wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setFormError("");
          create.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Cliente *</span>
            <select
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">{clients.isLoading ? "Carregando clientes…" : "Selecione um cliente…"}</option>
              {(clients.data?.clients || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.document ? `${c.name} - ${c.document}` : c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Vendedor *</span>
            <select
              required
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">{sellers.isLoading ? "Carregando vendedores…" : "Selecione um vendedor…"}</option>
              {(sellers.data?.users || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Adicionar produto</p>
          <UnderlineField
            label="Nome do produto"
            value={draft.product_name}
            onChange={(v) => setDraft((d) => ({ ...d, product_name: v }))}
            placeholder="Ex: Adaptador HDMI"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <UnderlineField
              label="Quantidade"
              type="number"
              value={draft.quantity}
              onChange={(v) => setDraft((d) => ({ ...d, quantity: v }))}
            />
            <UnderlineField
              label="Valor unitário (R$)"
              type="number"
              value={draft.unit_price}
              onChange={(v) => setDraft((d) => ({ ...d, unit_price: v }))}
            />
          </div>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand/40 text-sm font-medium text-brand hover:bg-brand/5"
          >
            <Plus className="h-4 w-4" />
            Adicionar item à lista
          </button>
        </div>

        {items.length ? (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-wash text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 text-center font-medium">Qtd</th>
                  <th className="px-3 py-2 text-right font-medium">Unit.</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-center font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-3 py-2">{item.product_name}</td>
                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(item.unit_price)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatBRL(item.quantity * item.unit_price)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setItems((current) => current.filter((_, i) => i !== idx))}
                        className="text-open hover:opacity-80"
                        aria-label="Remover item"
                      >
                        <Trash2 className="mx-auto h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-xl bg-warn-bg px-4 py-3 text-sm">
          <span className="text-muted">Valor total a lançar</span>
          <strong className="text-ink">{formatBRL(total)}</strong>
        </div>

        {formError ? <p className="text-sm text-open">{formError}</p> : null}
        <PrimaryButton type="submit" disabled={create.isPending}>
          {create.isPending ? "Lançando…" : "Lançar venda (crediário)"}
        </PrimaryButton>
      </form>
    </Modal>
  );
}
