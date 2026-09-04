"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable, Kpi } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { DeleteAction, EditAction, RowActions } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatBRL, parseMoney } from "@/lib/format";

type ContractClient = {
  id: number;
  name: string;
  document?: string;
  phone?: string;
  email?: string;
  product?: string;
  start_date?: string;
  end_date?: string;
  start_date_br?: string;
  end_date_br?: string;
  value?: number | null;
  status?: string;
  display_status?: string;
  days_to_expire?: number | null;
  notes?: string;
  has_details?: boolean;
};

type ContractDetail = {
  name: string;
  status?: string;
  clients: ContractClient[];
  clients_count: number;
  services: { id?: number; name?: string; hourly_rate?: number }[];
  services_count: number;
  stats?: { total: number; vencidos: number; vencendo: number; cancelados: number };
};

type SearchClient = { id: number; name: string; document?: string; phone?: string; email?: string };

type ClientForm = {
  product: string;
  start_date: string;
  end_date: string;
  value: string;
  status: "ativo" | "cancelado";
  notes: string;
};

const emptyForm: ClientForm = {
  product: "",
  start_date: "",
  end_date: "",
  value: "",
  status: "ativo",
  notes: "",
};

function statusLabel(client: ContractClient) {
  const display = client.display_status || client.status || "ativo";
  if (display === "vencido") {
    const days = client.days_to_expire;
    return days != null ? `Vencido há ${Math.abs(days)}d` : "Vencido";
  }
  if (display === "vencendo") {
    return client.days_to_expire != null ? `Vence em ${client.days_to_expire}d` : "Vencendo";
  }
  if (display === "cancelado") return "Cancelado";
  if (!client.has_details && !client.start_date && !client.end_date) return "Sem datas";
  return "Ativo";
}

function statusClass(client: ContractClient) {
  const display = client.display_status || client.status || "ativo";
  if (display === "vencido") return "text-open";
  if (display === "vencendo") return "text-amber-700";
  if (display === "cancelado") return "text-muted";
  return "text-progress";
}

