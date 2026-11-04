"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import {
  helpdesk,
  type AiWhatsappAgent,
  type AiWhatsappAgentPayload,
  type HelpdeskAssignee,
  type HelpdeskQueue,
  type WhatsappGroupContact,
} from "@/lib/helpdesk";

type Draft = {
  name: string;
  prompt: string;
  queueId: string;
  canTransferToAgent: boolean;
  canTransferToUser: boolean;
  answerFromKnowledge: boolean;
  permitirCriarAgendamentos: boolean;
  fallbackQueueId: string;
  fallbackUserId: string;
  idleAlertEnabled: boolean;
  idleAlertMinutes: string;
  idleAlertGroupJid: string;
};

const EMPTY: Draft = {
  name: "",
  prompt: "",
  queueId: "",
  canTransferToAgent: true,
  canTransferToUser: true,
  answerFromKnowledge: true,
  permitirCriarAgendamentos: false,
  fallbackQueueId: "",
  fallbackUserId: "",
  idleAlertEnabled: false,
  idleAlertMinutes: "30",
  idleAlertGroupJid: "",
};

function fromAgent(agent: AiWhatsappAgent): Draft {
  return {
    name: agent.name || "",
    prompt: agent.prompt || "",
    queueId: agent.queueId ? String(agent.queueId) : "",
    canTransferToAgent: !!agent.canTransferToAgent,
    canTransferToUser: !!agent.canTransferToUser,
    answerFromKnowledge: !!agent.answerFromKnowledge,
    permitirCriarAgendamentos: !!agent.permitirCriarAgendamentos,
    fallbackQueueId: agent.fallbackQueueId ? String(agent.fallbackQueueId) : "",
    fallbackUserId: agent.fallbackUserId ? String(agent.fallbackUserId) : "",
    idleAlertEnabled: !!agent.idleAlertEnabled,
    idleAlertMinutes: String(agent.idleAlertMinutes || 30),
    idleAlertGroupJid: agent.idleAlertGroupJid || "",
  };
}

function toPayload(draft: Draft): AiWhatsappAgentPayload {
  const minutes = Number(draft.idleAlertMinutes);
  return {
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    queueId: draft.queueId ? Number(draft.queueId) : null,
    canTransferToAgent: draft.canTransferToAgent,
    canTransferToUser: draft.canTransferToUser,
    answerFromKnowledge: draft.answerFromKnowledge,
    permitirCriarAgendamentos: draft.permitirCriarAgendamentos,
    fallbackQueueId: draft.fallbackQueueId ? Number(draft.fallbackQueueId) : null,
    fallbackUserId: draft.fallbackUserId ? Number(draft.fallbackUserId) : null,
    idleAlertEnabled: draft.idleAlertEnabled,
    idleAlertMinutes: Number.isFinite(minutes) ? minutes : 30,
    idleAlertGroupJid: draft.idleAlertGroupJid || null,
  };
}

function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
      >
        {children}
      </select>
    </label>
  );
}

