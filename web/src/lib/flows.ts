import { flask } from "@/lib/api";

export type FlowNodeType = "start" | "message" | "menu" | "question" | "identify" | "ticket";

export type FlowMenuOption = { number: number; value: string; queueId?: number | null };

export type FlowTicketMapping = {
  title?: string;
  description?: string;
  solicitante?: string;
  service_id?: number | null;
  client_query?: string;
};

export type FlowNodeData = {
  label?: string;
  message?: string;
  arrayOption?: FlowMenuOption[];
  typebotIntegration?: { message?: string; answerKey?: string };
  mapping?: FlowTicketMapping;
  confirmationMessage?: string;
  failMessage?: string;
  queueId?: number | null;
};

export type FlowCanvasNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: FlowNodeData;
};

export type FlowCanvasConnection = {
  id?: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
};

export type FlowBuilder = {
  id: number;
  name: string;
  active?: boolean;
  flow?: { nodes?: FlowCanvasNode[]; connections?: FlowCanvasConnection[] } | null;
  createdAt?: string;
  updatedAt?: string;
};

export const flowsApi = {
  list: () => flask.get<{ flows: FlowBuilder[] }>("/helpdesk/api/flows"),
  create: (name: string) => flask.post<FlowBuilder>("/helpdesk/api/flows", { name }),
  get: (id: number) => flask.get<FlowBuilder>(`/helpdesk/api/flows/${id}`),
  rename: (id: number, name: string) => flask.put<FlowBuilder>(`/helpdesk/api/flows/${id}`, { name }),
  remove: (id: number) => flask.delete(`/helpdesk/api/flows/${id}`),
  saveCanvas: (id: number, nodes: FlowCanvasNode[], connections: FlowCanvasConnection[]) =>
    flask.put(`/helpdesk/api/flows/${id}/canvas`, { nodes, connections }),
  duplicate: (id: number) => flask.post<FlowBuilder>(`/helpdesk/api/flows/${id}/duplicate`),
};
