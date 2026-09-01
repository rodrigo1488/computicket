"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, PlugZap, Plus, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { cn } from "@/lib/cn";
import {
  helpdesk,
  unwrapConnections,
  unwrapQuickMessages,
  type ConnectionPayload,
  type HelpdeskConnection,
  type HelpdeskQueue,
  type QueuePayload,
  type QueueSchedule,
  type QuickMessage,
} from "@/lib/helpdesk";

export type WhatsappSection = "filas" | "agentes" | "conexoes" | "rapidas";

const SECTIONS: { key: WhatsappSection; label: string }[] = [
  { key: "filas", label: "Filas" },
  { key: "agentes", label: "Agentes" },
  { key: "rapidas", label: "Mensagens rápidas" },
  { key: "conexoes", label: "Conexões" },
];

const WEEKDAYS: { weekdayEn: string; weekday: string }[] = [
  { weekdayEn: "monday", weekday: "Segunda-feira" },
  { weekdayEn: "tuesday", weekday: "Terça-feira" },
  { weekdayEn: "wednesday", weekday: "Quarta-feira" },
  { weekdayEn: "thursday", weekday: "Quinta-feira" },
  { weekdayEn: "friday", weekday: "Sexta-feira" },
  { weekdayEn: "saturday", weekday: "Sábado" },
  { weekdayEn: "sunday", weekday: "Domingo" },
];

type DayDraft = { weekdayEn: string; weekday: string; startTime: string; endTime: string; enabled: boolean };

function emptyDays(): DayDraft[] {
  return WEEKDAYS.map((d) => ({
    ...d,
    startTime: "08:00",
    endTime: d.weekdayEn === "saturday" ? "12:00" : "18:00",
    enabled: d.weekdayEn !== "sunday",
  }));
}

function parseSchedules(raw?: QueueSchedule[] | null): { enabled: boolean; days: DayDraft[] } {
  if (!raw?.length) return { enabled: false, days: emptyDays() };
  const days = WEEKDAYS.map((d) => {
    const found = raw.find((s) => s.weekdayEn === d.weekdayEn);
    const start = found?.startTime || "";
    const end = found?.endTime || "";
    const on = !!(start && end && !(start === "00:00" && end === "00:00"));
    return { ...d, startTime: start || "08:00", endTime: end || "18:00", enabled: on };
  });
  return { enabled: days.some((d) => d.enabled), days };
}

function toSchedules(days: DayDraft[], enabled: boolean): QueueSchedule[] {
  if (!enabled) return [];
  return days.map((d) => ({
    weekday: d.weekday,
    weekdayEn: d.weekdayEn,
    startTime: d.enabled ? d.startTime : "",
    endTime: d.enabled ? d.endTime : "",
  }));
}

function scheduleSummary(raw?: QueueSchedule[] | null) {
  if (!raw?.length) return "Sem expediente (sem bloqueio)";
  const open = raw.filter((s) => s.startTime && s.endTime && !(s.startTime === "00:00" && s.endTime === "00:00"));
  if (!open.length) return "Sem expediente (sem bloqueio)";
  return open.map((s) => `${s.weekday.slice(0, 3)} ${s.startTime}–${s.endTime}`).join(" · ");
}

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#0EA5E9"];

function statusLabel(status?: string) {
  const s = (status || "").toLowerCase();
  if (s === "connected") return "Conectado";
  if (s === "qrcode") return "Aguardando QR";
  if (s === "opening") return "Abrindo…";
  if (s === "disconnected" || s === "pending") return "Desconectado";
  if (s === "timeout") return "Timeout";
  return status || "—";
}

function statusClass(status?: string) {
  const s = (status || "").toLowerCase();
  if (s === "connected") return "bg-done-bg text-done";
  if (s === "qrcode" || s === "opening") return "bg-progress-bg text-progress";
  return "bg-wash text-muted";
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="mt-1 w-full resize-y border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink placeholder:text-muted"
      />
      {hint ? <p className="mt-1 text-xs italic text-muted">{hint}</p> : null}
    </label>
  );
}

function QueueChips({
  queues,
  selected,
  onToggle,
}: {
  queues: HelpdeskQueue[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  if (!queues.length) {
    return <p className="text-sm text-muted">Crie uma fila antes de atribuir.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {queues.map((q) => {
        const on = selected.includes(q.id);
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onToggle(q.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold uppercase",
              on ? "border-transparent text-white" : "border-line bg-surface text-muted",
            )}
            style={on ? { background: q.color || "#3b82f6" } : undefined}
          >
            {q.name}
          </button>
        );
      })}
    </div>
  );
}

