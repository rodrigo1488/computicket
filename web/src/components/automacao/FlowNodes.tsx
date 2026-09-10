"use client";

import { useCallback, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { BookOpen, Building2, GitBranch, MessageCircleQuestion, Play, Ticket } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FlowNodeData, FlowNodeType } from "@/lib/flows";

const META: Record<
  FlowNodeType,
  { label: string; icon: typeof Play; bar: string; tone: string }
> = {
  start: { label: "Início", icon: Play, bar: "bg-done", tone: "from-done/20" },
  message: { label: "Conteúdo", icon: BookOpen, bar: "bg-warn", tone: "from-warn/15" },
  menu: { label: "Menu", icon: GitBranch, bar: "bg-open", tone: "from-open/15" },
  question: { label: "Pergunta", icon: MessageCircleQuestion, bar: "bg-brand", tone: "from-brand/15" },
  identify: { label: "Coleta de dados", icon: Building2, bar: "bg-done", tone: "from-done/15" },
  ticket: { label: "Ticket", icon: Ticket, bar: "bg-navy", tone: "from-navy/10" },
};

export function flowNodePreview(type: string, data: FlowNodeData) {
  if (type === "start") return "Este bloco marca o início do fluxo";
  if (type === "message") return data.label || "Texto enviado ao cliente";
  if (type === "menu") return data.message || "Opções numeradas";
  if (type === "question") return data.typebotIntegration?.message || "Pergunta ao cliente";
  if (type === "identify") return data.typebotIntegration?.message || "Pede o CNPJ e vincula a empresa";
  if (type === "ticket") return data.mapping?.title || "Abre o chamado no fim";
  return "";
}

export function FlowBlockNode({ id, data, type, selected }: NodeProps<Node<FlowNodeData>>) {
  const kind = (type as FlowNodeType) || "message";
  const meta = META[kind] || META.message;
  const Icon = meta.icon;
  const options = kind === "menu" ? data.arrayOption || [] : [];

  return (
    <div
      className={cn(
        "w-[220px] overflow-hidden rounded-xl border bg-surface shadow-sm",
        selected ? "border-brand ring-2 ring-brand/30" : "border-line",
      )}
    >
      {kind !== "start" ? (
        <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-line !bg-white" />
      ) : null}
      <div className={cn("flex items-center gap-2 bg-gradient-to-r px-3 py-2 to-transparent", meta.tone)}>
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-md text-white", meta.bar)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink">{meta.label}</p>
      </div>
      <p className="line-clamp-3 px-3 py-2 text-xs text-muted">{flowNodePreview(kind, data)}</p>
      {kind === "menu" ? (
        <div className="space-y-1 border-t border-line px-3 py-2">
          {options.map((opt) => (
            <div key={`${id}-opt-${opt.number}`} className="relative flex items-center justify-between text-[11px]">
              <span className="truncate text-ink">
                [{opt.number}] {opt.value}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={`a${opt.number}`}
                className="!right-[-17px] !h-2.5 !w-2.5 !border-line !bg-white"
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Right} id="out" className="!h-2.5 !w-2.5 !border-line !bg-white" />
      )}
    </div>
  );
}

export const FLOW_NODE_TYPES = {
  start: FlowBlockNode,
  message: FlowBlockNode,
  menu: FlowBlockNode,
  question: FlowBlockNode,
  identify: FlowBlockNode,
  ticket: FlowBlockNode,
};

export const PALETTE: { type: FlowNodeType; label: string; hint: string }[] = [
  { type: "start", label: "Início", hint: "Marca o começo" },
  { type: "message", label: "Conteúdo", hint: "Envia um texto" },
  { type: "menu", label: "Menu", hint: "Opções 1, 2, 3…" },
  { type: "question", label: "Pergunta", hint: "Salva em variável" },
  { type: "identify", label: "Coleta de dados", hint: "CNPJ e vínculo da empresa" },
  { type: "ticket", label: "Ticket", hint: "Abre o chamado" },
];
