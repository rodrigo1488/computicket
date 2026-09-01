"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask, asItems, type PageRes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";

type CalEvent = {
  id: number | string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  color?: string;
  description?: string;
  client_name?: string;
  service_name?: string;
  user_name?: string;
  extendedProps?: {
    type?: string;
    client_name?: string;
    service_name?: string;
    user_name?: string;
    description?: string;
    appointment_id?: number;
    client_id?: number;
    user_id?: number;
    service_id?: number;
  };
  client_id?: number;
  user_id?: number;
  service_id?: number;
};

type Client = { id: number; name: string };
type Service = { id: number; name: string };
type UserRow = { id: number; name: string; status?: string };

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTH_WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toDatetimeLocal(d: Date) {
  return `${ymd(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatWeekLabel(weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const a = weekStart.toLocaleDateString("pt-BR", opts);
  const b = weekEnd.toLocaleDateString("pt-BR", { ...opts, year: "numeric" });
  return `${a} – ${b}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function formatMonthLabel(d: Date) {
  const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function eventDayKey(ev: CalEvent) {
  const raw = ev.start || "";
  return raw.slice(0, 10);
}

function eventTime(ev: CalEvent) {
  if (ev.allDay) return "Dia todo";
  const d = new Date(ev.start);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function AgendaPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [selectedDayKey, setSelectedDayKey] = useState(() => ymd(new Date()));
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState(() => toDatetimeLocal(new Date()));
  const [clientQ, setClientQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState(user?.id ? String(user.id) : "");
  const [serviceId, setServiceId] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);
  const monthDays = useMemo(() => {
    const gridStart = startOfWeek(monthAnchor);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [monthAnchor]);
  const rangeStart = monthDays[0];
  const rangeEnd = addDays(monthDays[monthDays.length - 1], 1);

  const eventsQuery = useQuery({
    queryKey: ["agenda-cal", ymd(rangeStart), ymd(rangeEnd)],
    queryFn: () =>
      flask.get<CalEvent[]>(
        `/agenda/calendario?start=${encodeURIComponent(rangeStart.toISOString())}&end=${encodeURIComponent(rangeEnd.toISOString())}`,
      ),
  });

  const clients = useQuery({
    queryKey: ["clients", clientQ],
    queryFn: () => flask.get<{ items: Client[] }>(`/api/web/clients?q=${encodeURIComponent(clientQ)}&per_page=30`),
    enabled: open,
  });
  const services = useQuery({
    queryKey: ["services"],
    queryFn: () => flask.get<PageRes<Service> | Service[]>("/api/web/services?per_page=200"),
    enabled: open,
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => flask.get<PageRes<UserRow> | UserRow[]>("/api/web/users?status=1&per_page=200"),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => {
      const iso = new Date(when).toISOString();
      const body = {
        title,
        description,
        appointment_date: iso,
        client_id: Number(clientId),
        user_id: Number(userId),
        service_id: serviceId ? Number(serviceId) : null,
      };
      if (editingId) return flask.post<{ success: boolean; message?: string }>(`/agenda/${editingId}/editar`, body);
      return flask.post<{ success: boolean; message?: string; error?: string }>("/agenda/novo", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda-cal"] });
      setOpen(false);
      setEditingId(null);
      setTitle("");
      setDescription("");
      setClientId("");
      setServiceId("");
      setFormError("");
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Erro ao agendar"),
  });

  const removeAppt = useMutation({
    mutationFn: (id: number) => flask.post(`/agenda/${id}/excluir`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda-cal"] }),
  });

  const openCreate = (date?: Date) => {
    const base = date ? new Date(date) : new Date();
    if (date) base.setHours(9, 0, 0, 0);
    setWhen(toDatetimeLocal(base));
    if (!userId && user?.id) setUserId(String(user.id));
    setEditingId(null);
    setTitle("");
    setDescription("");
    setClientId("");
    setServiceId("");
    setFormError("");
    setOpen(true);
  };

  const openEdit = (ev: CalEvent) => {
    const id = Number(ev.extendedProps?.appointment_id || ev.id);
    if (!id || Number.isNaN(id)) return;
    setEditingId(id);
    setTitle(ev.title);
    setDescription(ev.description || ev.extendedProps?.description || "");
    setWhen(toDatetimeLocal(new Date(ev.start)));
    const cid = ev.client_id ?? ev.extendedProps?.client_id;
    const uid = ev.user_id ?? ev.extendedProps?.user_id;
    const sid = ev.service_id ?? ev.extendedProps?.service_id;
    setClientId(cid ? String(cid) : "");
    setUserId(uid ? String(uid) : user?.id ? String(user.id) : "");
    setServiceId(sid ? String(sid) : "");
    setFormError("");
    setOpen(true);
  };

  const todayKey = ymd(new Date());
  const events = useMemo(
    () => (Array.isArray(eventsQuery.data) ? eventsQuery.data : []),
    [eventsQuery.data],
  );
  const byDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const ev of events) {
      const key = eventDayKey(ev);
      (map[key] ||= []).push(ev);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    }
    return map;
  }, [events]);
  const selectedEvents = byDay[selectedDayKey] || [];
  const selectedDate = new Date(`${selectedDayKey}T12:00:00`);

  const changeWeek = (days: number) => {
    const next = addDays(anchor, days);
    setAnchor(next);
    setMonthAnchor(startOfMonth(addDays(next, 3)));
  };

  const changeMonth = (months: number) => {
    const next = addMonths(monthAnchor, months);
    setMonthAnchor(next);
    setAnchor(startOfWeek(next));
    setSelectedDayKey(ymd(next));
  };

  const goToToday = () => {
    const today = new Date();
    setAnchor(startOfWeek(today));
    setMonthAnchor(startOfMonth(today));
    setSelectedDayKey(ymd(today));
  };

  const selectCalendarDay = (day: Date) => {
    setSelectedDayKey(ymd(day));
    setAnchor(startOfWeek(day));
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <PageTitle className="mb-0">Agenda</PageTitle>
        <button
          type="button"
          onClick={() => openCreate()}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
        >
          <Plus className="h-4 w-4" />
          Novo agendamento
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => changeWeek(-7)}
          className="rounded-xl border border-line p-2 text-ink hover:bg-wash"
          aria-label="Semana anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-[180px] text-center text-sm font-medium text-navy">{formatWeekLabel(anchor)}</p>
        <button
          type="button"
          onClick={() => changeWeek(7)}
          className="rounded-xl border border-line p-2 text-ink hover:bg-wash"
          aria-label="Próxima semana"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goToToday}
          className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
        >
          Hoje
        </button>
      </div>

      {eventsQuery.isLoading ? <p className="mb-4 text-sm text-muted">Carregando agenda…</p> : null}
      {eventsQuery.error ? <p className="mb-4 text-sm text-open">{(eventsQuery.error as Error).message}</p> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
        {weekDays.map((day, i) => {
          const key = ymd(day);
          const dayEvents = byDay[key] || [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={cn("min-h-[180px] rounded-2xl border border-line p-3", isToday && "border-brand/40 bg-progress-bg")}
            >
              <button type="button" onClick={() => openCreate(day)} className="mb-3 w-full text-left">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{WEEKDAYS[i]}</p>
                <p className={cn("text-lg font-semibold", isToday ? "text-brand" : "text-navy")}>{day.getDate()}</p>
              </button>
              <div className="space-y-2">
                {dayEvents.length === 0 ? <p className="text-xs text-muted">Sem agendamentos</p> : null}
                {dayEvents.map((ev) => {
                  const kind = ev.extendedProps?.type;
                  const isAppt = !kind || kind === "appointment";
                  const client = ev.client_name || ev.extendedProps?.client_name;
                  const tech = ev.user_name || ev.extendedProps?.user_name;
                  const apptId = Number(ev.extendedProps?.appointment_id || ev.id);
                  return (
                    <div
                      key={String(ev.id)}
                      className="rounded-xl px-2 py-2 text-left"
                      style={{ background: ev.color ? `${ev.color}18` : "#f5f5f5" }}
                    >
                      <p className="text-[11px] text-muted">{eventTime(ev)}</p>
                      <p className="text-sm font-medium text-ink">{ev.title}</p>
                      {kind && kind !== "appointment" ? null : (
                        <p className="text-xs text-muted">
                          {[client, tech].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {isAppt && apptId ? (
                        <div className="mt-1.5 flex gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(ev)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-muted hover:bg-line"
                            aria-label="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Excluir este agendamento?")) removeAppt.mutate(apptId);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-open hover:bg-open/10"
                            aria-label="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Visão mensal</p>
            <h2 className="mt-0.5 text-lg font-semibold text-navy">{formatMonthLabel(monthAnchor)}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="rounded-xl border border-line p-2 text-ink hover:bg-wash"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToToday}
              className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="rounded-xl border border-line p-2 text-ink hover:bg-wash"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-line bg-wash">
          {MONTH_WEEKDAYS.map((weekday, index) => (
            <div
              key={`${weekday}-${index}`}
              className="py-2 text-center text-[10px] font-medium uppercase tracking-[0.08em] text-muted sm:text-xs"
            >
              <span className="sm:hidden">{weekday}</span>
              <span className="hidden sm:inline">{WEEKDAYS[index]}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {monthDays.map((day) => {
            const key = ymd(day);
            const dayEvents = byDay[key] || [];
            const isToday = key === todayKey;
            const isSelected = key === selectedDayKey;
            const isCurrentMonth = day.getMonth() === monthAnchor.getMonth();
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectCalendarDay(day)}
                className={cn(
                  "min-h-20 border-b border-r border-line p-1.5 text-left transition-colors hover:bg-wash sm:min-h-28 sm:p-2",
                  !isCurrentMonth && "bg-wash text-muted",
                  isSelected && "bg-progress-bg ring-2 ring-inset ring-brand/30",
                )}
                aria-label={`${day.toLocaleDateString("pt-BR")}: ${dayEvents.length} agendamento(s)`}
                aria-pressed={isSelected}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium sm:h-7 sm:w-7 sm:text-sm",
                      isToday ? "bg-brand text-white" : isCurrentMonth ? "text-navy" : "text-muted",
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {dayEvents.length > 0 ? (
                    <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                      {dayEvents.length}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 hidden space-y-1 sm:block">
                  {dayEvents.slice(0, 2).map((ev) => (
                    <div
                      key={String(ev.id)}
                      className="truncate rounded-md px-1.5 py-1 text-[10px] text-ink"
                      style={{ background: ev.color ? `${ev.color}18` : "#f1f3f5" }}
                    >
                      {eventTime(ev)} {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 2 ? <p className="px-1 text-[10px] text-muted">+{dayEvents.length - 2} mais</p> : null}
                </div>
                {dayEvents.length > 0 ? (
                  <div className="mt-2 flex gap-1 sm:hidden">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <span
                        key={String(ev.id)}
                        className="h-1.5 w-1.5 rounded-full bg-brand"
                        style={ev.color ? { backgroundColor: ev.color } : undefined}
                      />
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Dia selecionado</p>
              <h3 className="mt-0.5 font-semibold text-navy">
                {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => openCreate(selectedDate)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:bg-wash"
            >
              <Plus className="h-4 w-4" />
              Agendar neste dia
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="rounded-xl bg-wash px-3 py-4 text-sm text-muted">Nenhum agendamento para este dia.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {selectedEvents.map((ev) => {
                const kind = ev.extendedProps?.type;
                const isAppt = !kind || kind === "appointment";
                const client = ev.client_name || ev.extendedProps?.client_name;
                const tech = ev.user_name || ev.extendedProps?.user_name;
                return (
                  <button
                    key={String(ev.id)}
                    type="button"
                    onClick={() => {
                      if (isAppt) openEdit(ev);
                    }}
                    className={cn(
                      "rounded-xl border border-line p-3 text-left",
                      isAppt ? "hover:border-brand/30 hover:bg-progress-bg" : "cursor-default",
                    )}
                  >
                    <p className="text-xs font-medium text-brand">{eventTime(ev)}</p>
                    <p className="mt-0.5 text-sm font-medium text-ink">{ev.title}</p>
                    {[client, tech].filter(Boolean).length > 0 ? (
                      <p className="mt-1 text-xs text-muted">{[client, tech].filter(Boolean).join(" · ")}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Modal open={open} onClose={() => { setOpen(false); setEditingId(null); }} title={editingId ? "Editar agendamento" : "Novo agendamento"} wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !when || !clientId || !userId) {
              setFormError("Título, data/hora, cliente e técnico são obrigatórios.");
              return;
            }
            create.mutate();
          }}
        >
          <UnderlineField label="Título" value={title} onChange={setTitle} placeholder="Assunto do agendamento" />
          <UnderlineField label="Data e hora" value={when} onChange={setWhen} type="datetime-local" />
          <UnderlineField label="Buscar cliente" value={clientQ} onChange={setClientQ} placeholder="Nome do cliente" />
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Cliente</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="">Selecione</option>
              {(clients.data?.items || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Técnico</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="">Selecione</option>
              {(users.data ? asItems(users.data) : [])
                .filter((u) => u.status !== "0")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Serviço</span>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="">Opcional</option>
              {asItems(services.data).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Descrição</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            />
          </label>
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={create.isPending}>
            {create.isPending ? "Salvando…" : editingId ? "Salvar" : "Agendar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
