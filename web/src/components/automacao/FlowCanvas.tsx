"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { asItems, flask, type PageRes } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { FLOW_NODE_TYPES, PALETTE } from "@/components/automacao/FlowNodes";
import {
  type FlowBuilder,
  type FlowCanvasConnection,
  type FlowCanvasNode,
  type FlowNodeData,
  type FlowNodeType,
} from "@/lib/flows";
import { PrimaryButton } from "@/components/ui/UnderlineField";

type ServiceOpt = { id: number; name: string };

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultData(type: FlowNodeType): FlowNodeData {
  if (type === "start") return { label: "Início do fluxo" };
  if (type === "message") return { label: "Olá! Vou te ajudar a abrir um chamado." };
  if (type === "menu") {
    return {
      message: "Selecione o setor para ser atendido",
      arrayOption: [
        { number: 1, value: "Suporte" },
        { number: 2, value: "Vendas" },
      ],
    };
  }
  if (type === "question") {
    return { typebotIntegration: { message: "Descreva o problema", answerKey: "descricao" } };
  }
  if (type === "identify") {
    return {
      typebotIntegration: { message: "Qual o seu CNPJ?", answerKey: "cnpj" },
      confirmationMessage: "Empresa {{empresa}} identificada. Vamos continuar.",
      failMessage: "Não encontrei esse CNPJ no cadastro. Confira e envie novamente.",
    };
  }
  return {
    mapping: {
      title: "{{titulo}}",
      description: "{{descricao}}",
      solicitante: "{{nome}}",
      client_query: "{{numero}}",
    },
    confirmationMessage: "Chamado {{ticket_id}} aberto. Em breve um técnico retorna.",
    failMessage: "Não foi possível identificar o cliente para abrir o chamado. Um atendente vai continuar daqui.",
  };
}

function toRfNodes(raw: FlowCanvasNode[]): Node<FlowNodeData>[] {
  return (raw || []).map((node) => ({
    id: String(node.id),
    type: node.type || "message",
    position: node.position || { x: 80, y: 80 },
    data: node.data || {},
  }));
}

function toRfEdges(raw: FlowCanvasConnection[]): Edge[] {
  return (raw || []).map((conn, index) => ({
    id: conn.id || `e-${conn.source}-${conn.target}-${index}`,
    source: String(conn.source),
    target: String(conn.target),
    sourceHandle: conn.sourceHandle || undefined,
    targetHandle: conn.targetHandle || undefined,
  }));
}

function serialize(nodes: Node<FlowNodeData>[], edges: Edge[]): {
  nodes: FlowCanvasNode[];
  connections: FlowCanvasConnection[];
} {
  const start = nodes.filter((n) => n.type === "start");
  const rest = nodes.filter((n) => n.type !== "start");
  return {
    nodes: [...start, ...rest].map((n) => ({
      id: n.id,
      type: n.type || "message",
      position: n.position,
      data: n.data,
    })),
    connections: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle || null,
      target: e.target,
      targetHandle: e.targetHandle || null,
    })),
  };
}

