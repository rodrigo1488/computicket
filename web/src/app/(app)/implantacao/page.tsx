"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { ImplantationForm } from "@/components/implantacao/ImplantationForm";
import { KanbanBoard } from "@/components/implantacao/KanbanBoard";
import type {
  ImplantationCard,
  ImplantationDetail,
  ImplantationModel,
  ImplantationSystem,
  KanbanBoardData,
} from "@/components/implantacao/types";
import { COMPLETED_COLUMN_KEY } from "@/components/implantacao/types";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, type PageRes } from "@/lib/api";

function ImplantacaoBoardInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [systemId, setSystemId] = useState("");
  const [modelId, setModelId] = useState(() => params.get("model") || "");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  useEffect(() => {
    const fromUrl = params.get("model") || "";
    if (fromUrl && fromUrl !== modelId) setModelId(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from notification links
  }, [params]);

  const systems = useQuery({
    queryKey: ["implantacao-systems"],
    queryFn: () => flask.get<{ items: ImplantationSystem[] }>("/api/implantacao/systems"),
  });

  const models = useQuery({
    queryKey: ["implantacao-models", "active", systemId],
    queryFn: () => {
      const qs = new URLSearchParams({ active: "1", per_page: "100" });
      if (systemId) qs.set("system_id", systemId);
      return flask.get<PageRes<ImplantationModel>>(`/api/implantacao/models?${qs}`);
    },
  });

  const modelOptions = models.data?.items || [];
  const selectedModel = useMemo(
    () => modelOptions.find((m) => String(m.id) === modelId) || null,
    [modelOptions, modelId],
  );

  useEffect(() => {
    if (!modelId && modelOptions.length === 1) {
      setModelId(String(modelOptions[0].id));
    }
  }, [modelId, modelOptions]);

  useEffect(() => {
    if (!modelId) return;
    const next = new URLSearchParams(params.toString());
    if (next.get("model") === modelId) return;
    next.set("model", modelId);
    router.replace(`/implantacao?${next.toString()}`, { scroll: false });
  }, [modelId, params, router]);

  const board = useQuery({
    queryKey: ["implantacao-board", modelId, q],
    queryFn: () =>
      flask.get<KanbanBoardData>(
        `/api/implantacao/board?model_id=${encodeURIComponent(modelId)}&q=${encodeURIComponent(q)}`,
      ),
    enabled: !!modelId,
    placeholderData: (previousData) => previousData,
  });

  const detail = useQuery({
    queryKey: ["implantacao-item", detailId],
    queryFn: () => flask.get<ImplantationDetail>(`/api/implantacao/${detailId}`),
    enabled: detailId != null,
  });

  useEffect(() => {
    if (detail.data) setNotesDraft(detail.data.notes || "");
  }, [detail.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["implantacao-board"] });
    qc.invalidateQueries({ queryKey: ["implantacao-item"] });
    qc.invalidateQueries({ queryKey: ["implantacao-models"] });
  };

  const move = useMutation({
    mutationFn: ({ id, columnKey }: { id: number; columnKey: string }) => {
      if (columnKey === COMPLETED_COLUMN_KEY) {
        return flask.post(`/api/implantacao/${id}/move`, { completed: true });
      }
      return flask.post(`/api/implantacao/${id}/move`, { step_id: Number(columnKey) });
    },
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao mover"),
  });

  const complete = useMutation({
    mutationFn: (id: number) => flask.post(`/api/implantacao/${id}/complete`),
    onSuccess: () => {
      setDetailId(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao concluir"),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => flask.post(`/api/implantacao/${id}/cancel`),
    onSuccess: () => {
      setDetailId(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao cancelar"),
  });

  const saveNotes = useMutation({
    mutationFn: (id: number) => flask.patch(`/api/implantacao/${id}`, { notes: notesDraft }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao salvar notas"),
  });

  const openCard = (card: ImplantationCard) => setDetailId(card.id);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-0">Implantação</PageTitle>
          <p className="mt-1 text-sm text-muted">Acompanhe cada cliente no estágio atual da implantação.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/implantacao/modelos"
            className="inline-flex h-10 items-center rounded-xl bg-wash px-4 text-sm font-medium text-ink hover:bg-line"
          >
            Modelos
          </Link>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!modelId}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Nova implantação
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Sistema</span>
          <select
            value={systemId}
            onChange={(e) => {
              setSystemId(e.target.value);
              setModelId("");
            }}
            className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm text-ink"
          >
            <option value="">Todos</option>
            {(systems.data?.items || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Modelo</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm text-ink"
          >
            <option value="">Selecione um modelo</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Cliente</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar no board…"
            className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted"
          />
        </label>
      </div>

      {error ? <p className="mb-4 text-sm text-open">{error}</p> : null}

      {!modelId ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm text-muted">
            Selecione um modelo para ver o Kanban
            {modelOptions.length === 0 ? ", ou cadastre o primeiro modelo." : "."}
          </p>
          <Link href="/implantacao/modelos" className="mt-4 inline-block text-sm font-medium text-navy">
            Ir para modelos
          </Link>
        </div>
      ) : board.isLoading ? (
        <p className="text-sm text-muted">Carregando board…</p>
      ) : board.isError ? (
        <p className="text-sm text-open">Não foi possível carregar as implantações.</p>
      ) : board.data ? (
        <div>
          {board.data.overdue_count > 0 ? (
            <p className="mb-3 text-sm text-open">
              {board.data.overdue_count} etapa{board.data.overdue_count === 1 ? "" : "s"} com prazo estourado
            </p>
          ) : null}
          <KanbanBoard
            columns={board.data.columns}
            onOpen={openCard}
            onMove={(id, columnKey) => {
              setError("");
              move.mutate({ id, columnKey });
            }}
          />
        </div>
      ) : null}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova implantação" wide>
        <ImplantationForm
          models={board.data?.model ? [board.data.model] : selectedModel ? [selectedModel] : modelOptions}
          defaultModelId={modelId ? Number(modelId) : null}
          onCreated={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      </Modal>

      <Modal
        open={detailId != null}
        onClose={() => setDetailId(null)}
        title={detail.data?.external_client_name || "Implantação"}
        wide
      >
        {detail.isLoading ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : detail.data ? (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-muted">
                {detail.data.model_name}
                {detail.data.system_name ? ` · ${detail.data.system_name}` : ""}
              </p>
              <p className={detail.data.overdue ? "mt-1 font-medium text-open" : "mt-1 text-ink"}>
                {detail.data.current_step_name} · {detail.data.due_label}
              </p>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Histórico</p>
              <ul className="space-y-2">
                {(detail.data.logs || []).map((log) => (
                  <li key={log.id} className="rounded-xl border border-line px-3 py-2">
                    <p className="font-medium text-ink">{log.step_name}</p>
                    <p className="text-xs text-muted">
                      Entrou {log.entered_at_label || "—"}
                      {log.due_at_label ? ` · prazo ${log.due_at_label}` : ""}
                      {log.completed_at_label ? ` · saiu ${log.completed_at_label}` : " · em andamento"}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <UnderlineField label="Notas" value={notesDraft} onChange={setNotesDraft} />
            <PrimaryButton
              type="button"
              disabled={saveNotes.isPending}
              onClick={() => detailId && saveNotes.mutate(detailId)}
            >
              {saveNotes.isPending ? "Salvando…" : "Salvar notas"}
            </PrimaryButton>
            {detail.data.status === "in_progress" ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => detailId && complete.mutate(detailId)}
                  className="flex-1 rounded-xl bg-done-bg py-3 text-sm font-medium text-done"
                >
                  Concluir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (detailId && window.confirm("Cancelar esta implantação?")) cancel.mutate(detailId);
                  }}
                  className="flex-1 rounded-xl bg-open-bg py-3 text-sm font-medium text-open"
                >
                  Cancelar
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default function ImplantacaoPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <ImplantacaoBoardInner />
    </Suspense>
  );
}
