"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flowsApi, type FlowBuilder } from "@/lib/flows";
import { useAuth } from "@/lib/auth-context";

export default function AutomacaoPage() {
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [rename, setRename] = useState<FlowBuilder | null>(null);

  const list = useQuery({
    queryKey: ["helpdesk-flows"],
    queryFn: flowsApi.list,
    enabled: isAdmin,
  });

  const create = useMutation({
    mutationFn: () => flowsApi.create(name.trim()),
    onSuccess: (flow) => {
      qc.invalidateQueries({ queryKey: ["helpdesk-flows"] });
      setCreating(false);
      setName("");
      if (flow?.id) router.push(`/automacao/${flow.id}`);
    },
  });

  const saveName = useMutation({
    mutationFn: () => flowsApi.rename(rename!.id, name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-flows"] });
      setRename(null);
      setName("");
    },
  });

  const duplicate = useMutation({
    mutationFn: (id: number) => flowsApi.duplicate(id),
    onSuccess: (flow) => {
      qc.invalidateQueries({ queryKey: ["helpdesk-flows"] });
      if (flow?.id) router.push(`/automacao/${flow.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => flowsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["helpdesk-flows"] }),
  });

  if (!isAdmin) {
    return <p className="text-sm text-muted">Apenas administradores editam a automação do WhatsApp.</p>;
  }

  const flows = list.data?.flows || [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <PageTitle>Automação</PageTitle>
          <p className="-mt-4 mb-6 text-sm text-muted">
            Monte o fluxo de triagem no WhatsApp. As respostas viram variáveis e o bloco Ticket abre o chamado.
          </p>
        </div>
        <PrimaryButton type="button" onClick={() => { setCreating(true); setName(""); }}>
          <Plus className="h-4 w-4" />
          Novo fluxo
        </PrimaryButton>
      </div>

      {list.error ? <p className="mb-4 text-sm text-open">{(list.error as Error).message}</p> : null}

      {list.isLoading ? <p className="text-sm text-muted">Carregando fluxos…</p> : null}
      {!list.isLoading && flows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-line text-center">
          <Workflow className="mb-3 h-10 w-10 text-line" />
          <p className="font-semibold text-navy">Nenhum fluxo ainda</p>
          <p className="mt-1 max-w-sm text-sm text-muted">Crie o primeiro para perguntar dados e abrir ticket automaticamente.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => (
            <li key={flow.id} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <Link href={`/automacao/${flow.id}`} className="block">
                <p className="font-semibold text-navy">{flow.name}</p>
                <p className="mt-1 text-xs text-muted">{flow.flow?.nodes?.length || 0} bloco(s)</p>
              </Link>
              <div className="mt-3 flex gap-1">
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-wash" title="Renomear" onClick={() => { setRename(flow); setName(flow.name); }}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-wash" title="Duplicar" onClick={() => duplicate.mutate(flow.id)}>
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-open hover:bg-open-bg"
                  title="Excluir"
                  onClick={() => {
                    if (window.confirm(`Excluir o fluxo “${flow.name}”?`)) remove.mutate(flow.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={creating || !!rename} onClose={() => { setCreating(false); setRename(null); }} title={rename ? "Renomear fluxo" : "Novo fluxo"}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (rename) saveName.mutate();
            else create.mutate();
          }}
        >
          <UnderlineField label="Nome" value={name} onChange={setName} placeholder="Triagem de suporte" />
          {create.error || saveName.error ? (
            <p className="text-sm text-open">{((create.error || saveName.error) as Error).message}</p>
          ) : null}
          <PrimaryButton type="submit" disabled={create.isPending || saveName.isPending || !name.trim()}>
            {create.isPending || saveName.isPending ? "Salvando…" : rename ? "Salvar" : "Criar e desenhar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