function FlowCanvasInner({
  flow,
  onSave,
  saving,
}: {
  flow: FlowBuilder;
  onSave: (nodes: FlowCanvasNode[], connections: FlowCanvasConnection[]) => void;
  saving?: boolean;
}) {
  const seeded = useMemo(() => {
    const stored = flow.flow?.nodes || [];
    if (stored.length) return toRfNodes(stored);
    return [
      {
        id: "start-1",
        type: "start",
        position: { x: 80, y: 180 },
        data: defaultData("start"),
      },
    ];
  }, [flow.id, flow.flow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(seeded);
  const [edges, setEdges, onEdgesChange] = useEdgesState(toRfEdges(flow.flow?.connections || []));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setNodes(seeded);
    setEdges(toRfEdges(flow.flow?.connections || []));
  }, [flow.id, seeded, flow.flow?.connections, setEdges, setNodes]);

  const selected = nodes.find((n) => n.id === selectedId) || null;

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false }, eds)),
    [setEdges],
  );

  const addNode = (type: FlowNodeType) => {
    if (type === "start" && nodes.some((n) => n.type === "start")) return;
    const id = uid(type);
    setNodes((cur) => [
      ...cur,
      {
        id,
        type,
        position: { x: 220 + cur.length * 40, y: 120 + (cur.length % 4) * 70 },
        data: defaultData(type),
      },
    ]);
    setSelectedId(id);
  };

  const updateSelected = (data: FlowNodeData) => {
    if (!selected) return;
    setNodes((cur) => cur.map((n) => (n.id === selected.id ? { ...n, data } : n)));
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-wash">
      <aside className="w-48 shrink-0 border-r border-line bg-surface p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Adicionar</p>
        <div className="space-y-1">
          {PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => addNode(item.type)}
              disabled={item.type === "start" && nodes.some((n) => n.type === "start")}
              className="flex w-full flex-col rounded-lg px-2 py-2 text-left hover:bg-wash disabled:opacity-40"
            >
              <span className="text-sm font-medium text-ink">{item.label}</span>
              <span className="text-[11px] text-muted">{item.hint}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={FLOW_NODE_TYPES}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        <div className="absolute right-3 top-3">
          <PrimaryButton
            type="button"
            disabled={saving}
            onClick={() => {
              const payload = serialize(nodes, edges);
              onSave(payload.nodes, payload.connections);
            }}
          >
            {saving ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </div>
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-surface p-4">
        {selected ? (
          <NodeEditor node={selected} onChange={updateSelected} />
        ) : (
          <p className="text-sm text-muted">Selecione um bloco para editar. Use {"{{variavel}}"} nos textos.</p>
        )}
      </aside>
    </div>
  );
}

