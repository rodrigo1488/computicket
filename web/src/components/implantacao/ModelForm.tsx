"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useState } from "react";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import type { DurationUnit, ImplantationModel, ImplantationSystem } from "@/components/implantacao/types";

type StepDraft = {
  id?: number;
  name: string;
  description: string;
  duration_value: string;
  duration_unit: DurationUnit;
};

export function emptyStep(): StepDraft {
  return { name: "", description: "", duration_value: "5", duration_unit: "days" };
}

export function ModelForm({
  initial,
  onSaved,
}: {
  initial?: ImplantationModel | null;
  onSaved: (model: ImplantationModel) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [systemId, setSystemId] = useState(initial?.system_id ? String(initial.system_id) : "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [steps, setSteps] = useState<StepDraft[]>(
    initial?.steps?.length
      ? initial.steps.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description || "",
          duration_value: String(s.duration_value),
          duration_unit: s.duration_unit,
        }))
      : [emptyStep()],
  );
  const [newSystem, setNewSystem] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const systems = useQuery({
    queryKey: ["implantacao-systems"],
    queryFn: () => flask.get<{ items: ImplantationSystem[] }>("/api/implantacao/systems"),
  });

  const createSystem = useMutation({
    mutationFn: (sysName: string) =>
      flask.post<ImplantationSystem>("/api/implantacao/systems", { name: sysName }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["implantacao-systems"] });
      setSystemId(String(created.id));
      setNewSystem("");
      setError("");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao criar sistema"),
  });

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setSteps((list) => list.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return list;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Informe o nome do modelo.");
      return;
    }
    if (!systemId) {
      setError("Selecione um sistema.");
      return;
    }
    const payloadSteps = steps
      .map((step) => ({
        id: step.id,
        name: step.name.trim(),
        description: step.description.trim(),
        duration_value: Number(step.duration_value),
        duration_unit: step.duration_unit,
      }))
      .filter((step) => step.name);
    if (!payloadSteps.length) {
      setError("Inclua ao menos um passo.");
      return;
    }
    if (payloadSteps.some((step) => !Number.isFinite(step.duration_value) || step.duration_value < 1)) {
      setError("Cada passo precisa de um prazo maior que zero.");
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      description: description.trim(),
      system_id: Number(systemId),
      is_active: isActive,
      steps: payloadSteps,
    };
    try {
      const saved = initial?.id
        ? await flask.patch<ImplantationModel>(`/api/implantacao/models/${initial.id}`, body)
        : await flask.post<ImplantationModel>("/api/implantacao/models", body);
      qc.invalidateQueries({ queryKey: ["implantacao-models"] });
      qc.invalidateQueries({ queryKey: ["implantacao-board"] });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar modelo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <UnderlineField label="Nome do modelo" value={name} onChange={setName} />
      <UnderlineField label="Descrição" value={description} onChange={setDescription} />

      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Sistema</span>
        <select
          value={systemId}
          onChange={(e) => setSystemId(e.target.value)}
          className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
        >
          <option value="">Selecione…</option>
          {(systems.data?.items || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <UnderlineField
            label="Novo sistema"
            value={newSystem}
            onChange={setNewSystem}
            placeholder="Nome do sistema"
          />
        </div>
        <button
          type="button"
          disabled={!newSystem.trim() || createSystem.isPending}
          onClick={() => createSystem.mutate(newSystem.trim())}
          className="mt-5 h-10 shrink-0 rounded-xl bg-wash px-3 text-sm font-medium text-ink hover:bg-line disabled:opacity-50"
        >
          {createSystem.isPending ? "Criando…" : "Criar"}
        </button>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Passos</p>
          <button
            type="button"
            onClick={() => setSteps((list) => [...list, emptyStep()])}
            className="inline-flex items-center gap-1 text-sm text-ink hover:text-navy"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar passo
          </button>
        </div>
        <ul className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.id ?? `new-${index}`} className="rounded-xl border border-line bg-canvas/60 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-6 shrink-0 text-center text-xs font-semibold text-muted">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-3">
                  <UnderlineField
                    label="Nome da etapa"
                    value={step.name}
                    onChange={(v) => updateStep(index, { name: v })}
                  />
                  <label className="block">
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                      Descrição do passo
                    </span>
                    <textarea
                      value={step.description}
                      onChange={(e) => updateStep(index, { description: e.target.value })}
                      rows={3}
                      placeholder="O que deve ser feito nesta etapa…"
                      className="mt-1 w-full resize-y rounded-xl border border-line bg-transparent px-3 py-2 text-[15px] text-ink placeholder:text-muted"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <UnderlineField
                      label="Prazo"
                      type="number"
                      value={step.duration_value}
                      onChange={(v) => updateStep(index, { duration_value: v })}
                    />
                    <label className="block">
                      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Unidade</span>
                      <select
                        value={step.duration_unit}
                        onChange={(e) => updateStep(index, { duration_unit: e.target.value as DurationUnit })}
                        className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
                      >
                        <option value="days">Dias</option>
                        <option value="hours">Horas</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-wash disabled:opacity-30"
                    aria-label="Subir passo"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === steps.length - 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-wash disabled:opacity-30"
                    aria-label="Descer passo"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSteps((list) => (list.length <= 1 ? list : list.filter((_, i) => i !== index)))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-open hover:bg-open-bg"
                    aria-label="Remover passo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Modelo ativo
      </label>

      {error ? <p className="text-sm text-open">{error}</p> : null}
      <PrimaryButton type="submit" disabled={saving}>
        {saving ? "Salvando…" : initial?.id ? "Salvar modelo" : "Criar modelo"}
      </PrimaryButton>
    </form>
  );
}
