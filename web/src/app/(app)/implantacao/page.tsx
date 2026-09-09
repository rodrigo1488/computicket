"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { ImplantationForm } from "@/components/implantacao/ImplantationForm";
import { KanbanBoard } from "@/components/implantacao/KanbanBoard";
import { TechnicianSelect } from "@/components/implantacao/TechnicianSelect";
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

function toDatetimeLocal(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Envia o valor de datetime-local sem toISOString() (que converteria para UTC). */
function datetimeLocalPayload(value: string) {
  const text = (value || "").trim();
  if (!text) return text;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return text;
}

/** ISO naive do backend = horário de Brasília; ISO com Z é convertido para local. */
function isoToDatetimeLocal(value?: string | null) {
  if (!value) return toDatetimeLocal();
  const text = value.trim();
  const hasTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(text);
  if (!hasTz) {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(text);
    if (m) return `${m[1]}T${m[2]}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return toDatetimeLocal();
  return toDatetimeLocal(parsed);
}

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
  const [assignedDraft, setAssignedDraft] = useState("");
  const [stepAssigneeDraft, setStepAssigneeDraft] = useState("inherit");
  const [movePrompt, setMovePrompt] = useState<{ id: number; columnKey: string } | null>(null);
  const [moveAssignee, setMoveAssignee] = useState("inherit");
  const [scheduleWhen, setScheduleWhen] = useState(() => toDatetimeLocal());

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
    if (!detail.data) return;
    setNotesDraft(detail.data.notes || "");
    setAssignedDraft(detail.data.assigned_to_id ? String(detail.data.assigned_to_id) : "");
    setStepAssigneeDraft(detail.data.step_assignee_id ? String(detail.data.step_assignee_id) : "inherit");
    setScheduleWhen(isoToDatetimeLocal(detail.data.scheduled_at));
  }, [detail.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["implantacao-board"] });
    qc.invalidateQueries({ queryKey: ["implantacao-item"] });
    qc.invalidateQueries({ queryKey: ["implantacao-models"] });
    qc.invalidateQueries({ queryKey: ["implantacao-dashboard"] });
    qc.invalidateQueries({ queryKey: ["agenda-cal"] });
  };

  const move = useMutation({
    mutationFn: ({ id, columnKey, assigneeId }: { id: number; columnKey: string; assigneeId?: string }) => {
      const body: Record<string, unknown> = {};
      if (assigneeId && assigneeId !== "inherit") body.assignee_id = Number(assigneeId);
      else body.assignee_id = null;
      if (columnKey === COMPLETED_COLUMN_KEY) {
        return flask.post(`/api/implantacao/${id}/move`, { completed: true, ...body });
      }
      return flask.post(`/api/implantacao/${id}/move`, { step_id: Number(columnKey), ...body });
    },
    onSuccess: () => {
      setMovePrompt(null);
      invalidate();
    },
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

  const saveAssignees = useMutation({
    mutationFn: (id: number) =>
      flask.patch(`/api/implantacao/${id}`, {
        assigned_to_id: assignedDraft ? Number(assignedDraft) : null,
        assignee_id: stepAssigneeDraft === "inherit" ? null : Number(stepAssigneeDraft),
      }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao salvar responsável"),
  });

  const saveNotes = useMutation({
    mutationFn: (id: number) => flask.patch(`/api/implantacao/${id}`, { notes: notesDraft }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao salvar notas"),
  });

  const scheduleNext = useMutation({
    mutationFn: (id: number) =>
      flask.post(`/api/implantacao/${id}/schedule-next`, {
        appointment_date: datetimeLocalPayload(scheduleWhen),
      }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao agendar etapa"),
  });

  const cancelSchedule = useMutation({
    mutationFn: (id: number) => flask.delete(`/api/implantacao/${id}/schedule-next`),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao cancelar agendamento"),
  });

  const pause = useMutation({
    mutationFn: (id: number) => flask.post(`/api/implantacao/${id}/pause`),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao pausar"),
  });

  const resume = useMutation({
    mutationFn: (id: number) => flask.post(`/api/implantacao/${id}/resume`),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao retomar"),
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
              if (columnKey === COMPLETED_COLUMN_KEY) {
                move.mutate({ id, columnKey });
                return;
              }
              setMoveAssignee("inherit");
              setMovePrompt({ id, columnKey });
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
              <p className="mt-1 text-xs text-ink">
                Responsável atual: {detail.data.current_assignee_name || "não atribuído"}
              </p>
              {detail.data.ticket_id ? (
                <Link href={`/tickets/${detail.data.ticket_id}`} className="mt-1 inline-block text-xs font-medium text-navy">
                  Ticket da etapa #{detail.data.ticket_id}
                </Link>
              ) : null}
              {detail.data.status === "paused" ? (
                <p className="mt-1 text-xs text-warn-fg">
                  {detail.data.paused_for_label || `Pausada em ${detail.data.paused_at_label || "—"}`}
                </p>
              ) : null}
              {detail.data.scheduled_at_label ? (
                <p className="mt-1 text-xs text-progress">
                  Próxima etapa agendada: {detail.data.scheduled_step_name} · {detail.data.scheduled_at_label}
                </p>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TechnicianSelect
                label="Responsável da implantação"
                value={assignedDraft}
                onChange={setAssignedDraft}
                emptyLabel="Não atribuído"
              />
              <TechnicianSelect
                label="Responsável da etapa atual"
                value={stepAssigneeDraft}
                onChange={setStepAssigneeDraft}
                inheritLabel={
                  detail.data.assigned_to_name
                    ? `Herdar da implantação (${detail.data.assigned_to_name})`
                    : "Herdar da implantação"
                }
              />
            </div>
            <PrimaryButton
              type="button"
              disabled={saveAssignees.isPending}
              onClick={() => detailId && saveAssignees.mutate(detailId)}
            >
              {saveAssignees.isPending ? "Salvando…" : "Salvar responsáveis"}
            </PrimaryButton>
            {detail.data.next_step_name && detail.data.status !== "completed" && detail.data.status !== "cancelled" ? (
              <div className="rounded-xl border border-line p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Agendar próxima etapa</p>
                <p className="mt-1 text-ink">{detail.data.next_step_name}</p>
                <label className="mt-3 block">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Data e horário</span>
                  <input
                    type="datetime-local"
                    value={scheduleWhen}
                    onChange={(e) => setScheduleWhen(e.target.value)}
                    className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={scheduleNext.isPending}
                    onClick={() => detailId && scheduleNext.mutate(detailId)}
                    className="rounded-xl bg-progress-bg px-4 py-2 text-sm font-medium text-progress disabled:opacity-60"
                  >
                    {scheduleNext.isPending ? "Agendando…" : "Agendar na Agenda"}
                  </button>
                  {detail.data.scheduled_appointment_id ? (
                    <button
                      type="button"
                      disabled={cancelSchedule.isPending}
                      onClick={() => detailId && cancelSchedule.mutate(detailId)}
                      className="rounded-xl bg-wash px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
                    >
                      Cancelar agendamento
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Histórico</p>
              <ul className="space-y-2">
                {(detail.data.logs || []).map((log) => (
                  <li key={log.id} className="rounded-xl border border-line px-3 py-2">
                    <p className="font-medium text-ink">{log.step_name}</p>
                    <p className="text-xs text-muted">
                      Entrou {log.entered_at_label || "—"}
                      {log.due_at_label ? ` · prazo ${log.due_at_label}` : ""}
                      {log.completed_at_label
                        ? ` · saiu ${log.completed_at_label}`
                        : detail.data.status === "paused"
                          ? " · pausada"
                          : " · em andamento"}
                      {log.assignee_name ? ` · ${log.assignee_name}` : ""}
                    </p>
                    {log.ticket_id ? (
                      <Link href={`/tickets/${log.ticket_id}`} className="mt-1 inline-block text-xs font-medium text-navy">
                        Ticket #{log.ticket_id}
                      </Link>
                    ) : null}
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => detailId && pause.mutate(detailId)}
                  disabled={pause.isPending}
                  className="flex-1 rounded-xl bg-warn-bg py-3 text-sm font-medium text-warn-fg disabled:opacity-60"
                >
                  {pause.isPending ? "Pausando…" : "Pausar"}
                </button>
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
            {detail.data.status === "paused" ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => detailId && resume.mutate(detailId)}
                  disabled={resume.isPending}
                  className="flex-1 rounded-xl bg-progress-bg py-3 text-sm font-medium text-progress disabled:opacity-60"
                >
                  {resume.isPending ? "Retomando…" : "Retomar"}
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

      <Modal open={movePrompt != null} onClose={() => setMovePrompt(null)} title="Mover etapa">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Atribua o técnico desta etapa ou herde o responsável da implantação.
          </p>
          <TechnicianSelect
            label="Técnico da etapa"
            value={moveAssignee}
            onChange={setMoveAssignee}
            inheritLabel="Herdar da implantação"
          />
          <PrimaryButton
            type="button"
            disabled={move.isPending || !movePrompt}
            onClick={() => {
              if (!movePrompt) return;
              move.mutate({ id: movePrompt.id, columnKey: movePrompt.columnKey, assigneeId: moveAssignee });
            }}
          >
            {move.isPending ? "Movendo…" : "Confirmar"}
          </PrimaryButton>
        </div>
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