function NodeEditor({
  node,
  onChange,
}: {
  node: Node<FlowNodeData>;
  onChange: (data: FlowNodeData) => void;
}) {
  const data = node.data || {};
  const services = useQuery({
    queryKey: ["services-flow"],
    queryFn: () => flask.get<PageRes<ServiceOpt> | ServiceOpt[]>("/api/web/services?per_page=200"),
    enabled: node.type === "ticket",
  });
  const serviceItems = asItems(services.data);

  if (node.type === "start") {
    return (
      <div>
        <h3 className="text-sm font-semibold text-navy">Início</h3>
        <p className="mt-2 text-sm text-muted">Este bloco só marca o começo. Ligue a saída no próximo passo.</p>
      </div>
    );
  }

  if (node.type === "message") {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-navy">Conteúdo</h3>
        <textarea
          value={data.label || ""}
          onChange={(e) => onChange({ ...data, label: e.target.value })}
          rows={6}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="Texto enviado no WhatsApp"
        />
      </div>
    );
  }

  if (node.type === "question") {
    const integ = data.typebotIntegration || { message: "", answerKey: "resposta" };
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-navy">Pergunta</h3>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Pergunta</span>
          <textarea
            value={integ.message || ""}
            onChange={(e) => onChange({ ...data, typebotIntegration: { ...integ, message: e.target.value } })}
            rows={4}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Variável</span>
          <input
            value={integ.answerKey || ""}
            onChange={(e) =>
              onChange({
                ...data,
                typebotIntegration: { ...integ, answerKey: e.target.value.replace(/\s+/g, "_") },
              })
            }
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="titulo"
          />
          <p className="mt-1 text-xs text-muted">A resposta entra em {"{{variavel}}"} nos blocos seguintes e no ticket.</p>
        </label>
      </div>
    );
  }

  if (node.type === "identify") {
    const integ = data.typebotIntegration || { message: "Qual o seu CNPJ?", answerKey: "cnpj" };
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-navy">Coleta de dados</h3>
        <p className="text-xs text-muted">
          Pergunta o CNPJ, busca a empresa no cadastro e vincula este WhatsApp. Se o contato já estiver vinculado, esta etapa é pulada.
        </p>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Pergunta</span>
          <textarea
            value={integ.message || ""}
            onChange={(e) => onChange({ ...data, typebotIntegration: { ...integ, message: e.target.value } })}
            rows={4}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Se o CNPJ não for encontrado</span>
          <textarea
            value={data.failMessage || ""}
            onChange={(e) => onChange({ ...data, failMessage: e.target.value })}
            rows={3}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Confirmação (após vincular)</span>
          <textarea
            value={data.confirmationMessage || ""}
            onChange={(e) => onChange({ ...data, confirmationMessage: e.target.value })}
            rows={3}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <p className="mt-1 text-xs text-muted">
            Use {"{{empresa}}"} e {"{{cnpj}}"}. Em branco, segue o fluxo sem mensagem extra. Contatos já vinculados não recebem esta confirmação.
          </p>
        </label>
      </div>
    );
  }

  if (node.type === "menu") {
    const options = data.arrayOption || [];
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-navy">Menu</h3>
        <textarea
          value={data.message || ""}
          onChange={(e) => onChange({ ...data, message: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="Escolha uma opção"
        />
        {options.map((opt, index) => (
          <div key={opt.number} className="flex gap-2">
            <input
              value={opt.value}
              onChange={(e) => {
                const next = options.map((item, i) => (i === index ? { ...item, value: e.target.value } : item));
                onChange({ ...data, arrayOption: next });
              }}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              className="text-xs text-open"
              onClick={() => onChange({ ...data, arrayOption: options.filter((_, i) => i !== index) })}
            >
              Remover
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-xs font-medium text-brand"
          onClick={() => {
            const nextNumber = options.reduce((max, item) => Math.max(max, item.number), 0) + 1;
            onChange({
              ...data,
              arrayOption: [...options, { number: nextNumber, value: `Opção ${nextNumber}` }],
            });
          }}
        >
          Adicionar opção
        </button>
      </div>
    );
  }

  const mapping = data.mapping || {};
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-navy">Ticket</h3>
      <p className="text-xs text-muted">
        Mapeie as variáveis coletadas. Coloque o bloco Coleta de dados (CNPJ) antes deste passo para vincular o WhatsApp à empresa.
      </p>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Título</span>
        <input
          value={mapping.title || ""}
          onChange={(e) => onChange({ ...data, mapping: { ...mapping, title: e.target.value } })}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Descrição</span>
        <textarea
          value={mapping.description || ""}
          onChange={(e) => onChange({ ...data, mapping: { ...mapping, description: e.target.value } })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Solicitante</span>
        <input
          value={mapping.solicitante || ""}
          onChange={(e) => onChange({ ...data, mapping: { ...mapping, solicitante: e.target.value } })}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Busca de cliente</span>
        <input
          value={mapping.client_query || ""}
          onChange={(e) => onChange({ ...data, mapping: { ...mapping, client_query: e.target.value } })}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="{{cnpj}} ou {{numero}}"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Categoria</span>
        <select
          value={mapping.service_id || ""}
          onChange={(e) =>
            onChange({
              ...data,
              mapping: { ...mapping, service_id: e.target.value ? Number(e.target.value) : null },
            })
          }
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="">Sem categoria</option>
          {serviceItems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Confirmação</span>
        <textarea
          value={data.confirmationMessage || ""}
          onChange={(e) => onChange({ ...data, confirmationMessage: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Se o cliente não for encontrado</span>
        <textarea
          value={data.failMessage || ""}
          onChange={(e) => onChange({ ...data, failMessage: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
    </div>
  );
}

export function FlowCanvas(props: {
  flow: FlowBuilder;
  onSave: (nodes: FlowCanvasNode[], connections: FlowCanvasConnection[]) => void;
  saving?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
