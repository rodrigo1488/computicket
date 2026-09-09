"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";
import type { ImplantationDetail, ImplantationModel } from "@/components/implantacao/types";

type Client = { id: number; name: string };

export function ImplantationForm({
  models,
  defaultModelId,
  onCreated,
}: {
  models: ImplantationModel[];
  defaultModelId?: number | null;
  onCreated: (item: ImplantationDetail) => void;
}) {
  const lockedModel = defaultModelId ? models.find((m) => m.id === defaultModelId) : null;
  const [modelId, setModelId] = useState(defaultModelId ? String(defaultModelId) : "");
  const [stepId, setStepId] = useState("");
  const [clientId, setClientId] = useState("");
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const clients = useQuery({
    queryKey: ["clients", q],
    queryFn: () => flask.get<PageRes<Client>>(`/api/web/clients?q=${encodeURIComponent(q)}&per_page=30`),
  });

  const selectedModel = useMemo(
    () => models.find((m) => String(m.id) === modelId) || lockedModel || null,
    [models, modelId, lockedModel],
  );
  const steps = selectedModel?.steps || [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!modelId && !defaultModelId) {
      setError("Selecione um modelo.");
      return;
    }
    if (!clientId) {
      setError("Selecione um cliente.");
      return;
    }
    const client = (clients.data?.items || []).find((c) => String(c.id) === clientId);
    setSaving(true);
    try {
      const created = await flask.post<ImplantationDetail>("/api/implantacao/items", {
        model_id: Number(modelId || defaultModelId),
        external_client_id: Number(clientId),
        external_client_name: client?.name || "",
        step_id: stepId ? Number(stepId) : undefined,
        notes,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar implantação");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      {!lockedModel ? (
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Modelo</span>
          <select
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              setStepId("");
            }}
            className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
          >
            <option value="">Selecione…</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.system_name ? `· ${m.system_name}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-muted">
          Modelo: <span className="font-medium text-ink">{lockedModel.name}</span>
          {lockedModel.system_name ? ` · ${lockedModel.system_name}` : ""}
        </p>
      )}

      <UnderlineField label="Buscar cliente" value={q} onChange={setQ} placeholder="Nome, documento…" />
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Cliente</span>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
        >
          <option value="">Selecione…</option>
          {(clients.data?.items || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Etapa inicial</span>
        <select
          value={stepId}
          onChange={(e) => setStepId(e.target.value)}
          className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
        >
          <option value="">Primeira etapa</option>
          {steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.duration_label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Notas</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full resize-y rounded-xl border border-line bg-transparent px-3 py-2 text-[15px] text-ink"
        />
      </label>

      {error ? <p className="text-sm text-open">{error}</p> : null}
      <PrimaryButton type="submit" disabled={saving}>
        {saving ? "Adicionando…" : "Adicionar ao Kanban"}
      </PrimaryButton>
    </form>
  );
}