function AgentForm({
  initial,
  queues,
  assignees,
  groups,
  onClose,
}: {
  initial: AiWhatsappAgent | null;
  queues: HelpdeskQueue[];
  assignees: HelpdeskAssignee[];
  groups: WhatsappGroupContact[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(initial ? fromAgent(initial) : EMPTY);
  const patch = (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial }));

  const idleMissingGroup = draft.idleAlertEnabled && !draft.idleAlertGroupJid;
  const save = useMutation({
    mutationFn: () => {
      const payload = toPayload(draft);
      return initial?.id ? helpdesk.updateAiAgent(initial.id, payload) : helpdesk.createAiAgent(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-ai-agents"] });
      onClose();
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim() && draft.prompt.trim() && draft.queueId && !idleMissingGroup) save.mutate();
      }}
    >
      <UnderlineField label="Nome" value={draft.name} onChange={(name) => patch({ name })} placeholder="Recepção" />
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Instruções</span>
        <textarea
          value={draft.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          rows={5}
          placeholder="Como o agente se apresenta, o que pode resolver e quando deve chamar uma pessoa."
          className="mt-1 w-full resize-y border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink placeholder:text-muted"
        />
      </label>
      <SelectField label="Fila" value={draft.queueId} onChange={(queueId) => patch({ queueId })}>
        <option value="">Selecione</option>
        {queues.map((queue) => (
          <option key={queue.id} value={queue.id}>
            {queue.name}
          </option>
        ))}
      </SelectField>
      <div className="space-y-3">
        <Check
          label="Transferir para filas"
          checked={draft.canTransferToAgent}
          onChange={(canTransferToAgent) => patch({ canTransferToAgent })}
        />
        <Check
          label="Transferir para usuários"
          checked={draft.canTransferToUser}
          onChange={(canTransferToUser) => patch({ canTransferToUser })}
        />
        <Check
          label="Responder com a base de conhecimento"
          hint="Sem evidência, a pergunta vai para o fallback."
          checked={draft.answerFromKnowledge}
          onChange={(answerFromKnowledge) => patch({ answerFromKnowledge })}
        />
        <Check
          label="Criar agendamentos na agenda"
          checked={draft.permitirCriarAgendamentos}
          onChange={(permitirCriarAgendamentos) => patch({ permitirCriarAgendamentos })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Fila de fallback"
          value={draft.fallbackQueueId}
          onChange={(fallbackQueueId) => patch({ fallbackQueueId })}
        >
          <option value="">Nenhuma</option>
          {queues.map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Usuário de fallback"
          value={draft.fallbackUserId}
          onChange={(fallbackUserId) => patch({ fallbackUserId })}
        >
          <option value="">Nenhum</option>
          {assignees
            .filter((user) => user.engine_user_id)
            .map((user) => (
              <option key={user.engine_user_id} value={user.engine_user_id}>
                {user.name}
              </option>
            ))}
        </SelectField>
      </div>
      <Check
        label="Alertar grupo quando a conversa ficar sem resposta"
        checked={draft.idleAlertEnabled}
        onChange={(idleAlertEnabled) => patch({ idleAlertEnabled })}
      />
      {draft.idleAlertEnabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <UnderlineField
            label="Minutos sem resposta"
            type="number"
            value={draft.idleAlertMinutes}
            onChange={(idleAlertMinutes) => patch({ idleAlertMinutes })}
          />
          <SelectField
            label="Grupo"
            value={draft.idleAlertGroupJid}
            onChange={(idleAlertGroupJid) => patch({ idleAlertGroupJid })}
          >
            <option value="">Selecione</option>
            {groups.map((group) => (
              <option key={group.id} value={group.number || ""}>
                {group.name || group.number}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      {idleMissingGroup ? (
        <p className="text-sm text-open">Escolha o grupo que recebe o alerta.</p>
      ) : null}
      {save.error ? <p className="text-sm text-open">{(save.error as Error).message}</p> : null}
      <div className="flex justify-end">
        <PrimaryButton
          type="submit"
          disabled={save.isPending || !draft.name.trim() || !draft.prompt.trim() || !draft.queueId || idleMissingGroup}
        >
          {save.isPending ? "Salvando…" : "Salvar agente"}
        </PrimaryButton>
      </div>
    </form>
  );
}

export function AiAgentsPanel({ queues }: { queues: HelpdeskQueue[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AiWhatsappAgent | null | undefined>(undefined);
  const agents = useQuery({ queryKey: ["hd-ai-agents"], queryFn: helpdesk.aiAgents });
  const groups = useQuery({
    queryKey: ["hd-ai-groups"],
    queryFn: helpdesk.aiAgentGroups,
    enabled: editing !== undefined,
  });
  const assignees = useQuery({
    queryKey: ["hd-assignees"],
    queryFn: helpdesk.assignees,
    enabled: editing !== undefined,
  });
  const remove = useMutation({
    mutationFn: (id: number) => helpdesk.deleteAiAgent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-ai-agents"] }),
  });

  const queueName = (id?: number | null) => queues.find((queue) => queue.id === id)?.name;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          O agente responde no WhatsApp enquanto ninguém assume a conversa. Perguntas sem fonte na base vão para a fila ou o usuário de fallback.
        </p>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          Novo agente
        </button>
      </div>
      {agents.error ? <p className="mb-3 text-sm text-open">{(agents.error as Error).message}</p> : null}
      {(agents.data || []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Nenhum agente de IA. Crie um e vincule a uma fila da conexão.
        </p>
      ) : (
        <ul className="space-y-2">
          {(agents.data || []).map((agent) => (
            <li key={agent.id} className="flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{agent.name}</p>
                <p className="mt-1 text-xs text-muted">
                  Fila: {queueName(agent.queueId) || "sem fila"}
                  {agent.answerFromKnowledge ? " · base de conhecimento" : ""}
                  {agent.permitirCriarAgendamentos ? " · agenda" : ""}
                  {agent.idleAlertEnabled ? ` · alerta em ${agent.idleAlertMinutes} min` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-wash" onClick={() => setEditing(agent)}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-open hover:bg-open-bg"
                  onClick={() => {
                    if (window.confirm(`Excluir o agente ${agent.name}?`)) remove.mutate(agent.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {remove.error ? <p className="mt-3 text-sm text-open">{(remove.error as Error).message}</p> : null}
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing?.id ? "Editar agente de IA" : "Novo agente de IA"}
        wide
      >
        {editing !== undefined ? (
          <AgentForm
            initial={editing}
            queues={queues}
            assignees={assignees.data || []}
            groups={groups.data || []}
            onClose={() => setEditing(undefined)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
