"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { ProductPicker, type PickedProduct } from "@/components/tickets/ProductPicker";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { ViewAction, PrimaryRowAction, RowActions } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { formatBRL, parseMoney } from "@/lib/format";
import { useColFilters } from "@/lib/use-col-filters";

type OsRow = {
  id: number;
  codigo: string;
  client_name: string;
  technician_name: string;
  value: number;
  status?: number;
  status_text: string;
  completion_date: string;
  ps_number?: string | null;
  ps_file?: string | null;
  delivery_file?: string | null;
  has_contract?: boolean;
  no_charge?: boolean;
};

type Res = { items: OsRow[]; total?: number; page?: number; per_page?: number };

type Cliente = {
  nome?: string;
  cnpjcpf?: string;
  celular?: string;
  endereco?: string;
  extra9?: string;
};

type OsSearch = {
  codigo: string;
  data_abertura?: string;
  equipamento?: string;
  problema_descrito?: string;
  tecnico?: string;
  valor?: number;
  servico_executado?: string;
  no_charge?: boolean;
  cliente?: Cliente;
};

type Picked = PickedProduct;

export default function OSPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<OsRow | null>(null);
  const { colQuery, colFilters, onFiltersChange } = useColFilters();
  useEffect(() => setPage(1), [q, colFilters]);
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["os", q, page, colQuery],
    queryFn: () => flask.get<Res>(`/api/web/service-orders?q=${encodeURIComponent(q)}&page=${page}&per_page=20${colQuery}`),
    placeholderData: (previousData) => previousData,
  });

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<OsSearch[]>([]);
  const [selected, setSelected] = useState<OsSearch | null>(null);
  const [servico, setServico] = useState("");
  const [valor, setValor] = useState("");
  const [forceCharge, setForceCharge] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);

  const resetForm = () => {
    setTerm("");
    setResults([]);
    setSelected(null);
    setServico("");
    setValor("");
    setForceCharge(false);
    setFormError("");
    setPicked([]);
  };

  const search = async () => {
    setFormError("");
    setSuccessMsg("");
    setSearching(true);
    try {
      const res = await flask.get<{ results?: OsSearch[]; error?: string }>(
        `/ordens-servico/search?q=${encodeURIComponent(term.trim())}`,
      );
      const list = res.results || [];
      setResults(list);
      if (!list.length) setFormError("Ordem de serviço não encontrada ou já finalizada.");
    } catch (e) {
      setResults([]);
      setFormError(e instanceof Error ? e.message : "Erro ao buscar ordem de serviço");
    } finally {
      setSearching(false);
    }
  };

  const pickOs = (os: OsSearch) => {
    setSelected(os);
    setServico(os.servico_executado || "");
    setValor(os.no_charge ? "0" : os.valor != null ? String(os.valor) : "");
    setForceCharge(false);
    setFormError("");
  };

  const openFinalize = async (codigo?: string) => {
    resetForm();
    setSuccessMsg("");
    setOpen(true);
    if (!codigo) return;
    setTerm(codigo);
    setSearching(true);
    try {
      const res = await flask.get<{ results?: OsSearch[]; error?: string }>(
        `/ordens-servico/search?q=${encodeURIComponent(codigo)}`,
      );
      const list = res.results || [];
      setResults(list);
      const match = list.find((x) => String(x.codigo) === String(codigo)) || list[0];
      if (match) pickOs(match);
      else setFormError("Ordem de serviço não encontrada ou já finalizada.");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao buscar ordem de serviço");
    } finally {
      setSearching(false);
    }
  };

  const finalizar = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Nenhuma ordem selecionada");
      if (!servico.trim()) throw new Error("Serviço executado é obrigatório");
      let amount = parseMoney(valor);
      if (selected.no_charge && !forceCharge) amount = 0;
      return flask.post<{
        message?: string;
        ps_file?: string | null;
        delivery_file?: string | null;
        ps_number?: string | null;
      }>("/ordens-servico/processar-finalizacao", {
        codigo: selected.codigo,
        servico_executado: servico.trim(),
        valor: amount,
        produtos: picked.map((p) => ({ id: p.id, quantidade: p.quantidade })),
      });
    },
    onSuccess: async (res) => {
      setSuccessMsg(res.message || "Ordem de serviço finalizada com sucesso");
      try {
        if (res.ps_file) await flask.open(`/ordens-servico/pdf/${encodeURIComponent(res.ps_file)}`);
        if (res.delivery_file) await flask.open(`/ordens-servico/pdf/${encodeURIComponent(res.delivery_file)}`);
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "OS finalizada, mas não foi possível abrir o PDF");
      }
      qc.invalidateQueries({ queryKey: ["os"] });
      resetForm();
      setOpen(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao finalizar"),
  });

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <PageTitle className="mb-0">Ordens de Serviço</PageTitle>
        <button
          type="button"
          onClick={() => void openFinalize()}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
        >
          <CheckCircle className="h-4 w-4" />
          Finalizar ordem
        </button>
      </div>
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      {successMsg ? <p className="mb-4 text-sm text-done">{successMsg}</p> : null}
      <DataTable
        id="ordens-servico"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por código, cliente, técnico…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{ Status: { filter: "select" }, Ações: { sortable: false, filter: false } }}
        columns={["Código", "Cliente", "Técnico", "Valor", "Status", "Conclusão", "Ações"]}
        rows={(data?.items || []).map((o) => [
          o.codigo,
          o.client_name,
          o.technician_name,
          formatBRL(o.value),
          o.status_text,
          o.completion_date,
          <RowActions key={o.id}>
            <ViewAction onClick={() => setView(o)} />
            <PrimaryRowAction onClick={() => void openFinalize(o.codigo)}>
              <CheckCircle className="h-3.5 w-3.5" />
              Finalizar
            </PrimaryRowAction>
          </RowActions>,
        ])}
        empty="Nenhuma ordem finalizada"
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 20} total={data?.total || 0} onPage={setPage} />

      <Modal open={!!view} onClose={() => setView(null)} title={`OS ${view?.codigo || ""}`} wide>
        {view ? (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <p>
              <span className="text-muted">Cliente</span>
              <br />
              <strong>{view.client_name}</strong>
            </p>
            <p>
              <span className="text-muted">Técnico</span>
              <br />
              {view.technician_name}
            </p>
            <p>
              <span className="text-muted">Valor</span>
              <br />
              {formatBRL(view.value)}
            </p>
            <p>
              <span className="text-muted">Status</span>
              <br />
              {view.status_text}
            </p>
            <p>
              <span className="text-muted">Conclusão</span>
              <br />
              {view.completion_date}
            </p>
            <p>
              <span className="text-muted">PS</span>
              <br />
              {view.ps_number || "—"}
            </p>
            <p>
              <span className="text-muted">Contrato</span>
              <br />
              {view.has_contract ? "Sim" : "Não"}
              {view.no_charge ? " · sem cobrança" : ""}
            </p>
            {(view.ps_file || view.delivery_file) ? (
              <div className="md:col-span-2 flex flex-wrap gap-3">
                {view.ps_file ? (
                  <button
                    type="button"
                    className="text-sm text-navy underline"
                    onClick={() => void flask.open(`/ordens-servico/pdf/${encodeURIComponent(view.ps_file!)}`)}
                  >
                    Abrir PS
                  </button>
                ) : null}
                {view.delivery_file ? (
                  <button
                    type="button"
                    className="text-sm text-navy underline"
                    onClick={() => void flask.open(`/ordens-servico/pdf/${encodeURIComponent(view.delivery_file!)}`)}
                  >
                    Abrir recibo
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Finalizar ordem de serviço"
        wide
        onBack={selected ? () => setSelected(null) : undefined}
      >
        {!selected ? (
          <div className="space-y-5">
            <p className="text-sm text-muted">Busque pelo código da OS ou pelo nome do cliente.</p>
            <UnderlineField label="Buscar OS" value={term} onChange={setTerm} placeholder="Código ou cliente" />
            <PrimaryButton
              type="button"
              disabled={searching || !term.trim()}
              onClick={() => void search()}
            >
              {searching ? "Buscando…" : "Buscar OS"}
            </PrimaryButton>
            {formError ? <p className="text-sm text-open">{formError}</p> : null}
            {results.length > 0 ? (
              <ul className="space-y-2">
                {results.map((os) => (
                  <li key={os.codigo}>
                    <button
                      type="button"
                      onClick={() => pickOs(os)}
                      className="w-full rounded-xl border border-[#eee] px-4 py-3 text-left hover:bg-[#fafafa]"
                    >
                      <p className="text-sm font-medium text-ink">
                        #{os.codigo} · {os.cliente?.nome || "Cliente"}
                      </p>
                      <p className="text-xs text-muted">{os.equipamento || "Equipamento não informado"}</p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              finalizar.mutate();
            }}
          >
            <div className="grid gap-3 rounded-2xl border border-[#eee] p-4 text-sm md:grid-cols-2">
              <p>
                <span className="text-muted">Código</span>
                <br />
                <strong>{selected.codigo}</strong>
              </p>
              <p>
                <span className="text-muted">Abertura</span>
                <br />
                {selected.data_abertura || "—"}
              </p>
              <p>
                <span className="text-muted">Cliente</span>
                <br />
                {selected.cliente?.nome || "—"}
              </p>
              <p>
                <span className="text-muted">Documento</span>
                <br />
                {selected.cliente?.cnpjcpf || "—"}
              </p>
              <p className="md:col-span-2">
                <span className="text-muted">Problema</span>
                <br />
                {selected.problema_descrito || "—"}
              </p>
              <p className="md:col-span-2">
                <span className="text-muted">Equipamento</span>
                <br />
                {selected.equipamento || "—"}
              </p>
              {selected.cliente?.extra9 ? (
                <p className="md:col-span-2">
                  <span className="text-muted">Contrato (extra9)</span>
                  <br />
                  {selected.cliente.extra9}
                </p>
              ) : null}
            </div>
            <label className="block">
              <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Serviço executado</span>
              <textarea
                value={servico}
                onChange={(e) => setServico(e.target.value)}
                rows={4}
                required
                placeholder="Descreva o serviço executado…"
                className="mt-1 w-full border-0 border-b border-[#d7d7d7] bg-transparent py-2 text-[15px] text-ink"
              />
            </label>
            <UnderlineField label="Valor (R$)" value={valor} onChange={setValor} placeholder="0,00" />
            {selected.no_charge ? (
              <div className="rounded-xl bg-[#fff6e5] p-3 text-sm">
                <p className="text-ink">Cliente com contrato “não cobra atendimento”. O valor será R$ 0,00.</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-navy underline"
                  onClick={() => setForceCharge((v) => !v)}
                >
                  {forceCharge ? "Restaurar isenção automática" : "Cobrar mesmo assim (manual)"}
                </button>
              </div>
            ) : null}
            <ProductPicker searchPath="/ordens-servico/produtos" picked={picked} onChange={setPicked} />
            {formError ? <p className="text-sm text-open">{formError}</p> : null}
            <PrimaryButton type="submit" disabled={finalizar.isPending}>
              {finalizar.isPending ? "Finalizando…" : "Finalizar ordem"}
            </PrimaryButton>
          </form>
        )}
      </Modal>
    </div>
  );
}
