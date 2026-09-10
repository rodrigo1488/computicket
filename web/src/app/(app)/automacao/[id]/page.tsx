"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { FlowCanvas } from "@/components/automacao/FlowCanvas";
import { flowsApi, type FlowCanvasConnection, type FlowCanvasNode } from "@/lib/flows";
import { useAuth } from "@/lib/auth-context";

export default function AutomacaoEditorPage() {
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");

  const flow = useQuery({
    queryKey: ["helpdesk-flow", id],
    queryFn: () => flowsApi.get(id),
    enabled: isAdmin && Number.isFinite(id),
  });

  const save = useMutation({
    mutationFn: (payload: { nodes: FlowCanvasNode[]; connections: FlowCanvasConnection[] }) =>
      flowsApi.saveCanvas(id, payload.nodes, payload.connections),
    onSuccess: () => {
      setNotice("Fluxo salvo.");
      qc.invalidateQueries({ queryKey: ["helpdesk-flow", id] });
      qc.invalidateQueries({ queryKey: ["helpdesk-flows"] });
    },
    onError: (e: Error) => setNotice(e.message),
  });

  if (!isAdmin) {
    return <p className="p-4 text-sm text-muted">Apenas administradores editam a automação do WhatsApp.</p>;
  }

  if (flow.isLoading) {
    return <p className="p-4 text-sm text-muted">Carregando fluxo…</p>;
  }
  if (flow.error || !flow.data) {
    return <p className="p-4 text-sm text-open">{(flow.error as Error)?.message || "Fluxo não encontrado."}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/automacao" className="rounded-lg p-1.5 text-muted hover:bg-wash" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-navy">{flow.data.name}</h1>
            <p className="text-xs text-muted">Ligue este fluxo na conexão WhatsApp (Configurações → WhatsApp → Fluxo de boas-vindas).</p>
          </div>
        </div>
        {notice ? <p className="text-xs text-muted">{notice}</p> : null}
        {save.error ? <p className="text-xs text-open">{(save.error as Error).message}</p> : null}
      </div>
      <FlowCanvas
        flow={flow.data}
        saving={save.isPending}
        onSave={(nodes, connections) => save.mutate({ nodes, connections })}
      />
    </div>
  );
}