function QueueForm({
  initial,
  onClose,
}: {
  initial?: HelpdeskQueue | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || "");
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [greeting, setGreeting] = useState(initial?.greetingMessage || "");
  const [outOfHours, setOutOfHours] = useState(initial?.outOfHoursMessage || "");
  const [attach, setAttach] = useState(true);
  const parsed = parseSchedules(initial?.schedules);
  const [hoursOn, setHoursOn] = useState(parsed.enabled);
  const [days, setDays] = useState<DayDraft[]>(parsed.days);

  const save = useMutation({
    mutationFn: () => {
      const payload: QueuePayload = {
        name: name.trim(),
        color,
        greetingMessage: greeting,
        outOfHoursMessage: outOfHours,
        attachToConnections: attach,
        schedules: toSchedules(days, hoursOn),
      };
      return initial?.id ? helpdesk.updateQueue(initial.id, payload) : helpdesk.createQueue(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-queues"] });
      qc.invalidateQueries({ queryKey: ["hd-connections"] });
      onClose();
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <UnderlineField label="Nome da fila" value={name} onChange={setName} placeholder="Ex.: Suporte, Comercial" />
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Cor</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn("h-7 w-7 rounded-full border-2", color === c ? "border-ink" : "border-transparent")}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-line"
          />
        </div>
      </div>
      <TextArea
        label="Mensagem de saudação"
        value={greeting}
        onChange={setGreeting}
        placeholder="Olá! Você chegou na fila de Suporte."
        hint="Enviada quando o contato entra nesta fila."
      />
      <TextArea
        label="Mensagem fora do expediente"
        value={outOfHours}
        onChange={setOutOfHours}
        placeholder="No momento estamos fora do horário. Retornamos em breve."
        hint="Só é enviada se houver expediente configurado e o cliente escrever fora dele."
      />
      <div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={hoursOn} onChange={(e) => setHoursOn(e.target.checked)} />
          <span>
            Definir expediente desta fila
            <span className="mt-0.5 block text-xs text-muted">
              Sem expediente o WhatsApp não bloqueia atendimento. Dias sem horário ficam fechados.
            </span>
          </span>
        </label>
        {hoursOn ? (
          <div className="mt-3 space-y-2">
            {days.map((day) => (
              <div key={day.weekdayEn} className="flex flex-wrap items-center gap-2">
                <label className="flex w-36 items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(e) =>
                      setDays((cur) =>
                        cur.map((d) => (d.weekdayEn === day.weekdayEn ? { ...d, enabled: e.target.checked } : d)),
                      )
                    }
                  />
                  {day.weekday}
                </label>
                <input
                  type="time"
                  disabled={!day.enabled}
                  value={day.startTime}
                  onChange={(e) =>
                    setDays((cur) =>
                      cur.map((d) => (d.weekdayEn === day.weekdayEn ? { ...d, startTime: e.target.value } : d)),
                    )
                  }
                  className="rounded-md border border-line px-2 py-1 text-sm disabled:opacity-40"
                />
                <span className="text-xs text-muted">às</span>
                <input
                  type="time"
                  disabled={!day.enabled}
                  value={day.endTime}
                  onChange={(e) =>
                    setDays((cur) =>
                      cur.map((d) => (d.weekdayEn === day.weekdayEn ? { ...d, endTime: e.target.value } : d)),
                    )
                  }
                  className="rounded-md border border-line px-2 py-1 text-sm disabled:opacity-40"
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {!initial?.id ? (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          <span>
            Vincular às conexões WhatsApp
            <span className="mt-0.5 block text-xs text-muted">
              Sem isso a fila não entra no menu do cliente. O menu é montado na hora com as filas da conexão.
            </span>
          </span>
        </label>
      ) : null}
      {save.error ? <p className="text-sm text-open">{(save.error as Error).message}</p> : null}
      <PrimaryButton type="submit" disabled={save.isPending || !name.trim()}>
        {save.isPending ? "Salvando…" : initial?.id ? "Salvar fila" : "Criar fila"}
      </PrimaryButton>
    </form>
  );
}

function ConnectionForm({
  initial,
  queues,
  onClose,
}: {
  initial?: HelpdeskConnection | null;
  queues: HelpdeskQueue[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || "");
  const [queueIds, setQueueIds] = useState<number[]>(() => (initial?.queues || []).map((q) => q.id));
  const [greeting, setGreeting] = useState(initial?.greetingMessage || "");
  const [completion, setCompletion] = useState(initial?.complationMessage || "");
  const [outOfHours, setOutOfHours] = useState(initial?.outOfHoursMessage || "");
  const [isDefault, setIsDefault] = useState(!!initial?.isDefault);

  const save = useMutation({
    mutationFn: () => {
      const payload: ConnectionPayload = {
        name: name.trim(),
        queueIds,
        greetingMessage: greeting,
        complationMessage: completion,
        outOfHoursMessage: outOfHours,
        isDefault,
      };
      return initial?.id ? helpdesk.updateConnection(initial.id, payload) : helpdesk.createConnection(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-connections"] });
      onClose();
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <UnderlineField label="Nome da conexão" value={name} onChange={setName} placeholder="Ex.: Compumais fixo" />
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Filas desta linha</p>
        <QueueChips
          queues={queues}
          selected={queueIds}
          onToggle={(id) => setQueueIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
        />
        <p className="mt-2 text-xs text-muted">
          Só as filas marcadas aqui entram no menu do WhatsApp. O cliente responde 1, 2, 3… e cai na fila.
        </p>
      </div>
      <TextArea
        label="Saudação da conexão"
        value={greeting}
        onChange={setGreeting}
        placeholder="Olá! Escolha o setor:"
        hint="Texto inicial. O menu numerado das filas é montado automaticamente pelo WhatsApp."
      />
      <TextArea
        label="Mensagem de conclusão"
        value={completion}
        onChange={setCompletion}
        placeholder="Atendimento encerrado. Obrigado pelo contato!"
      />
      <TextArea
        label="Fora do expediente"
        value={outOfHours}
        onChange={setOutOfHours}
        placeholder="Estamos fora do horário de atendimento."
      />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Conexão padrão
      </label>
      {save.error ? <p className="text-sm text-open">{(save.error as Error).message}</p> : null}
      <PrimaryButton type="submit" disabled={save.isPending || !name.trim()}>
        {save.isPending ? "Salvando…" : initial?.id ? "Salvar conexão" : "Criar conexão"}
      </PrimaryButton>
    </form>
  );
}

function QuickMessagesPanel() {
  const qc = useQueryClient();
  const [shortcode, setShortcode] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<QuickMessage | null>(null);

  const list = useQuery({
    queryKey: ["hd-quick-messages"],
    queryFn: async () => unwrapQuickMessages(await helpdesk.quickMessages()),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = { shortcode: shortcode.trim().replace(/^\//, ""), message: message.trim() };
      return editing?.id ? helpdesk.updateQuickMessage(editing.id, payload) : helpdesk.createQuickMessage(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-quick-messages"] });
      setShortcode("");
      setMessage("");
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => helpdesk.deleteQuickMessage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-quick-messages"] }),
  });

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Atalhos pessoais para o composer. No chat, digite <code className="rounded bg-wash px-1">/</code> ou use o botão de mensagens rápidas.
      </p>
      <form
        className="mb-6 space-y-4 rounded-xl border border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (shortcode.trim() && message.trim()) save.mutate();
        }}
      >
        <UnderlineField
          label="Atalho"
          value={shortcode}
          onChange={setShortcode}
          placeholder="ex.: saudacao"
        />
        <TextArea label="Mensagem" value={message} onChange={setMessage} placeholder="Olá! Em que posso ajudar?" />
        <div className="flex items-center gap-2">
          <PrimaryButton type="submit" disabled={save.isPending || !shortcode.trim() || !message.trim()}>
            {save.isPending ? "Salvando…" : editing ? "Salvar mensagem" : "Criar mensagem rápida"}
          </PrimaryButton>
          {editing ? (
            <button
              type="button"
              className="text-sm text-muted hover:text-ink"
              onClick={() => {
                setEditing(null);
                setShortcode("");
                setMessage("");
              }}
            >
              Cancelar
            </button>
          ) : null}
        </div>
        {save.error ? <p className="text-sm text-open">{(save.error as Error).message}</p> : null}
      </form>
      {list.error ? <p className="mb-3 text-sm text-open">{(list.error as Error).message}</p> : null}
      {(list.data || []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Nenhuma mensagem rápida ainda. Crie um atalho para usar no atendimento.
        </p>
      ) : (
        <ul className="space-y-2">
          {(list.data || []).map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">/{item.shortcode}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{item.message}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-muted hover:bg-wash"
                  onClick={() => {
                    setEditing(item);
                    setShortcode(item.shortcode);
                    setMessage(item.message);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-open hover:bg-open-bg"
                  onClick={() => {
                    if (window.confirm(`Excluir /${item.shortcode}?`)) remove.mutate(item.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WhatsappSettings({ section, onSection }: { section: WhatsappSection; onSection: (s: WhatsappSection) => void }) {
  const qc = useQueryClient();
  const [queueEdit, setQueueEdit] = useState<HelpdeskQueue | null | undefined>(undefined);
  const [connEdit, setConnEdit] = useState<HelpdeskConnection | null | undefined>(undefined);
  const [qrId, setQrId] = useState<number | null>(null);
  const [draftQueues, setDraftQueues] = useState<Record<number, number[]>>({});

  const queues = useQuery({ queryKey: ["hd-queues"], queryFn: helpdesk.queues });
  const agents = useQuery({
    queryKey: ["hd-agents"],
    queryFn: helpdesk.agents,
    enabled: section === "agentes",
  });
  const connections = useQuery({
    queryKey: ["hd-connections"],
    queryFn: async () => unwrapConnections(await helpdesk.connections()),
    enabled: section === "conexoes",
    refetchInterval: section === "conexoes" ? 2500 : false,
  });

  useEffect(() => {
    if (!agents.data) return;
    setDraftQueues(Object.fromEntries(agents.data.map((a) => [a.id, (a.queues || []).map((q) => q.id)])));
  }, [agents.data]);

  const removeQueue = useMutation({
    mutationFn: (id: number) => helpdesk.deleteQueue(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-queues"] }),
  });
  const saveAgent = useMutation({
    mutationFn: ({ id, queueIds }: { id: number; queueIds: number[] }) => helpdesk.updateAgentQueues(id, queueIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-agents"] }),
  });
  const start = useMutation({
    mutationFn: (id: number) => helpdesk.startSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-connections"] }),
  });
  const restart = useMutation({
    mutationFn: (id: number) => helpdesk.restartSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-connections"] }),
  });
  const logout = useMutation({
    mutationFn: (id: number) => helpdesk.logoutSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hd-connections"] }),
  });
  const removeConn = useMutation({
    mutationFn: (id: number) => helpdesk.deleteConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-connections"] });
      setQrId(null);
    },
  });

  const liveQr = useMemo(() => {
    if (!qrId) return null;
    return (connections.data || []).find((c) => c.id === qrId) || null;
  }, [connections.data, qrId]);

  useEffect(() => {
    if (liveQr?.status?.toLowerCase() === "connected") {
      const t = setTimeout(() => setQrId(null), 800);
      return () => clearTimeout(t);
    }
  }, [liveQr?.status]);

  const queueList = queues.data || [];

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-line">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSection(item.key)}
            className={cn(
              "relative px-4 py-2 text-sm font-medium",
              section === item.key ? "text-brand" : "text-muted hover:text-ink",
            )}
          >
            {item.label}
            {section === item.key ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
          </button>
        ))}
      </div>

      {section === "filas" ? (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted">
              Cada fila tem cor e mensagens próprias. Para disparar no WhatsApp, ela precisa estar na conexão (aba Conexões).
            </p>
            <button
              type="button"
              onClick={() => setQueueEdit(null)}
              className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Nova fila
            </button>
          </div>
          {queues.error ? <p className="mb-3 text-sm text-open">{(queues.error as Error).message}</p> : null}
          {queueList.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              Nenhuma fila ainda. Crie Suporte, Comercial ou o setor que precisar.
            </p>
          ) : (
            <ul className="space-y-2">
              {queueList.map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: q.color || "#3b82f6" }} />
                      <p className="text-sm font-semibold text-ink">{q.name}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {q.greetingMessage ? `Saudação: ${q.greetingMessage}` : "Sem mensagem de saudação"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {q.outOfHoursMessage ? `Fora do expediente: ${q.outOfHoursMessage}` : "Sem mensagem fora do expediente"}
                    </p>
                    <p className="truncate text-xs text-muted">{scheduleSummary(q.schedules)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-wash" onClick={() => setQueueEdit(q)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-open hover:bg-open-bg"
                      onClick={() => {
                        if (window.confirm(`Excluir a fila ${q.name}?`)) removeQueue.mutate(q.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {section === "agentes" ? (
        <div>
          <p className="mb-4 text-sm text-muted">Marque as filas que cada usuário do Computicket pode atender no WhatsApp.</p>
          {agents.error ? <p className="mb-3 text-sm text-open">{(agents.error as Error).message}</p> : null}
          {(agents.data || []).length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              Nenhum usuário ativo encontrado.
            </p>
          ) : (
            <ul className="space-y-3">
              {(agents.data || []).map((agent) => {
                const selected = draftQueues[agent.id] || [];
                const dirty = JSON.stringify(selected) !== JSON.stringify((agent.queues || []).map((q) => q.id));
                return (
                  <li key={agent.id} className="rounded-xl border border-line px-4 py-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">{agent.name}</p>
                        <p className="text-xs text-muted">
                          {agent.email} · {agent.role}
                          {agent.engine_user_id ? "" : " · ainda não sincronizado"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!dirty || saveAgent.isPending}
                        onClick={() => saveAgent.mutate({ id: agent.id, queueIds: selected })}
                        className="rounded-lg bg-inverse px-3 py-1.5 text-xs font-medium text-on-inverse disabled:opacity-40"
                      >
                        {saveAgent.isPending ? "Salvando…" : "Salvar filas"}
                      </button>
                    </div>
                    <QueueChips
                      queues={queueList}
                      selected={selected}
                      onToggle={(id) =>
                        setDraftQueues((cur) => {
                          const next = cur[agent.id] || [];
                          return {
                            ...cur,
                            [agent.id]: next.includes(id) ? next.filter((x) => x !== id) : [...next, id],
                          };
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {saveAgent.error ? <p className="mt-3 text-sm text-open">{(saveAgent.error as Error).message}</p> : null}
        </div>
      ) : null}

      {section === "rapidas" ? <QuickMessagesPanel /> : null}

      {section === "conexoes" ? (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted">Linhas WhatsApp com filas, mensagens e QR de pareamento.</p>
            <button
              type="button"
              onClick={() => setConnEdit(null)}
              className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Nova conexão
            </button>
          </div>
          {connections.error ? <p className="mb-3 text-sm text-open">{(connections.error as Error).message}</p> : null}
          {(connections.data || []).length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              Nenhuma conexão ainda. Crie a primeira linha WhatsApp.
            </p>
          ) : (
            <ul className="space-y-2">
              {(connections.data || []).map((c) => (
                <li key={c.id} className="rounded-xl border border-line px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{c.name}</p>
                      <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", statusClass(c.status))}>
                        {statusLabel(c.status)}
                      </span>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(c.queues || []).map((q) => (
                          <span
                            key={q.id}
                            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                            style={{ background: q.color || "#3b82f6" }}
                          >
                            {q.name}
                          </span>
                        ))}
                        {!c.queues?.length ? <span className="text-[11px] text-muted">Sem filas vinculadas</span> : null}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="QR / conectar"
                        onClick={() => {
                          setQrId(c.id);
                          if ((c.status || "").toLowerCase() !== "qrcode") start.mutate(c.id);
                        }}
                        className="rounded-lg p-1.5 text-brand hover:bg-progress-bg"
                      >
                        <QrCode className="h-4 w-4" />
                      </button>
                      <button type="button" title="Editar" onClick={() => setConnEdit(c)} className="rounded-lg p-1.5 text-muted hover:bg-wash">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" title="Reiniciar" onClick={() => restart.mutate(c.id)} className="rounded-lg p-1.5 text-muted hover:bg-wash">
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button type="button" title="Desconectar" onClick={() => logout.mutate(c.id)} className="rounded-lg p-1.5 text-muted hover:bg-wash">
                        <PlugZap className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        onClick={() => {
                          if (window.confirm(`Excluir a conexão ${c.name}?`)) removeConn.mutate(c.id);
                        }}
                        className="rounded-lg p-1.5 text-open hover:bg-open-bg"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {liveQr ? (
            <div className="mt-4 rounded-xl border border-line p-4">
              <p className="mb-2 text-sm font-medium text-navy">Parear {liveQr.name}</p>
              {liveQr.qrcode && (liveQr.status || "").toLowerCase() === "qrcode" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="QR Code WhatsApp"
                  className="mx-auto h-56 w-56 rounded-lg border border-line bg-white p-2"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(liveQr.qrcode)}`}
                />
              ) : (liveQr.status || "").toLowerCase() === "connected" ? (
                <p className="py-6 text-center text-sm text-done">Conectado</p>
              ) : (
                <p className="py-6 text-center text-sm text-muted">Gerando QR… clique em conectar se nada aparecer.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal open={queueEdit !== undefined} onClose={() => setQueueEdit(undefined)} title={queueEdit?.id ? "Editar fila" : "Nova fila"} wide>
        {queueEdit !== undefined ? <QueueForm initial={queueEdit} onClose={() => setQueueEdit(undefined)} /> : null}
      </Modal>
      <Modal
        open={connEdit !== undefined}
        onClose={() => setConnEdit(undefined)}
        title={connEdit?.id ? "Editar conexão WhatsApp" : "Nova conexão WhatsApp"}
        wide
      >
        {connEdit !== undefined ? (
          <ConnectionForm initial={connEdit} queues={queueList} onClose={() => setConnEdit(undefined)} />
        ) : null}
      </Modal>
    </div>
  );
}
