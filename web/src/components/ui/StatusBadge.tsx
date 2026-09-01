import { Ban, Check, Clock, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TicketStatus } from "@/lib/format";

const MAP: Record<
  TicketStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  aberto: {
    label: "Aberto",
    className: "bg-open-bg text-open",
    icon: Clock,
  },
  em_andamento: {
    label: "Em andamento",
    className: "bg-progress-bg text-progress",
    icon: Play,
  },
  fechado: {
    label: "Fechado",
    className: "bg-done-bg text-done",
    icon: Check,
  },
  cancelado: {
    label: "Cancelado",
    className: "bg-wash text-muted",
    icon: Ban,
  },
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const cfg = MAP[status] || MAP.aberto;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium",
        cfg.className,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}

export function StatusIcon({ status }: { status: TicketStatus }) {
  const cfg = MAP[status] || MAP.aberto;
  const Icon = cfg.icon;
  const bg =
    status === "aberto"
      ? "bg-open"
      : status === "em_andamento"
        ? "bg-progress"
        : status === "cancelado"
          ? "bg-[#9ca3af]"
          : "bg-done";
  return (
    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-white", bg)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