export default function ContratoDetalhePage() {
  const params = useParams<{ contractName: string }>();
  const contractName = decodeURIComponent(params.contractName || "");
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());

  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<ContractClient | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [formError, setFormError] = useState("");

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["contract", contractName],
    queryFn: () => flask.get<ContractDetail>(`/api/web/contracts/${encodeURIComponent(contractName)}`),
    enabled: !!contractName,
  });

  const searchQuery = useQuery({
    queryKey: ["contract-clients-search", contractName, searchQ],
    queryFn: () =>
      flask.get<{ clients?: SearchClient[] }>(
        `/api/web/contracts/${encodeURIComponent(contractName)}/clients/search?q=${encodeURIComponent(searchQ)}`,
      ),
    enabled: adding && isAdmin,
  });

  const clients = useMemo(() => {
    const rows = data?.clients || [];
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((c) =>
      [c.name, c.document, c.phone, c.product, c.notes].some((v) => String(v || "").toLowerCase().includes(term)),
    );
  }, [data?.clients, q]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["contract", contractName] });
    qc.invalidateQueries({ queryKey: ["contracts"] });
  };

  useEffect(() => {
    if (!adding) {
      setSearchQ("");
      setSelectedIds([]);
      setForm(emptyForm);
      setFormError("");
    }
  }, [adding]);

  const addClients = useMutation({
    mutationFn: () => {
      if (!selectedIds.length) throw new Error("Selecione pelo menos um cliente");
      if (form.start_date && form.end_date && form.end_date < form.start_date) {
        throw new Error("A data de fim não pode ser anterior à data de início");
      }
      return flask.post(`/api/web/contracts/${encodeURIComponent(contractName)}/clients`, {
        client_ids: selectedIds,
        product: form.product,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        value: form.value ? parseMoney(form.value) : null,
        status: form.status,
        notes: form.notes,
      });
    },
    onSuccess: () => {
      invalidate();
      setAdding(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao adicionar"),
  });

  const saveDetails = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Nenhum cliente selecionado");
      if (form.start_date && form.end_date && form.end_date < form.start_date) {
        throw new Error("A data de fim não pode ser anterior à data de início");
      }
      return flask.patch(`/api/web/contracts/${encodeURIComponent(contractName)}/clients/${edit.id}`, {
        client_name: edit.name,
        product: form.product,
        start_date: form.start_date || "",
        end_date: form.end_date || "",
        value: form.value ? parseMoney(form.value) : null,
        status: form.status,
        notes: form.notes,
      });
    },
    onSuccess: () => {
      invalidate();
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const removeClient = useMutation({
    mutationFn: (clientId: number) =>
      flask.delete(`/api/web/contracts/${encodeURIComponent(contractName)}/clients/${clientId}`),
    onSuccess: () => invalidate(),
  });

  const searchResults = searchQuery.data?.clients || [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/contratos" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Contratos
          </Link>
          <PageTitle>{contractName || "Contrato"}</PageTitle>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
              setFormError("");
              setAdding(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-inverse px-4 py-2.5 text-sm font-medium text-on-inverse"
          >
            <Plus className="h-4 w-4" /> Adicionar cliente
          </button>
        ) : null}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Clientes" value={data?.clients_count ?? 0} />
        <Kpi label="Serviços" value={data?.services_count ?? 0} />
        <Kpi label="Vencidos" value={data?.stats?.vencidos ?? 0} />
        <Kpi label="Vencendo (30d)" value={data?.stats?.vencendo ?? 0} />
      </div>

      {error ? (
        <p className="mb-4 text-sm text-open">
          Não foi possível carregar o contrato. {(error as Error).message}
        </p>
      ) : (
        <DataTable
          id={`contrato-${contractName}`}
          loading={isLoading}
          refreshing={isFetching}
          searchPlaceholder="Buscar cliente, produto, documento…"
          searchValue={q}
          onSearch={setQ}
          columns={["Cliente", "Produto", "Início", "Fim", "Valor", "Status", "Ações"]}
          columnMeta={{
            Ações: { sortable: false, filter: false },
          }}
          rows={clients.map((c) => [
            <div key={`n-${c.id}`}>
              <p className="font-medium text-ink">{c.name}</p>
              <p className="text-xs text-muted">{[c.document, c.phone].filter(Boolean).join(" · ") || "—"}</p>
            </div>,
            c.product || "—",
            c.start_date_br || "—",
            c.end_date_br || "—",
            c.value != null ? formatBRL(c.value) : "—",
            <span key={`s-${c.id}`} className={`text-sm font-medium ${statusClass(c)}`}>
              {statusLabel(c)}
            </span>,
            isAdmin ? (
              <RowActions key={`a-${c.id}`}>
                <EditAction
                  onClick={() => {
                    setForm({
                      product: c.product || "",
                      start_date: c.start_date || "",
                      end_date: c.end_date || "",
                      value: c.value != null ? String(c.value) : "",
                      status: c.status === "cancelado" ? "cancelado" : "ativo",
                      notes: c.notes || "",
                    });
                    setFormError("");
                    setEdit(c);
                  }}
                />
                <DeleteAction
                  onClick={() => {
                    if (confirm(`Remover ${c.name} deste contrato?`)) {
                      removeClient.mutate(c.id);
                    }
                  }}
                />
              </RowActions>
            ) : (
              "—"
            ),
          ])}
          empty="Nenhum cliente neste contrato"
        />
      )}

      {(data?.services || []).length ? (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Serviços vinculados</h2>
          <ul className="flex flex-wrap gap-2">
            {(data?.services || []).map((s) => (
              <li key={s.id || s.name} className="rounded-lg border border-line bg-canvas/60 px-3 py-1.5 text-sm text-ink">
                {s.name}
                {s.hourly_rate != null ? ` · ${formatBRL(s.hourly_rate)}/h` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal open={adding} onClose={() => setAdding(false)} title="Adicionar clientes" wide>
        <div className="space-y-5">
          <UnderlineField
            label="Buscar cliente"
            value={searchQ}
            onChange={setSearchQ}
            placeholder="Nome, documento…"
          />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {searchQuery.isLoading ? <p className="px-2 py-3 text-sm text-muted">Buscando…</p> : null}
            {!searchQuery.isLoading && !searchResults.length ? (
              <p className="px-2 py-3 text-sm text-muted">Nenhum cliente disponível</p>
            ) : null}
            {searchResults.map((c) => {
              const checked = selectedIds.includes(c.id);
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-wash"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() =>
                      setSelectedIds((ids) =>
                        checked ? ids.filter((id) => id !== c.id) : [...ids, c.id],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{c.name}</span>
                    <span className="block text-xs text-muted">
                      {[c.document, c.phone].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <UnderlineField
              label="Data de início"
              type="date"
              value={form.start_date}
              onChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
            />
            <UnderlineField
              label="Data de fim"
              type="date"
              value={form.end_date}
              onChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
            />
            <UnderlineField
              label="Produto"
              value={form.product}
              onChange={(v) => setForm((f) => ({ ...f, product: v }))}
            />
            <UnderlineField
              label="Valor"
              value={form.value}
              onChange={(v) => setForm((f) => ({ ...f, value: v }))}
              placeholder="0,00"
            />
          </div>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "ativo" | "cancelado" }))}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="ativo">Ativo</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
          <UnderlineField
            label="Observações"
            value={form.notes}
            onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
          />
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton
            type="button"
            disabled={addClients.isPending || !selectedIds.length}
            onClick={() => addClients.mutate()}
          >
            {addClients.isPending
              ? "Adicionando…"
              : `Adicionar ${selectedIds.length} cliente${selectedIds.length === 1 ? "" : "s"}`}
          </PrimaryButton>
        </div>
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Editar · ${edit?.name || ""}`} wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            saveDetails.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <UnderlineField
              label="Data de início"
              type="date"
              value={form.start_date}
              onChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
            />
            <UnderlineField
              label="Data de fim"
              type="date"
              value={form.end_date}
              onChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
            />
            <UnderlineField
              label="Produto"
              value={form.product}
              onChange={(v) => setForm((f) => ({ ...f, product: v }))}
            />
            <UnderlineField
              label="Valor"
              value={form.value}
              onChange={(v) => setForm((f) => ({ ...f, value: v }))}
              placeholder="0,00"
            />
          </div>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "ativo" | "cancelado" }))}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="ativo">Ativo</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
          <UnderlineField
            label="Observações"
            value={form.notes}
            onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
          />
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={saveDetails.isPending}>
            {saveDetails.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
