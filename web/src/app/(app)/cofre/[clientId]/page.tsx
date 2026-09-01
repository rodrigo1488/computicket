"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, Plus } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DeleteAction, EditAction, RowActions, ViewAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import { useColFilters } from "@/lib/use-col-filters";

type VaultClient = {
  id: number;
  name: string;
  phone?: string;
  document?: string;
  contract_type?: string;
  is_external: boolean;
};

type VaultItem = {
  id: number;
  machine_name: string;
  anydesk_code?: string;
  description?: string;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string;
};

type VaultClientRes = PageRes<VaultItem> & { client: VaultClient };

const emptyForm = { machine_name: "", anydesk_code: "", description: "", password: "" };

export default function CofreClientePage() {
  return (
    <Suspense fallback={<p className="text-muted">Carregando…</p>}>
      <CofreClienteInner />
    </Suspense>
  );
}

function CofreClienteInner() {
  const params = useParams<{ clientId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const clientId = Number(params.clientId);
  const isExternal = search.get("external") === "1";

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<VaultItem | null>(null);
  const [reveal, setReveal] = useState<{ machine: string; password: string; warning?: string } | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const { colQuery, colFilters, onFiltersChange } = useColFilters();

  useEffect(() => setPage(1), [q, colFilters]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["vault-client", clientId, isExternal, q, page, colQuery],
    queryFn: () =>
      flask.get<VaultClientRes>(
        `/api/web/vault/clients/${clientId}?q=${encodeURIComponent(q)}&page=${page}&per_page=10${colQuery}${
          isExternal ? "&external=1" : ""
        }`,
      ),
    enabled: Number.isFinite(clientId),
    placeholderData: (previousData) => previousData,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["vault-client", clientId] });

  const save = useMutation({
    mutationFn: () => {
      if (creating) {
        if (!form.machine_name.trim() || !form.password.trim()) {
          throw new Error("Nome da máquina e senha são obrigatórios");
        }
        return flask.post(`/api/web/vault`, {
          client_id: clientId,
          is_external: isExternal || data?.client?.is_external,
          machine_name: form.machine_name,
          anydesk_code: form.anydesk_code,
          description: form.description,
          password: form.password,
        });
      }
      if (!edit) throw new Error("Nenhum registro selecionado");
      return flask.patch(`/api/web/vault/${edit.id}`, {
        machine_name: form.machine_name,
        anydesk_code: form.anydesk_code,
        description: form.description,
        password: form.password || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["vault-clients"] });
      setCreating(false);
      setEdit(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/web/vault/${id}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["vault-clients"] });
    },
  });

  const openReveal = async (item: VaultItem) => {
    const res = await flask.get<{ success: boolean; password?: string; warning?: string; error?: string }>(
      `/api/web/vault/${item.id}/reveal`,
    );
    if (!res.success) throw new Error(res.error || "Erro ao revelar senha");
    setShowPw(false);
    setCopied(false);
    setReveal({ machine: item.machine_name, password: res.password || "", warning: res.warning });
  };

  const copyPassword = async () => {
    if (!reveal?.password) return;
    await navigator.clipboard.writeText(reveal.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const client = data?.client;

  return (
    <div>
      <button type="button" onClick={() => router.push("/cofre")} className="mb-3 text-sm text-muted hover:text-ink">
        ← Voltar ao cofre
      </button>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">{client?.name || "Cliente"}</PageTitle>
          <p className="text-sm text-muted">
            {[client?.phone, client?.document, client?.contract_type].filter(Boolean).join(" · ") || "Senhas armazenadas"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
            setFormError("");
            setEdit(null);
            setCreating(true);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
        >
          <Plus className="h-4 w-4" />
          Nova senha
        </button>
      </div>

      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      <DataTable
        id="cofre-senhas"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por máquina, AnyDesk…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columns={["Máquina", "AnyDesk", "Descrição", "Ações"]}
        empty="Nenhuma senha cadastrada para este cliente"
        rows={(data?.items || []).map((i) => [
          i.machine_name,
          i.anydesk_code || "—",
          i.description || "—",
          <RowActions key={i.id}>
            <ViewAction
              onClick={() => {
                openReveal(i).catch((e) => window.alert(e instanceof Error ? e.message : "Erro ao revelar senha"));
              }}
            />
            <EditAction
              onClick={() => {
                setForm({
                  machine_name: i.machine_name,
                  anydesk_code: i.anydesk_code || "",
                  description: i.description || "",
                  password: "",
                });
                setFormError("");
                setCreating(false);
                setEdit(i);
              }}
            />
            <DeleteAction
              onClick={() => {
                if (window.confirm(`Excluir a senha de ${i.machine_name}?`)) remove.mutate(i.id);
              }}
            />
          </RowActions>,
        ])}
      />
      <Pagination page={data?.page || page} perPage={data?.per_page || 10} total={data?.total || 0} onPage={setPage} />

      <Modal
        open={creating || !!edit}
        onClose={() => {
          setCreating(false);
          setEdit(null);
        }}
        title={creating ? "Nova senha" : "Editar senha"}
        wide
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField
            label="Máquina"
            value={form.machine_name}
            onChange={(v) => setForm((f) => ({ ...f, machine_name: v }))}
          />
          <UnderlineField
            label="AnyDesk"
            value={form.anydesk_code}
            onChange={(v) => setForm((f) => ({ ...f, anydesk_code: v }))}
          />
          <UnderlineField
            label="Descrição"
            value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
          />
          <UnderlineField
            label={creating ? "Senha" : "Nova senha (opcional)"}
            type="password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            hint={creating ? undefined : "Deixe em branco para manter a senha atual"}
          />
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>

      <Modal open={!!reveal} onClose={() => setReveal(null)} title="Senha da máquina">
        {reveal ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-navy">{reveal.machine}</p>
            {reveal.warning ? <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">{reveal.warning}</p> : null}
            <div className="flex items-center gap-2">
              <input
                type={showPw ? "text" : "password"}
                readOnly
                value={reveal.password}
                className="h-10 flex-1 rounded-lg border border-line px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line"
                aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={copyPassword}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-inverse text-sm font-medium text-on-inverse"
            >
              <Copy className="h-4 w-4" />
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
